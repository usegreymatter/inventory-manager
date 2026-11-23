#!/usr/bin/env python3
"""Export local stock order guidance as CSV; Python standard library only."""
from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
from decimal import Decimal
import importlib
import math
import json
from pathlib import Path
import re
import sys
import types


FORECAST_METHODS = ("current", "auto", "naive", "seasonal_naive", "ma3", "ma6", "ma12",
                    "ses", "holt_damped", "hw_additive", "hw_multiplicative", "theta",
                    "croston", "sba", "tsb", "adida", "combination", "recommended")
INDUSTRY_PRESETS = ("distributor", "retail", "spare-parts", "restaurant", "pharmacy", "seasonal", "ecommerce")


CSV_FIELDS = ("sku", "name", "unit", "status", "order_qty", "order_by",
              "next_confirmed_delivery", "arrives_by", "run_out", "on_hand", "on_order",
              "safety_stock", "reorder_point", "reason")


def _load_modules():
    """Load sibling modules without importing the Hermes plugin entry point.

    The private package preserves sources.py's relative imports even when the
    checkout directory is renamed, or this script shadows stock_runway imports.
    """
    name = "_stock_runway_cli"
    if name not in sys.modules:
        package = types.ModuleType(name)
        package.__path__ = [str(Path(__file__).resolve().parent)]
        sys.modules[name] = package
    return (importlib.import_module(name + ".engine"),
            importlib.import_module(name + ".sources"))


def _iso_date(value):
    try:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError("use a valid date in YYYY-MM-DD format") from None


def _delivery_days(value):
    try:
        if not re.fullmatch(r"[0-9]+", value):
            raise ValueError
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("delivery days must be a whole number from 1 to 3650") from None
    if not 1 <= number <= 3650:
        raise argparse.ArgumentTypeError("delivery days must be a whole number from 1 to 3650")
    return number


def _buffer_days(value):
    try:
        if not re.fullmatch(r"[0-9]+", value):
            raise ValueError
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("buffer days must be a whole number from 0 to 365") from None
    if not 0 <= number <= 365:
        raise argparse.ArgumentTypeError("buffer days must be a whole number from 0 to 365")
    return number


def _life_days(value):
    if not re.fullmatch(r"[0-9]+", value) or not 1 <= int(value) <= 36500:
        raise argparse.ArgumentTypeError("shelf life must be a whole number from 1 to 36500")
    return int(value)


def _age_days(value):
    if not re.fullmatch(r"[0-9]+", value) or not 0 <= int(value) <= 36500:
        raise argparse.ArgumentTypeError("life age/margin must be a whole number from 0 to 36500")
    return int(value)


def _max_bytes(value):
    message = f"max bytes must be a positive ASCII integer from 1 to {sys.maxsize - 1}"
    try:
        if len(value) > len(str(sys.maxsize)) or not re.fullmatch(r"[0-9]+", value):
            raise ValueError
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(message) from None
    if not 1 <= number < sys.maxsize:
        raise argparse.ArgumentTypeError(message)
    return number


def _ascii_decimal(value):
    """CLI numeric flags accept ASCII decimals, not Python digit/underscore syntax."""
    if not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", value):
        raise argparse.ArgumentTypeError("use a finite ASCII decimal number")
    number = float(value)
    if not math.isfinite(number):
        raise argparse.ArgumentTypeError("use a finite ASCII decimal number")
    return number


def _cover_months(value):
    try:
        number = _ascii_decimal(value)
    except argparse.ArgumentTypeError:
        raise argparse.ArgumentTypeError("months of cover must be a number from 0 to 36") from None
    if not math.isfinite(number) or not 0 <= number <= 36:
        raise argparse.ArgumentTypeError("months of cover must be a number from 0 to 36")
    return number


