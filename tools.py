"""Chat-surface stock_runway tool."""
from __future__ import annotations

import base64
import calendar
from datetime import date
import json
import math
from pathlib import Path

from .engine import (forecast, month_label, month_after, held_item, planning_number, planning_display_number,
                     planning_sum, sales_pattern, valid_month, normalize_order_settings,
                     order_guidance, order_bucket, order_sentence, no_order_sentence,
                     shortage_sentence, big_order_warning, active_skip, ORDER_BUCKET_LABELS)
from .sources import OdooReadOnly, SourceError, load_csv, load_sample, load_bundle

TOOL_SCHEMA = {
    "name": "stock_runway",
    "description": "Estimate when stock runs out and how reliable the estimate has been. Read-only. Works on every Hermes chat surface. Use purchase_summary for per-item order amounts, dates and status (summary retains legacy physical forecasts). Give a one-line answer, then emit the returned card verbatim in its own paragraph. Do not recreate, edit, or wrap the card line in a code fence; retain the plain summary on surfaces without cards.",
    "parameters": {"type": "object", "properties": {
        "source": {"type": "string", "enum": ["sample", "csv", "odoo"], "default": "sample"},
        "csv_path": {"type": "string", "description": "Explicit path to a local sales CSV; required when source=csv."},
        "receipts_path": {"type": "string", "description": "Optional local confirmed-receipts CSV path."},
        "bundle_path": {"type": "string", "description": "Explicit opt-in canonical CSV bundle directory (source=csv); mutually exclusive with CSV/receipts paths."},
        "skus": {"type": "array", "items": {"type": "string"}, "maxItems": 50, "description": "Only return these SKUs. Required for Odoo, at most 50."},
        "horizon": {"type": "integer", "minimum": 1, "maximum": 12, "default": 6},
        "settings": {"type": "object", "description": "Optional inventory planning settings; same names and defaults as Desktop. Costs use one consistent currency.", "properties": {
            "default_delivery_days": {"type": ["integer", "null"], "minimum": 1, "maximum": 3650},
            "months_of_cover": {"type": "number", "minimum": 0, "maximum": 36, "default": 2},
            "big_order_months": {"type": "number", "minimum": 0.1, "maximum": 120, "default": 6},
            "service_level": {"type": "number", "enum": [0.90, 0.95, 0.99], "default": 0.95},
            "buffer_days": {"type": "integer", "minimum": 0, "maximum": 365, "default": 7, "description": "Order this many days before lead-time run-out; time only, not extra units."},
            "review_days": {"type": "integer", "minimum": 0, "maximum": 3650, "default": 30},
            "order_cost": {"type": ["number", "null"], "minimum": 0, "maximum": 1e12},
            "holding_pct": {"type": "number", "minimum": 0.01, "maximum": 100, "default": 20},
            "include_backup_in_orders": {"type": "boolean", "default": False},
            "product_overrides": {"type": "object", "additionalProperties": {"type": "object", "properties": {
                "unit_cost": {"type": "number", "minimum": 0, "maximum": 1e12},
                "minimum_order": {"type": "number", "minimum": 0, "maximum": 1e12},
                "pack_size": {"type": "number", "minimum": 0.000001, "maximum": 1e12}}}}
        }},
    }, "required": []},
}


def _line(item: dict, horizon: int, source_item: dict | None = None) -> str:
    if item.get("held"):
        return f"{item.get('sku') or 'Item'}: held — {item['reason']}"
    runout = item["runout_month"]
    # Purchase guidance may extend beyond the selected physical projection.
    timing = (f"runs out {month_label(runout)}" if runout and runout <= item["projection"][-1]["month"]
              else f"does not run out within {horizon} months")
    planning = []
    source_item = source_item or item
    sales = source_item.get("monthly_sales", [])[-12:]
    pattern = sales_pattern(item.get("demand_swing"), planning_sum(sales) / len(sales)) if sales else None
    if pattern is not None:
        planning.append(f"Sales pattern: {pattern}")
    for key, title in (("safety_stock", "Safety stock — extra kept for delays or surprise demand:"),
                       ("reorder_point", "Reorder point — order when stock drops to"),
                       ("eoq", "Most economical order size (EOQ)")):
        if item.get(key) is not None:
            planning.append(f"{title} {planning_display_number(item[key])}")
    if item.get("suggested_order") is not None:
        planning.append(f"Suggested order {planning_display_number(item['suggested_order'])}")
    if item.get("on_order", 0) > 0:
        planning.append(f"On order — already ordered, not yet arrived: {planning_display_number(item['on_order'])}")
    if item.get("covered_by_on_order"):
        planning.append("On-order stock covers the risk of running out")
    if item.get("big_order"):
        if item.get("suggested_order") is not None and item.get("monthly_demand", 0) > 0:
            months = math.floor(item["suggested_order"] / item["monthly_demand"] * 10 + .5) / 10
            planning.append(f"Check this order: about {planning_number(months)} months of stock, much bigger than usual.")
    if source_item.get("on_hand") == 0:
        timing = "out of stock; " + ("no sales to forecast" if item.get("monthly_demand") == 0 else timing)
    if 0 < len(source_item.get("monthly_sales", [])) < 6:
        planning.append(f"Rough estimate: only {len(source_item['monthly_sales'])} months of sales to go on.")
    return f"{item['sku']}: {timing}; {item['grade']}" + ("; " + ", ".join(planning) if planning else "")