def _parser():
    parser = argparse.ArgumentParser(
        description="Inventory Manager: estimate local stock orders and export CSV. No orders are placed.",
        epilog="CSV goes to stdout unless -o is supplied; with -o the summary goes to stdout.")
    parser.add_argument("stock_csv", metavar="stock.csv", help="local stock/sales CSV")
    parser.add_argument("-o", "--output", metavar="orders.csv", help="write CSV to this file instead of stdout")
    parser.add_argument("--bundle", action="store_true", help="interpret stock.csv argument as a canonical bundle directory")
    parser.add_argument("--strict", action="store_true", help="reject the whole CSV on any invalid row (legacy import rules)")
    parser.add_argument("--max-bytes", type=_max_bytes, default=2 * 1024 * 1024, metavar="N",
                        help="per-file stock/receipts CSV byte limit (default: 2097152 / 2 MiB; not for --bundle)")
    parser.add_argument("--show-orders-anyway", action="store_true", help="acknowledge flagged input risks after checking missing stock/sales or future dates (all CSV imports)")
    parser.add_argument("--stock-includes-reserved", action="store_true", help="subtract a reserved/allocated stock column from stock before planning; warn if absent")
    parser.add_argument("--incoming-not-in-file", action="store_true", help="ignore undated incoming quantities and warn to check open purchase orders")
    parser.add_argument("--receipts", metavar="receipts.csv", help="confirmed receipts CSV (sku,month,quantity)")
    parser.add_argument("--today", type=_iso_date, metavar="YYYY-MM-DD", help="planning date (default: local today)")
    parser.add_argument("--settings", type=Path, help="validated settings JSON (explicit flags override it)")
    parser.add_argument("--shelf-life-days", type=_life_days, default=None, help="opt-in shelf-life purchase ceiling, 1–36500 days")
    parser.add_argument("--arrival-age-days", type=_age_days, default=None, help="life already used at arrival (default: 0)")
    parser.add_argument("--min-remaining-life-days", type=_age_days, default=None, help="minimum customer-acceptable life (default: 0)")
    parser.add_argument("--method", choices=FORECAST_METHODS, default=None,
                        help="forecast method (default: current; alternatives experimental; overrides preset)")
    parser.add_argument("--previous-methods", type=Path, metavar="methods.json",
                        help="prior Recommended choices as a JSON object mapping SKU to candidate ID; read only (otherwise stateless)")
    parser.add_argument("--preset", choices=INDUSTRY_PRESETS, default=None,
                        help="experimental industry method suggestion only; no ordering settings are tuned")
    parser.add_argument("--delivery-days", type=_delivery_days, default=None, metavar="N",
                        help="fallback supplier lead time, 1–3650 whole days (default: 14)")
    parser.add_argument("--buffer-days", type=_buffer_days, default=None, metavar="N",
                        help="add demand for 0–365 extra whole days to the purchase target (default: 0)")
    parser.add_argument("--months-of-cover", type=_cover_months, default=None, metavar="N",
                        help="order cover, 0–36 months (default: 2)")
    parser.add_argument("--service-level", type=_ascii_decimal, choices=(0.9, 0.95, 0.99), default=None,
                        help="service level for safety-stock/reorder-point estimates (default: 0.95)")
    parser.add_argument("--include-safety-stock", action="store_true", default=None,
                        help="add the existing safety-stock estimate to order quantities (on by default)")
    parser.add_argument("--learn", action="store_true", help="enable capped, gated bias correction (requires diary)")
    parser.add_argument("--stockout-adjust", action="store_true", default=None,
                        help="opt into advisory stockout median replacements for order guidance (off by default)")
    parser.add_argument("--no-correction", action="append", default=[], metavar="SKU", help="disable correction for a SKU")
    parser.add_argument("--enable-correction", action="append", default=[], metavar="SKU", help="re-enable correction for a SKU")
    decisions = parser.add_mutually_exclusive_group()
    decisions.add_argument("--approve", action="append", default=[], metavar="ID", help="approve a pending learning proposal for this snapshot")
    decisions.add_argument("--dismiss", action="append", default=[], metavar="ID", help="dismiss a pending learning proposal")
    parser.add_argument("--learning-log", type=Path, help="local append-only change log (default: diary path + .learning.jsonl)")
    parser.add_argument("--forecast-diary", type=Path, help="append forecasts to a local JSONL archive (opt-in)")
    parser.add_argument("--all", action="store_true", help="include every item, not only Order now/Order soon")
    parser.add_argument("--json", action="store_true", help="export a JSON array instead of CSV, including why_this_amount")
    parser.add_argument("--costs", action="store_true", default=None,
                        help="opt into cost fields and cost totals on stderr (off by default; settings: show_costs)")
    parser.add_argument("--profit-suggestion", action="store_true", default=None, help="show a separate simulated profit-optimal quantity; needs sale price and unit cost (off by default)")
    parser.add_argument("--explain", action="store_true", help="append why_this_amount to CSV (included automatically with --json)")
    return parser


def _export_rows(data, engine, today, settings, include_all, explain=False):
    return engine.evaluation_pass(_export_rows_pass)(data, engine, today, settings, include_all, explain)


def _export_rows_pass(data, engine, today, settings, include_all, explain=False):
    if not all(callable(getattr(engine, name, None)) for name in ("order_guidance", "order_bucket")):
        raise ValueError("This checkout is missing the shared order-guidance engine; use a complete Inventory Manager checkout.")
    rows = []
    for raw in data["items"]:
        physical = engine.forecast(raw, data["months"], data["as_of"], settings=settings, today=today)
        # Forecasts omit source sales and round stock for the chart. Guidance must
        # retain the original fractional on_hand and unmodified sales history.
        item = {**raw, **physical, "on_hand": raw["on_hand"],
                "monthly_sales": raw["monthly_sales"], "as_of": data["as_of"]}
        guidance = engine.order_guidance(item, today, settings, data["as_of"])
        bucket = engine.order_bucket(item, today, settings, data["as_of"])
        if not include_all and bucket not in ("order", "running-low"):
            continue
        rows.append({"sku": raw["sku"], "name": raw["name"], "unit": raw["unit"],
                     "status": bucket, "order_qty": guidance.get("quantity"),
                     "order_by": guidance.get("order_by"),
                     "next_confirmed_delivery": guidance.get("delivery_date"),
                     "arrives_by": _arrives_by(guidance, today),
                     "run_out": guidance.get("runout_date"), "on_hand": raw["on_hand"],
                     "on_order": raw.get("on_order"),
                     "safety_stock": guidance.get("safety_stock"),
                     "reorder_point": guidance.get("reorder_point"),
                     "reason": guidance.get("reason", "")})
        safety_notes = item.get("input_warnings", [])
        new_warnings = engine.demand_safety_warnings(raw, data["months"], guidance.get("quantity")) if not physical.get("held") else []
        output_notes = [*new_warnings]
        large = engine.big_order_warning(guidance, settings) if guidance.get("quantity") is not None else None
        if large:
            output_notes.append(large)
        if raw.get("incoming_unknown") or "on_order" not in raw and not raw.get("receipts") and "planning_facts" not in raw:
            output_notes.append("Orders already on the way were not included — subtract them before ordering.")
        if output_notes:
            rows[-1]["order_notes"] = " ".join(output_notes)
        if new_warnings:
            rows[-1]["input_warnings"] = safety_notes
        for key in ("shelf_cap_qty", "uncapped_qty", "capped", "cap_reason", "order_every_days", "coarse_warning",
                    "expiring", "expiry_at_risk_qty", "expiry_excluded_qty", "expiry_warnings", "shelf_conflict"):
            if key in guidance:
                rows[-1][key] = guidance[key]
        for key in ('profit_suggestion', 'profit_suggestion_unavailable'):
            if key in guidance:
                rows[-1][key] = guidance[key]
        if guidance.get('profit_suggestion') is not None:
            warnings = _engine_module(engine, 'profit_warnings')
            cadence = engine.resolve_order_settings(item, settings)['values']['review_days']
            warning = warnings.profit_suggestion_warning(item, guidance, cadence)
            if warning:
                rows[-1]['profit_suggestion_warning'] = warning
        method = physical.get('forecast_method')
        if isinstance(method, dict) and method.get('requested') == 'recommended':
            rows[-1]['forecast_method'] = method
        if explain:
            rows[-1]['input_warnings'] = item.get('input_warnings', [])
            rows[-1]['why_breakdown'] = engine.why_breakdown(item, today, settings, data['as_of'])
            rows[-1]['why_this_amount'] = engine.why_this_amount(item, today, settings, data['as_of'])
            if 'forecast_method' in rows[-1]:
                reason = method.get('reason') or method.get('note', '')
                label = method.get('label', '')
                rows[-1]['why_this_amount'] += ' ' + (label if 'Method picked:' in label else
                    'Method picked: ' + method['method'] + ' because ' + reason)
        if isinstance(settings, dict) and settings.get('show_costs') is True:
            rows[-1].update(_cost_display(item, guidance, engine, data, today, settings))
    return rows


COST_FIELDS = ('money_tied_up', 'incoming_value', 'order_value', 'margin_unit', 'margin_pct',
               'lost_profit_est', 'expiry_value_at_risk', 'weekly_cost', 'money_cover_weeks',
               'stock_margin', 'stock_sale_value')