def _purchase_line(item, source_item, settings=None, today=None, as_of=None):
    """Desktop sentences; legacy summary remains a backward-compatible field."""
    guidance = item.get("guidance") or order_guidance({**source_item, **item, "as_of": as_of}, today, settings, as_of)
    bucket = item.get("order_bucket", "needs-data")
    if guidance["status"] == "needs-data":
        return f"{item.get('sku') or 'Item'}: {guidance['reason']}; {ORDER_BUCKET_LABELS['needs-data']}"
    sentence = order_sentence(source_item, guidance) if guidance["quantity"] > 0 else no_order_sentence(source_item, guidance)
    line = f"{item['sku']}: {sentence}; {ORDER_BUCKET_LABELS[bucket]}"
    shortage = shortage_sentence(source_item, guidance)
    warning = big_order_warning(guidance, settings)
    skipped = active_skip(settings, item.get("sku"), today, as_of)
    for extra in (shortage, warning, f"Skipped: {skipped['reason']}" if skipped else None):
        if extra:
            line += "; " + extra
    return line


def _json_safe(value):
    """Match JSON.stringify's null sentinel and integral numbers at the boundary."""
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer():
            return int(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _card(payload: dict, total_count: int) -> str | None:
    """Malformed Unicode must omit only the optional card, never the result."""
    try:
        return _encode_card(payload, total_count)
    except UnicodeError:
        return None


def _encode_card(payload: dict, total_count: int) -> str | None:
    """Encode a soonest-first prefix beneath Desktop's directive parser cap."""
    try:
        latest = date.fromisoformat(payload["as_of"])
        if latest.isoformat() != payload["as_of"] or latest.day != calendar.monthrange(latest.year, latest.month)[1]:
            return None
    except (TypeError, ValueError):
        return None  # Invalid source dates remain explainable through the plain summary.

    rows, seen = [], set()
    for item in sorted(payload["items"], key=lambda item: (
        item.get("held", False), item.get("runout_day") or "9999-12-31",
    )):
        sku = item.get("sku")
        name = item.get("name")
        # Check before bounding: never silently repair malformed source text.
        for value in (sku, name):
            if isinstance(value, str):
                value.encode("utf-8")
        if not isinstance(sku, str) or not sku[:120].strip():
            continue
        sku = sku[:120]
        if sku in seen:
            continue
        seen.add(sku)
        name = name[:240] if isinstance(name, str) and name[:240].strip() else sku
        held = bool(item.get("held"))
        rows.append({"sku": sku, "name": name,
                     "runout": None if held or item["runout_month"] and item["runout_month"] > month_after(payload["as_of"][:7], payload["horizon"]) else item["runout_month"],
                     "grade": "Check item data" if held else item["grade"],
                     "stock": None if held else item["stock"],
                     "monthly": None if held else item["monthly_demand"], "held": held})
        if len(rows) == 50:
            break

    payload["disclosure"].encode("utf-8")
    while True:
        dto = {"as_of": payload["as_of"], "horizon": payload["horizon"],
               "disclosure": payload["disclosure"][:512], "rows": rows,
               "more": max(0, total_count - len(rows))}
        raw = json.dumps(dto, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
        line = f'::stock-runway{{data="{encoded}"}}'
        if len(line) <= 1900:
            return line
        if not rows:
            return None
        rows.pop()  # Drop only trailing, lower-priority rows; count every omission.


def make_handler(secret_getter=None, sample_path: Path | None = None, *, today: date | None = None):
    def stock_runway(args: dict, **_: object) -> str:
        args = args if isinstance(args, dict) else {}
        source = args.get("source", "sample")
        try:
            horizon = args.get("horizon", 6)
            if isinstance(horizon, bool) or not isinstance(horizon, (int, float)) or not 1 <= horizon <= 12 or int(horizon) != horizon:
                raise SourceError("Horizon must be a whole number from 1 to 12.")
            horizon = int(horizon)
            if source == "sample":
                data = load_sample(sample_path)
            elif source == "csv":
                if args.get("bundle_path"):
                    if args.get("csv_path") or args.get("receipts_path"):
                        raise SourceError("Choose a bundle directory or individual CSV paths, not both.")
                    data = load_bundle(args["bundle_path"], today=(today or date.today()).isoformat())
                else:
                    data = load_csv(args.get("csv_path"), args.get("receipts_path"))
            elif source == "odoo":
                data = OdooReadOnly(secret_getter).load(args.get("skus"))
            else:
                raise SourceError("Source must be sample, csv, or odoo.")
            wanted = args.get("skus")
            if wanted is not None and (not isinstance(wanted, list) or any(not isinstance(x, str) for x in wanted)):
                raise SourceError("SKUs must be a list of text values.")
            items = [item for item in data.get("items", []) if wanted is None or item.get("sku") in wanted]
            if wanted is not None:
                missing = [sku for sku in wanted if sku not in {item.get("sku") for item in data.get("items", [])}]
                if missing:
                    raise SourceError("One or more requested SKUs were not found.")
            results = []
            current = today if today is not None else date.today()
            for item in items:
                try:
                    row = forecast(item, data["months"], data["as_of"], horizon, args.get("settings"), current)
                    row.setdefault("big_order", False)
                except Exception:
                    # Never expose exception text: it may contain private source values.
                    row = {**held_item(item), "big_order": False}
                # A purchase-only failure must not replace a valid physical row.
                try:
                    guidance_item = {**item, **row, "as_of": data["as_of"]}
                    row["guidance"] = order_guidance(guidance_item, current, args.get("settings"), data["as_of"])
                    limit = normalize_order_settings(args.get("settings"))["big_order_months"]
                    row["big_order"] = (row["guidance"].get("quantity") or 0) > row.get("monthly_demand", 0) * limit
                    row["order_bucket"] = order_bucket(guidance_item, current, args.get("settings"), data["as_of"],
                                                       guidance=row["guidance"])
                except Exception:
                    row["guidance"] = {"status": "needs-data",
                        "reason": "Couldn't calculate purchase guidance: check this item's data."}
                    row["order_bucket"] = "needs-data"
                results.append(row)
            total_count = len(results)
            truncated = wanted is None and total_count > 50
            if truncated:
                results = sorted(results, key=lambda item: (item.get("held", False), item.get("runout_day") or "9999-12-31"))[:50]
            source_items = {item.get("sku"): item for item in items}
            payload = {"source": source, "as_of": data["as_of"], "horizon": horizon,
                       "disclosure": ("Includes recorded receipts; assumes nothing else is on order." if any(
                           row["receipts"] > 0 for item in results for row in item.get("projection", [])
                       ) else "No receipts recorded; assumes nothing is on order."),
                       "items": results, "summary": [_line(item if "on_order" in item or isinstance(args.get("settings"), dict)
                           and "big_order_months" in args["settings"] else {k: v for k, v in item.items() if k != "big_order"}, horizon, source_items.get(item.get("sku")))
                           for item in results]}
            payload["purchase_summary"] = [_purchase_line(row, source_items.get(row.get("sku"), row),
                args.get("settings"), current.isoformat(), data["as_of"]) for row in results]
            if any(item.get("on_order", 0) > 0 for item in results if not item.get("held")):
                payload["disclosure"] = ("Includes recorded receipts. " if any(
                    row["receipts"] > 0 for item in results for row in item.get("projection", [])
                ) else "No receipts recorded. ") + "Includes on-order quantities in purchase planning only; physical run-out excludes undated incoming."
            months = data.get("months")
            if isinstance(months, list) and months and valid_month(months[-1]):
                year, month = map(int, months[-1].split("-"))
                sales_end = date(year, month, calendar.monthrange(year, month)[1])
                payload["data_age_days"] = max(0, (current - sales_end).days)
                payload["sales_month"] = months[-1]
            if truncated:
                payload.update(truncated=True, total_count=total_count)
            if source == "csv" and not args.get("bundle_path") and "import_report" in data:
                payload["import_report"] = data["import_report"]
                report = data["import_report"]
                payload["disclosure"] = (f"Import check: {report['products_ready']} products ready; "
                    f"{len(report['rows_set_aside'])} rows set aside; "
                    f"{len(report['ignored'])} columns ignored. Review import_report before ordering. "
                    + payload["disclosure"])
            card = _card(payload, total_count)
            if card is not None:
                payload["card"] = card
            payload = _json_safe(payload)
            text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            try:
                text.encode("utf-8")
            except UnicodeError:
                # Preserve the plain DTO through JSON escapes, not invalid UTF-8.
                text = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
            return text
        except SourceError as exc:
            return json.dumps({"error": str(exc)}, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            return json.dumps({"error": "Inventory Manager could not read the selected source."}, separators=(",", ":"))
    return stock_runway