def _engine_module(engine, name):
    """Follow the supplied engine's package, including standalone imports."""
    return importlib.import_module((engine.__package__ + '.' if engine.__package__ else '') + name)


def _cost_display(item, guidance, engine, data, today, settings):
    costs = _engine_module(engine, 'cost_view')
    valued = {**item, 'unit_cost': engine.resolve_order_settings(item, settings)['values']['unit_cost']}
    if isinstance(item.get('on_order'), (int, float)) and not isinstance(item.get('on_order'), bool) and math.isfinite(item['on_order']) and item['on_order'] >= 0:
        facts = engine.planning_event_facts(item, data['as_of'], today)
        guidance = {**guidance, 'incoming_qty': item['on_order'] + sum(r['quantity'] for r in engine.dated_supply(item, data['as_of'], facts) if r['date'] > engine.date_ordinal(data['as_of']))}
    metrics = costs.cost_metrics(valued, guidance)
    if not metrics:
        return {}
    # Read the existing risk sampler; no probability-to-units conversion or new
    # demand model. Unsupported/held risk stays absent, never a guessed zero.
    if 'margin_unit' in metrics and not item.get('_method_model') and not item.get('held') and guidance.get('status') != 'needs-data':
        try:
            risk = _engine_module(engine, 'risk')
            facts = engine.planning_event_facts(item, data['as_of'], today)
            receipts = [dict(date=engine.ordinal_date(r['date']), quantity=r['quantity'])
                        for r in engine.dated_supply(item, data['as_of'], facts)]
            if item.get('on_order', 0) > 0:
                receipts.append(dict(date=(date.fromisoformat(today)+timedelta(days=math.ceil(guidance['lead_days']))).isoformat(), quantity=item['on_order']))
            spec = dict(sku=item['sku'], as_of=data['as_of'][:7],
                today=(date.fromisoformat(data['as_of'])+timedelta(days=1)).isoformat(),
                history=item['monthly_sales'], forecast=[r['demand'] for r in item.get('projection', [])],
                on_hand=max(0, item['on_hand'] - guidance.get('expiry_excluded_qty', 0)), on_order=0, receipts=receipts,
                order_by=today if guidance.get('order_by') in (None, 'now') else guidance['order_by'],
                lead_days=guidance['lead_days'], cover_months=engine.resolve_order_settings(item, settings)['settings']['months_of_cover'],
                quantity=max(0, guidance.get('quantity') or 0), receipt_history=item.get('receipt_history', []),
                include_shortfall=True)
            if 'lead_multipliers' in item:
                spec['lead_multipliers'] = item['lead_multipliers']
            metrics = costs.cost_metrics(valued, guidance, risk.simulate_risk(spec))
        except (ValueError, TypeError, KeyError, OverflowError, ImportError):
            pass
    labels = [('money_tied_up','Money tied up'),('incoming_value','Incoming value'),
              ('order_value','Order value'),('margin_unit','Margin per unit'),('margin_pct','Margin %'),
              ('lost_profit_est','Lost profit estimate'),('expiry_value_at_risk','Expiry value at risk'),
              ('money_cover_weeks','Weeks of cover in money')]
    metrics['cost_explanation'] = '; '.join(label+': '+_csv_cell(metrics[key], engine) for key, label in labels if key in metrics) + '. Display only; no currency conversion. Lost profit is a scenario estimate, not a calibrated guarantee.'
    return metrics


def _arrives_by(guidance, today):
    """Lead-time arrival for the displayed order date, not a confirmed receipt.

    Reuse the planner's rounded lead_days; never re-derive it from settings.
    No order date/lead or an unsupported calendar leaves the field blank.
    """
    order_by, lead = guidance.get("order_by"), guidance.get("lead_days")
    if not order_by or isinstance(lead, bool) or not isinstance(lead, int):
        return None
    try:
        return (date.fromisoformat(today if order_by == "now" else order_by) + timedelta(days=lead)).isoformat()
    except (TypeError, ValueError, OverflowError):
        return None


def _csv_cell(value, engine):
    # Check the original type first: negative numbers are numbers, not formulas.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            return ""
        return format(Decimal(engine.planning_number(value)), "f")
    # OWASP spreadsheet formula hardening applies to every text column.
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def _write_csv(handle, rows, explain=False):
    engine, _ = _load_modules()
    money_fields = [*COST_FIELDS, 'cost_explanation'] if any('cost_explanation' in row for row in rows) else []
    method_fields = ['forecast_method'] if explain and any('forecast_method' in row for row in rows) else []
    warning_fields = ['profit_suggestion_warning'] if any('profit_suggestion_warning' in row for row in rows) else []
    fields = [*CSV_FIELDS, *(['why_this_amount'] if explain else []), *method_fields, *money_fields, *warning_fields]
    writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\r\n")
    writer.writeheader()
    writer.writerows({key: _csv_cell(json.dumps(value, ensure_ascii=False, allow_nan=False)
                                   if key == 'forecast_method' else value, engine)
                      for key, value in {**row, "reason": " ".join(filter(None, [row.get("reason", ""), row.get("order_notes", "")]))}.items() if key in fields} for row in rows)


def _write_rows(handle, rows, as_json=False, explain=False):
    if as_json:
        json.dump(rows, handle, ensure_ascii=False, allow_nan=False, indent=2)
        handle.write('\n')
    else:
        _write_csv(handle, rows, explain)


def _read_previous_methods(path, engine):
    """Caller-owned earlier choices; never read or create implicit CLI state."""
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Previous methods JSON must be no larger than 2 MiB.')
    choices = json.loads(path.read_text(encoding='utf-8-sig'))
    candidates = _engine_module(engine, 'forecast_methods').RECOMMEND_CANDIDATES
    if not isinstance(choices, dict) or any(
            not isinstance(sku, str) or not sku or len(sku) > 512
            or not isinstance(method, str) or method not in candidates
            for sku, method in choices.items()):
        raise ValueError('Previous methods must map nonempty SKUs to Recommended candidate IDs: '
                         + ', '.join(candidates) + '.')
    return choices


def _cli_import_report(report, settings):
    """Keep v1.1's import disclosure bytes when the new price views are off."""
    if settings.get('show_costs') is True or settings.get('profit_suggestion') is True:
        return report
    matched = report.get('matched', [])
    prices = [entry['source'] for entry in matched if entry.get('field') == 'sale_price']
    if not prices:
        return report
    ignored = [*report.get('ignored', []), *prices]
    headers = report.get('source_headers', [])
    return {**report, 'matched': [entry for entry in matched if entry.get('field') != 'sale_price'],
            'ignored': sorted(ignored, key=lambda name: headers.index(name) if name in headers else len(headers))}


def main(argv=None):
    engine, _ = _load_modules()
    # One snapshot-scoped pass includes events, export, report and diary. Nested
    # public engine calls reuse it; exceptions always release the context memo.
    return engine.evaluation_pass(_main)(argv)


def _main(argv=None):
    args = _parser().parse_args(argv)
    try:
        engine, sources = _load_modules()
        settings = {}
        if args.settings:
            if args.settings.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("Settings JSON must be no larger than 2 MiB.")
            saved = json.loads(args.settings.read_text(encoding="utf-8-sig"))
            # Cost visibility is a CLI presentation option, not an engine input.
            show_costs = saved.pop('show_costs', False) if isinstance(saved, dict) else False
            if not isinstance(show_costs, bool):
                raise ValueError('show_costs must be a boolean.')
            settings = engine.validate_order_settings(saved)
            settings['show_costs'] = show_costs
        if args.costs is not None:
            settings['show_costs'] = args.costs
        if args.profit_suggestion is not None:
            settings['profit_suggestion'] = args.profit_suggestion
        if args.strict and args.stock_includes_reserved:
            raise ValueError("--stock-includes-reserved requires preflight import; remove --strict to recognize the reserved column.")
        if args.bundle and args.receipts:
            raise ValueError("Choose a bundle or a receipts path, not both.")
        if args.bundle and args.max_bytes != sources.MAX_CSV_BYTES:
            raise ValueError("--max-bytes cannot change --bundle limits; use single CSV import.")
        data = (sources.load_bundle(args.stock_csv, today=args.today or date.today().isoformat()) if args.bundle
                else sources.load_csv(args.stock_csv, args.receipts, max_bytes=args.max_bytes,
                                      **({'strict': True} if args.strict else {})))
        if args.bundle and (args.stock_includes_reserved or args.incoming_not_in_file):
            raise ValueError("Input-meaning flags are for a stock CSV, not a canonical bundle.")
        if not args.bundle:
            meaning = importlib.import_module(engine.__package__ + ".input_meaning")
            data = meaning.interpret_csv(args.stock_csv, data, dict(stock_includes_reserved=args.stock_includes_reserved, incoming_not_in_file=args.incoming_not_in_file), args.today or date.today().isoformat(), strict=args.strict, max_bytes=args.max_bytes)
            print('Input meaning: ' + json.dumps(data['input_meaning'], ensure_ascii=False, separators=(',', ':')), file=sys.stderr)
            if data['input_meaning']['requires_ack'] and not args.show_orders_anyway:
                raise ValueError(' '.join(data['input_meaning']['reasons']) + ' Check the file, then use --show-orders-anyway to acknowledge these risks.')
        if 'import_report' in data:
            print('Import check: ' + json.dumps(_cli_import_report(data['import_report'], settings), ensure_ascii=False, separators=(',', ':')), file=sys.stderr)
        output = Path(args.output).expanduser() if args.output else None
        if output is not None:
            if args.bundle and output.resolve().is_relative_to(Path(args.stock_csv).expanduser().resolve()):
                raise ValueError("Output must not be inside the source bundle directory.")
            for source in (args.stock_csv, args.receipts):
                if source and (output.resolve() == Path(source).expanduser().resolve()
                               or output.exists() and output.samefile(Path(source).expanduser())):
                    raise ValueError("Output must not overwrite the stock or receipts input file.")
            if args.previous_methods and (output.resolve() == args.previous_methods.expanduser().resolve()
                    or output.exists() and output.samefile(args.previous_methods.expanduser())):
                raise ValueError('Output must not overwrite the previous methods input file.')
        if args.show_orders_anyway:
            for item in data["items"]:
                for lot in item.get("lots", []):
                    if lot.get("expiry_acknowledged") is False:
                        lot["expiry_acknowledged"] = True
        previous_methods = _read_previous_methods(args.previous_methods.expanduser(), engine) if args.previous_methods else {}
        for key, value in (("default_delivery_days", args.delivery_days), ("buffer_days", args.buffer_days),
                           ("months_of_cover", args.months_of_cover), ("service_level", args.service_level),
                           ("include_backup_in_orders", args.include_safety_stock),
                           ("stockout_adjust", args.stockout_adjust), ("profit_suggestion", args.profit_suggestion),
                           ("shelf_life_days", args.shelf_life_days), ("arrival_age_days", args.arrival_age_days),
                           ("min_remaining_life_days", args.min_remaining_life_days)):
            if value is not None:
                settings[key] = value
        preset = None
        if args.preset is not None:
            # Explicit preset opt-in suggests only a method, never order inputs.
            methods = importlib.import_module(f"{engine.__package__}.forecast_methods")
            preset = methods.PRESETS[args.preset]
            settings["industry_preset"] = args.preset
            if args.method is None:
                settings["forecast_method"] = preset["method"]
        if args.method is not None:
            settings["forecast_method"] = args.method
        if preset is not None:
            print(f"Experimental industry preset: {args.preset}. Suggested method: {preset['method']}. "
                  f"{preset['note']} Using: {settings['forecast_method']}. "
                  "Ordering settings unchanged; estimates are advisory.", file=sys.stderr)
        if args.forecast_diary:
            archive = args.forecast_diary.expanduser().resolve()
            protected = [Path(p).expanduser().resolve() for p in (args.stock_csv, args.receipts, args.output, args.previous_methods) if p]
            if any(archive == p or p.exists() and archive.exists() and archive.samefile(p) for p in protected) or args.bundle and archive.is_relative_to(protected[0]):
                raise ValueError("Learning archive must be separate from inputs and output.")
            learning = importlib.import_module(engine.__package__ + ".learning")
            log_path = (args.learning_log or Path(str(archive)+'.learning.jsonl')).expanduser().resolve()
            if any(log_path == p or p.exists() and log_path.exists() and log_path.samefile(p) for p in protected+[archive]) or args.bundle and log_path.is_relative_to(protected[0]):
                raise ValueError("Learning log must be separate from inputs, output and diary.")
            log = learning.read_jsonl(log_path)
            diary = learning.read_jsonl(archive)
            if set(args.no_correction) & set(args.enable_correction):
                raise ValueError('Choose disable or enable per SKU.')
            toggles = []
            for enabled, skus in ((False,args.no_correction),(True,args.enable_correction)):
                for sku in skus:
                    event = learning.learning_event(data['as_of'], sku, dict(kind='correction_enabled' if enabled else 'correction_disabled',
                        state='enabled' if enabled else 'disabled', reason='Owner enabled' if enabled else 'Owner undo', before=[], after=[]), log+toggles)
                    if event:
                        toggles.append(event)
            learn_settings = engine.learning_settings_from_log(data, dict(learning_enabled=args.learn), log+toggles)
            events = toggles + engine.learning_events(data, diary, learn_settings, log+toggles)
            for action, ids in [('approve', args.approve), ('dismiss', args.dismiss)]:
                for proposal_id in ids:
                    decision = engine.learning_decision(data, diary, learn_settings, log+events, proposal_id, action)
                    learn_settings = decision['settings']; events.extend(decision['events'])
            events.extend(engine.learning_events(data, diary, learn_settings, log+events))
            learning.append_jsonl(log_path, events)
            log = learning.read_jsonl(log_path)
            data = engine.prepare_learning(data, diary, learn_settings)
        elif args.learn or args.learning_log or args.approve or args.dismiss or args.no_correction or args.enable_correction:
            raise ValueError("Learning controls require --forecast-diary.")
        today = args.today or date.today().isoformat()
        if settings.get('forecast_method') == 'recommended' and previous_methods:
            # The mapping asserts earlier, same-adjustment-mode choices. Seed the
            # existing adapter's carried-choice contract; it still fits and gates
            # each current history, rather than forcing a method or a quantity.
            prior_month = engine.month_after(data['months'][-1], -1)
            data = {**data, 'items': [
                {**item, 'forecast_method': {'requested': 'recommended', 'method': previous_methods[item['sku']]},
                 '_method_model': {'recommend_input': [prior_month, [], settings.get('stockout_adjust') is True]}}
                if item['sku'] in previous_methods else item for item in data['items']]}
        all_rows = _export_rows(data, engine, today, settings, True, args.json or args.explain)
        needs_data = sum(row["status"] == "needs-data" for row in all_rows)
        rows = all_rows if args.all else [row for row in all_rows if row["status"] in ("order", "running-low")]
        if output is None:
            _write_rows(sys.stdout, rows, args.json, args.explain)
            sys.stdout.flush()
        else:
            with output.open("w", newline="", encoding="utf-8" if args.json else "utf-8-sig") as handle:
                _write_rows(handle, rows, args.json, args.explain)
        summary_handle = sys.stdout if output is not None else sys.stderr
        if args.forecast_diary:
            score = engine.learning_report(data, diary, learn_settings, log)
            learning.append_jsonl(archive, engine.forecast_diary(data))
            accuracy = 'pending' if score['accuracy'] is None else f"{score['accuracy']:.1%}"
            delta = 'pending' if score['change'] is None else f"{score['change']*100:+.1f} pp"
            print(f"Accuracy: {accuracy}; monthly change {delta}; {score['count']} matured months; methods {score['methods']}; automatic changes {len(score['changes'])}.", file=summary_handle)
            for proposal in score['pending']:
                print(f"Pending {proposal['sku']}: {proposal['id']} (use --approve or --dismiss)", file=summary_handle)
        age = engine.sales_data_age(data["months"], today)
        if age is not None and age > 45:
            print(f"Your sales data ends {engine.month_label(data['months'][-1])} ({age:g} days ago). Numbers may be out of date — load a newer file.", file=summary_handle)
        if settings.get('show_costs') is True:
            costs = _engine_module(engine, 'cost_view')
            totals = costs.cost_totals([{k: row[k] for k in COST_FIELDS if k in row} for row in rows])
            if totals['coverage']:
                print('Cost totals (exported products; known inputs only): '+json.dumps(totals, allow_nan=False), file=sys.stderr)
        print(f"{len(rows)} items exported (of {len(data['items'])}). {needs_data} items need data (use --all to include them). Estimates only; no orders placed.", file=summary_handle)
        return 0
    except (OSError, UnicodeError, ValueError, csv.Error) as error:
        if hasattr(error, 'import_report'):
            print('Import check: ' + json.dumps(error.import_report, ensure_ascii=False, separators=(',', ':')), file=sys.stderr)
        print(f"stock_runway.py: error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
