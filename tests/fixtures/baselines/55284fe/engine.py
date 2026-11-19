"""Pure stock runway calculations. No I/O and no third-party dependencies."""
from __future__ import annotations

import calendar
import math
import re
from datetime import date
from fractions import Fraction
from decimal import Decimal


# Shared with browser validation. Reserve a full forecast year and lead-time headroom.
MAX_QUANTITY = 10**12
MAX_SUPPLIER_DAYS = 3650
MAX_AGGREGATE = 10**18
MONTH_RANGE_REASON = "Sales months must be from 1000-01 through 9998-12."


def valid_month(month):
    return isinstance(month, str) and bool(re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", month)) and "1000-01" <= month <= "9998-12"


def history_reason(months):
    if not isinstance(months, list) or not months or any(not valid_month(m) for m in months):
        return MONTH_RANGE_REASON
    if any(month_after(a, 1) != b for a, b in zip(months, months[1:])):
        return "Monthly sales columns must be consecutive full months."
    return None


def quantity(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and 0 <= value <= MAX_QUANTITY


def bounded(value):
    if not math.isfinite(value) or abs(value) > MAX_AGGREGATE:
        raise ValueError("Calculation exceeds supported arithmetic range.")
    return value


def held_item(item, reason="Couldn't calculate: check this item's data."):
    return {"sku": item.get("sku") if isinstance(item, dict) and isinstance(item.get("sku"), str) else "Item",
            "name": item.get("name") if isinstance(item, dict) and isinstance(item.get("name"), str) else "Item",
            "held": True, "reason": reason}


def month_after(month: str, offset: int) -> str:
    year, number = map(int, month.split("-"))
    number += offset
    year += (number - 1) // 12
    number = (number - 1) % 12 + 1
    if not 1 <= year <= 9999:
        raise ValueError("Forecast dates exceed the supported calendar.")
    return f"{year:04d}-{number:02d}"


def month_label(month: str) -> str:
    year, number = map(int, month.split("-"))
    return f"{calendar.month_abbr[number]} {year}"


def validate_item(item: dict) -> str | None:
    if item.get("hold_reason"):
        return item["hold_reason"]
    for field in ("sku", "name", "unit"):
        if not isinstance(item.get(field), str) or not item[field].strip():
            return f"Missing or invalid {field}."
    for field in ("on_hand",) + (("on_order",) if "on_order" in item else ()):
        value = item.get(field)
        if not quantity(value):
            return f"{field.replace('_', ' ').capitalize()} must be a non-negative number no greater than 1000000000000."
    days = item.get("supplier_days")
    if days is not None and (isinstance(days, bool) or not isinstance(days, (int, float)) or not math.isfinite(days) or not 0 <= days <= MAX_SUPPLIER_DAYS):
        return "Supplier days must be from 0 to 3650 when supplied."
    sales = item.get("monthly_sales")
    if not isinstance(sales, list) or not sales:
        return "Monthly sales history is missing."
    if any(not quantity(x) for x in sales):
        return "Monthly sales must contain only non-negative numbers no greater than 1000000000000."
    if len(sales) < 3:
        return "At least 3 full months of sales are needed to forecast."
    return None


SEASONAL_REASON = "Needs 12 months of sales for seasonal ups and downs"
SEASONAL_COPY = "Forecast follows last year's seasonal pattern, scaled to the last 3 months"


def demand_model(sales, last_month, *, summation=sum):
    """Repeat the last year's calendar pattern, with noisy factors clamped."""
    factors = [1.0] * 12
    seasonal = len(sales) >= 12
    if seasonal:
        base = summation(sales[-12:]) / 12
        for i, value in enumerate(sales[-12:]):
            factors[(int(last_month[5:7]) + i) % 12] = max(0.5, min(2.0, value / base)) if base else 1.0
    level = summation(sales[i] / factors[(int(last_month[5:7]) + i - len(sales)) % 12]
                for i in range(len(sales) - 3, len(sales))) / 3
    return {"seasonal": seasonal, "factors": factors, "level": level}


def corrected_integer(value):
    """Suppress only roundoff within four ULPs, as in seasonal demand."""
    nearest = round(value)
    return nearest if nearest > 0 and abs(value - nearest) <= 4 * math.ulp(value) else value


def planning_ceil(value):
    return max(0, math.ceil(corrected_integer(value)))


def month_demand(model, month):
    value = model["level"] * model["factors"][int(month[5:7]) - 1]
    if model["seasonal"] and model["factors"][int(month[5:7]) - 1] != 1:
        value = corrected_integer(value)
    # Demand remains fractional; only the final purchase uses MOQ/pack ceilings.
    return max(0, value)


# The Desktop's existing order-cover convention is 30 days per month.
DAYS_PER_MONTH = 30
SERVICE_Z = {0.90: 1.2816, 0.95: 1.6449, 0.99: 2.3263}
DEFAULT_ORDER_SETTINGS = {"default_delivery_days": 14, "months_of_cover": 2,
    "overstock_months": 6, "big_order_months": 6, "buffer_days": 7, "urgent_days": 7, "running_low_days": 30,
    "service_level": 0.95, "review_days": 30, "order_cost": None,
    "holding_pct": 20, "include_backup_in_orders": False, "product_overrides": {}}


def setting_number(value, minimum, maximum, integer=False):
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and minimum <= value <= maximum and math.isfinite(value)
            and (not integer or int(value) == value))


def normalize_order_settings(value=None):
    value = value if isinstance(value, dict) else {}
    fields = {**DEFAULT_ORDER_SETTINGS, "product_overrides": {}}
    for key, low, high, integer in (("default_delivery_days", 1, MAX_SUPPLIER_DAYS, True),
            ("months_of_cover", 0, 36, False), ("overstock_months", .1, 120, False),
            ("big_order_months", .1, 120, False),
            ("urgent_days", 0, 3650, True), ("running_low_days", 0, 3650, True),
            ("buffer_days", 0, 3650, True),
            ("review_days", 0, 3650, True), ("order_cost", 0, MAX_QUANTITY, False),
            ("holding_pct", .01, 100, False)):
        if setting_number(value.get(key), low, high, integer):
            fields[key] = value[key]
    # Preserve old saved 0..3650 values safely, but never retain >1 year margin.
    fields["buffer_days"] = min(365, fields["buffer_days"])
    if "default_delivery_days" in value and value["default_delivery_days"] is None:
        fields["default_delivery_days"] = None
    if setting_number(value.get("service_level"), .90, .99) and value["service_level"] in SERVICE_Z:
        fields["service_level"] = value["service_level"]
    fields["include_backup_in_orders"] = value.get("include_backup_in_orders") is True
    overrides = value.get("product_overrides")
    if isinstance(overrides, dict):
        for sku, entry in overrides.items():
            if not isinstance(entry, dict):
                continue
            normalized = {k: entry[k] for k in ("minimum_order", "pack_size", "unit_cost")
                          if setting_number(entry.get(k), 0 if k == "unit_cost" else float.fromhex('0x0.0000000000001p-1022'), MAX_QUANTITY)}
            if normalized:
                fields["product_overrides"][sku] = normalized
    return fields


def valid_order_increment(value):
    return setting_number(value, .000001, MAX_QUANTITY) and (Fraction(str(value)) * 1000000).denominator == 1


def suggested_order_quantity(forecast_demand, on_hand, receipts, override=None, *, safety_stock=None, include_backup_in_orders=False, on_order=0):
    """Exact-decimal purchase rounding; backup is opt-in and precedes MOQ/packs.

    Callers supply their forecast window; safety_order_planning uses Desktop's
    physical-runout calendar window without changing the legacy forecast.
    """
    override = override or {}
    need = Fraction(str(forecast_demand)) - Fraction(str(on_hand))
    need -= Fraction(str(on_order))
    for receipt in receipts:
        need -= Fraction(str(receipt))
    if include_backup_in_orders and safety_stock is not None:
        need += Fraction(str(safety_stock))
    return planning_round_order(need, override)


def planning_round_order(value, override):
    for key in ("minimum_order", "pack_size"):
        raw = override.get(key)
        if raw is None or raw == "" or key == "minimum_order" and not isinstance(raw, bool) and raw == 0:
            continue
        if not valid_order_increment(raw):
            return None
    if value <= 0:
        return 0
    exact = value if isinstance(value, Fraction) else Fraction(str(corrected_integer(value)))
    need = max(exact, Fraction(str(override.get("minimum_order") or 0)))
    pack = Fraction(str(override.get("pack_size") or 1))
    total = math.ceil(need / pack) * pack
    result = float(total)
    return result if result <= 9007199254740991 and Fraction(str(result)) == total else None


def planning_calendar_demand(model, last_month, days):
    """Demand from the snapshot month-end, using each month's daily rate."""
    total, month = 0, month_after(last_month, 1)
    while days > 0:
        year, number = map(int, month.split("-"))
        length = calendar.monthrange(year, number)[1]
        elapsed = min(days, length)
        total += month_demand(model, month) * elapsed / length
        days -= elapsed
        if days > 0:
            month = month_after(month, 1)
    return total


def planning_number(value):
    """Match JS's plain numeric sentence formatting without six-digit loss."""
    if value == 0:
        return "0"
    if 1e-6 <= abs(value) < 1e21:
        text = format(Decimal(str(value)), 'f')
        return text.rstrip('0').rstrip('.') if '.' in text else text
    return re.sub(r'e([+-])0+(\d+)', r'e\1\2', str(value))


def planning_sum(values):
    """Stable JS-order binary64 addition, independent of Python's builtin sum."""
    total = 0.0
    for value in values:
        total += value
    return total


def sales_pattern(sigma, mean):
    """Plain display bucket only; does not affect forecasts or purchases."""
    if sigma is None:
        return None
    variation = sigma / mean if mean > 0 else (0 if sigma == 0 else math.inf)
    return "Steady" if variation < .25 else "Up and down" if variation < .6 else "Very uneven"


def planning_display_number(value):
    """Group the integer part without changing precision in planning text."""
    whole, dot, fraction = planning_number(value).partition(".")
    if "e" in whole or "e" in fraction:
        return planning_number(value)
    return f"{int(whole):,}" + (dot + fraction if dot else "")


def stockout_history(item, last_month):
    """Adopt the lab's exposure correction without mutating observed history.

    Eligibility is independent of the lab's numeric zero: an entirely unavailable
    lost-sales month is unobserved, never a zero in the model denominator.
    """
    result = dict(state="hidden", needs="")
    facts = item.get("planning_facts")
    if not isinstance(facts, dict) or ("sales_history" not in facts and not isinstance(facts.get("errors"), dict)):
        return result
    errors = facts.get("errors", {})
    if "sales_history" not in facts and not errors.get("stockout_correction"):
        return result
    project_rows = facts.get("sales_history")
    if (isinstance(errors, dict) and not errors.get('stockout_correction') and isinstance(project_rows, list)
            and any(isinstance(r, dict) and 'project' in r for r in project_rows)
            and not any(isinstance(r, dict) and ('in_stock_days' in r or 'backorder' in r) for r in project_rows)):
        return result
    def locked(reason="HOLD: stockout history needs complete exposure and lost-sales policy."):
        result.update(state="locked", needs=reason)
        return result
    sales = item.get("monthly_sales")
    rows = facts.get("sales_history")
    if (facts.get("version") != "1.0" or not isinstance(errors, dict)
            or any(not isinstance(v, list) or any(not isinstance(c, str) or not c for c in v) for v in errors.values()) or errors.get("stockout_correction")
            or not isinstance(rows, list) or not rows or len(rows) > 10000
            or not isinstance(sales, list) or len(sales) < 3 or len(rows) != len(sales) or any(not quantity(v) for v in sales)
            or not valid_month(last_month)):
        return locked()
    months = [month_after(last_month, i - len(sales) + 1) for i in range(len(sales))]
    by_month = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("month"), str) or row.get("month") in by_month:
            return locked()
        month = row.get("month")
        if month not in months or row.get("sku") != item.get("sku"):
            return locked()
        value, exposed = row.get("quantity"), row.get("in_stock_days")
        days = calendar.monthrange(*map(int, month.split('-')))[1]
        if (not quantity(value) or value != sales[months.index(month)]
                or not setting_number(exposed, 0, days, True) or not isinstance(row.get("backorder"), bool)
                or not row["backorder"] and exposed == 0 and value > 0):
            return locked()
        by_month[month] = row
    if set(by_month) != set(months):
        return locked()
    try:
        try:
            from .forecast_lab import clean_demand
        except ImportError:
            from forecast_lab import clean_demand
        inputs = [dict(sku=item.get('sku'), month=m, demand=by_month[m]['quantity'],
                       in_stock_days=by_month[m]['in_stock_days'],
                       days_in_month=calendar.monthrange(*map(int,m.split('-')))[1],
                       backorder=by_month[m]['backorder']) for m in months]
        cleaned = clean_demand(inputs)
    except (ValueError, TypeError, OverflowError):
        return locked()
    eligible = [not (not by_month[m]['backorder'] and by_month[m]['in_stock_days'] == 0) for m in months]
    corrected = [r['demand'] for r in cleaned['rows']]
    observed = [v for v, keep in zip(corrected, eligible) if keep]
    result.update(months=months, raw=list(sales), corrected=corrected, eligible=eligible,
                  eligible_months=[m for m, keep in zip(months, eligible) if keep],
                  censored_months=[m for m, keep in zip(months, eligible) if not keep],
                  trace=[t for t in cleaned['trace'] if t['step'] == 'stockout_correction'],
                  flags=cleaned['flags'])
    if len(observed) < 3:
        return locked("HOLD: stockout correction needs at least 3 eligible observed months.")
    # Never feed a compacted gapped series into calendar seasonal indexing.
    model = (dict(seasonal=False, factors=[1.0]*12, level=planning_sum(observed[-3:])/3)
             if not all(eligible) else demand_model(corrected, last_month, summation=planning_sum))
    result.update(state="on", needs="", model=model)
    return result


def project_facts(item, last_month):
    """Project evidence is separate from exposure; absence never means false."""
    result = dict(state="hidden", needs="")
    facts = item.get("planning_facts")
    if not isinstance(facts, dict):
        return result
    rows, errors = facts.get("sales_history"), facts.get("errors", {})
    present = (isinstance(rows, list) and any(isinstance(r, dict) and "project" in r for r in rows)
               or isinstance(errors, dict) and bool(errors.get("project_exclusion")))
    if not present:
        return result
    def locked():
        result.update(state="locked", needs="HOLD: project exclusion needs complete explicit project flags.")
        return result
    sales = item.get("monthly_sales")
    if (facts.get("version") != "1.0" or not isinstance(errors, dict)
            or any(not isinstance(v, list) or any(not isinstance(c, str) or not c for c in v) for v in errors.values())
            or errors.get("project_exclusion") or not isinstance(rows, list) or not rows or len(rows) > 10000
            or not isinstance(sales, list) or len(sales) < 3 or len(rows) != len(sales)
            or any(not quantity(v) for v in sales) or not valid_month(last_month)):
        return locked()
    months = [month_after(last_month, i-len(sales)+1) for i in range(len(sales))]
    positions, by_month = {m:i for i,m in enumerate(months)}, {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('month'), str):
            return locked()
        month = row['month']
        if (month not in positions or month in by_month or row.get('sku') != item.get('sku')
                or not quantity(row.get('quantity')) or row['quantity'] != sales[positions[month]]
                or not isinstance(row.get('project'), bool)):
            return locked()
        by_month[month] = row
    result.update(state="on", months=months, rows=[by_month[m] for m in months])
    return result


def cleaned_history(item, last_month):
    """One ordered raw -> stockout -> project adoption; suggestions never change it."""
    projects = project_facts(item, last_month)
    base = stockout_history(item, last_month)
    if projects['state'] == 'hidden':
        return base  # preserve every feature-3 field/byte when flags are absent
    result = {**base, 'project_state': projects['state'], 'stockout_state': base['state'],
              'outlier_suggestions': dict(state='locked', needs='valid eligible history', chip='Check spike', months=[])}
    def locked(needs):
        result.update(state='locked', needs=needs, project_state='locked')
        result.pop('model', None)
        return result
    if projects['state'] == 'locked':
        return locked(' '.join(n for n in (base['needs'], projects['needs']) if n))
    if base['state'] == 'locked':
        return locked(base['needs'])
    months, rows = projects['months'], projects['rows']
    try:
        try:
            from .forecast_lab import clean_demand
        except ImportError:
            from forecast_lab import clean_demand
        inputs = []
        for row in rows:
            r = dict(sku=item.get('sku'), month=row['month'], demand=row['quantity'], one_off=row['project'])
            if base['state'] == 'on':
                r.update(in_stock_days=row['in_stock_days'],
                         days_in_month=calendar.monthrange(*map(int,row['month'].split('-')))[1],
                         backorder=row['backorder'])
            inputs.append(r)
        cleaned = clean_demand(inputs)
    except (ValueError, TypeError, OverflowError):
        return locked('HOLD: project exclusion could not validate the cleaning pipeline.')
    flags = [row['project'] for row in rows]
    stockout_eligible = base['eligible'] if base['state'] == 'on' else [True]*len(months)
    eligible = [keep and not project for keep,project in zip(stockout_eligible, flags)]
    corrected = [t['after'] for t in cleaned['trace'] if t['step'] == 'stockout_correction']
    after_projects = [r['demand'] for r in cleaned['rows']]
    observed = [v for v,keep in zip(after_projects, eligible) if keep]
    result.update(months=months, raw=list(item['monthly_sales']), corrected=corrected,
                  stockout_eligible=stockout_eligible, after_projects=after_projects,
                  eligible=eligible, eligible_months=[m for m,keep in zip(months,eligible) if keep],
                  censored_months=[m for m,keep in zip(months,stockout_eligible) if not keep],
                  project_flags=flags, project_months=[m for m,project in zip(months,flags) if project],
                  project_excluded_count=flags.count(True),
                  trace=[t for t in cleaned['trace'] if t['step'] in ('stockout_correction','project_exclusion')],
                  flags=cleaned['flags'])
    result['outlier_suggestions']['needs'] = '6 eligible months'
    if len(observed) < 3:
        return locked('HOLD: project exclusion needs at least 3 eligible observed months.')
    model = (dict(seasonal=False, factors=[1.0]*12, level=planning_sum(observed[-3:])/3)
             if not all(eligible) else demand_model(observed, last_month, summation=planning_sum))
    suggestions = dict(state='locked', needs='6 eligible months', chip='Check spike', months=[])
    if len(observed) >= 6:
        # The diagnostic pass starts from eligible RAW inputs, never corrected
        # values; it neither uplifts twice nor returns adopted quantities.
        suggestion_inputs = [r for r,keep in zip(inputs,eligible) if keep]
        diagnostic = clean_demand(suggestion_inputs, suggest_outliers=True)
        suggestion_flags = [f for f in diagnostic['flags'] if f['code'] == 'outlier_suggestion']
        suggestions.update(state='on', needs='', months=[f['month'] for f in suggestion_flags])
        result['flags'] += suggestion_flags
    result.update(state='on', needs='', project_state='on', model=model, outlier_suggestions=suggestions)
    return result


def manual_change(item):
    """Explicit per-SKU percentage; unknown never becomes a zero adjustment."""
    if 'demand_change_pct' not in item:
        return dict(state='hidden', needs='')
    value = item['demand_change_pct']
    if not setting_number(value, -90, 300):
        return dict(state='locked', needs='HOLD: demand_change_pct must be a number from -90 to 300.')
    return dict(state='on', needs='', percent=value)


def adopted_history(item, last_month):
    base = cleaned_history(item, last_month)
    manual = manual_change(item)
    if manual['state'] == 'hidden':
        return base
    result = {**base, 'manual_state': manual['state']}
    if manual['state'] == 'locked' or base['state'] == 'locked':
        result.update(state='locked', needs=' '.join(n for n in (base['needs'], manual['needs']) if n), manual_state='locked')
        result.pop('model', None)
        return result
    sales = item.get('monthly_sales')
    if not isinstance(sales, list) or len(sales) < 3 or any(not quantity(v) for v in sales) or not valid_month(last_month):
        result.update(state='locked', needs='HOLD: manual change needs valid monthly history.', manual_state='locked')
        return result
    if base['state'] == 'hidden':
        months = [month_after(last_month, i-len(sales)+1) for i in range(len(sales))]
        result.update(months=months, raw=list(sales), corrected=list(sales), eligible=[True]*len(sales),
                      eligible_months=months, censored_months=[], trace=[], flags=[])
    before = result.get('after_projects', result['corrected'])
    # Same binary64 order as JS; adjustment runs after eligibility/cleaning.
    adjusted = list(before) if manual['percent'] == 0 else [v * (100 + manual['percent']) / 100 for v in before]
    observed = [v for v,keep in zip(adjusted, result['eligible']) if keep]
    model = (demand_model(adjusted, last_month, summation=planning_sum) if all(result['eligible']) else
             dict(seasonal=False, factors=[1.0]*12, level=planning_sum(observed[-3:])/3))
    result.update(state='on', needs='', manual_percent=manual['percent'], adjusted=adjusted, model=model,
                  trace=result['trace'] + [dict(step='manual_change', sku=item.get('sku'), month=m, before=b, after=a)
                                          for m,b,a in zip(result['months'], before, adjusted)])
    return result


def planning_history(item, last_month):
    history = adopted_history(item, last_month)
    if history["state"] == "on":
        return [v for v, keep in zip(history.get("adjusted", history["corrected"]), history["eligible"]) if keep], history["model"]
    sales = item.get("monthly_sales")
    return sales, demand_model(sales, last_month, summation=planning_sum)


def inventory_planning(item, last_month, raw_settings=None):
    """Optional estimates: never change the existing forecast or run-out path."""
    settings = normalize_order_settings(raw_settings)
    result = {"demand_swing": None, "safety_stock": None, "reorder_point": None, "eoq": None, "why": ""}
    sales = item.get("monthly_sales")
    if not isinstance(sales, list) or len(sales) < 3 or any(not quantity(x) for x in sales):
        return result
    sales, model = planning_history(item, last_month)
    recent = sales[-12:]
    # Explicit binary64 left-to-right operations match JS, including on Python
    # 3.12+ where builtin sum uses compensated addition. Squaring by multiply
    # also avoids platform libm pow rounding differences.
    total = 0.0
    for value in recent:
        total += value
    mean = total / len(recent)
    squared = 0.0
    for value in recent:
        delta = value - mean
        squared += delta * delta
    sigma = math.sqrt(squared / len(recent))
    result["demand_swing"] = sigma
    lead = item.get("supplier_days")
    if lead is None:
        lead = settings["default_delivery_days"]
    parts = []
    if setting_number(lead, 0, MAX_SUPPLIER_DAYS):
        backup = planning_ceil(SERVICE_Z[settings["service_level"]] * sigma * math.sqrt((lead + settings["review_days"]) / DAYS_PER_MONTH))
        result["safety_stock"] = backup
        parts.append(f"Safety stock {planning_display_number(backup)} because sales are {(sales_pattern(sigma, mean) or 'Steady').lower()} and lead time is {planning_display_number(lead)} days")
        try:
            buffer = min(settings["buffer_days"], math.ceil(settings["months_of_cover"] * DAYS_PER_MONTH))
            result["reorder_point"] = planning_ceil(planning_calendar_demand(model, last_month, lead + buffer) + backup)
            parts.append(f"Reorder point {planning_display_number(result['reorder_point'])}")
        except (ValueError, OverflowError):
            pass  # Optional planning cannot hold an otherwise valid legacy forecast.
    override = settings["product_overrides"].get(item.get("sku"), {})
    raw_override = (raw_settings or {}).get("product_overrides", {}) if isinstance(raw_settings, dict) else {}
    raw_override = raw_override.get(item.get("sku"), {}) if isinstance(raw_override, dict) else {}
    if not isinstance(raw_override, dict):
        raw_override = {}
    cost = override.get("unit_cost", item.get("unit_cost"))
    if settings["order_cost"] and setting_number(cost, float.fromhex('0x0.0000000000001p-1022'), MAX_QUANTITY):
        try:
            annual = planning_sum(month_demand(model, month_after(last_month, n)) for n in range(1, 13))
            denominator = cost * settings["holding_pct"] / 100
            raw = math.sqrt(2 * annual * settings["order_cost"] / denominator) if denominator else math.inf
            result["eoq"] = planning_round_order(raw, raw_override) if math.isfinite(raw) else None
        except (ValueError, OverflowError):
            pass
        if result["eoq"] is not None:
            parts.append(f"EOQ {planning_display_number(result['eoq'])}")
    if parts:
        result["why"] = ". ".join(parts) + "."
    return result



def planning_demand_until(model, as_of, endpoint):
    """Desktop calendarDemand: snapshot-exclusive, exact partial-month demand."""
    snapshot = date.fromisoformat(as_of).toordinal()
    if endpoint <= snapshot:
        return Fraction(0)
    end = date.fromordinal(endpoint)
    month = month_after(as_of[:7], 1)
    end_month = end.isoformat()[:7]
    whole = 0.0
    while month <= end_month:
        demand = month_demand(model, month)
        if month == end_month:
            days = calendar.monthrange(end.year, end.month)[1]
            return Fraction(str(whole)) + Fraction(str(demand)) * end.day / days
        whole = bounded(whole + demand)
        month = month_after(month, 1)
    raise ValueError("Forecast dates exceed the supported calendar.")


def planning_runout(item, as_of, model, stock=None):
    """Desktop guidanceCalendar's first physical crossing, beyond the horizon.

    Receipts arrive at month start. Jump whole seasonal years only after the
    last receipt; never erase the first shortage if a later delivery restores it.
    """
    balance = float(math.floor(item["on_hand"] if stock is None else stock))
    year, month = map(int, as_of[:7].split("-"))
    index, last_index = year * 12 + month, 9999 * 12 + 11
    events = [m for m in item.get("receipts", {}) if m > as_of[:7]]
    last_receipt = max((int(m[:4]) * 12 + int(m[5:7]) - 1 for m in events), default=index - 1)
    annual = planning_sum(month_demand(model, f"2000-{n:02d}") for n in range(1, 13))
    while index <= last_index:
        if index > last_receipt:
            if annual == 0:
                break
            years = max(0, math.ceil(balance / annual) - 1)
            if years > 0:
                index += years * 12
                if index > last_index:
                    raise ValueError("Estimated run-out exceeds the supported calendar.")
                balance = bounded(balance - years * annual)
        year, zero_month = divmod(index, 12)
        month = f"{year:04d}-{zero_month + 1:02d}"
        demand, receipt = month_demand(model, month), item.get("receipts", {}).get(month, 0)
        if demand > 0 and balance - demand + receipt <= 0:
            days = calendar.monthrange(year, zero_month + 1)[1]
            elapsed = math.ceil(Fraction(str(max(0, balance + receipt))) * days / Fraction(str(demand)))
            return date(year, zero_month + 1, max(1, min(days, elapsed))).toordinal()
        balance = bounded(balance - demand + receipt)
        index += 1
    if annual > 0 and index > last_index:
        raise ValueError("Estimated run-out exceeds the supported calendar.")
    return None


def safety_order_planning(item, last_month, as_of, physical, raw_settings=None, today=None):
    """Optional Desktop purchase guidance, without changing legacy forecast fields.

    Quantity uses the physical crossing's order window, not inventory position's
    later crossing. Undated incoming reduces purchases but is no receipt event.
    The default date is the snapshot, keeping direct engine calls deterministic.
    """
    if "planning_facts" in item or "demand_change_pct" in item:
        current = today.isoformat() if isinstance(today, date) else today or as_of
        guidance = order_guidance({**item, **physical, "as_of": as_of}, current, raw_settings, as_of)
        return dict(inventory_position=inventory_position(item), suggested_order=guidance.get("quantity"),
                    covered_by_on_order=guidance.get("covered_by_on_order", False), big_order=guidance.get("big_order", False),
                    **({"on_order": item["on_order"]} if "on_order" in item else {}))
    settings = normalize_order_settings(raw_settings)
    on_order = item.get("on_order", 0)
    position = Fraction(str(item["on_hand"])) + Fraction(str(on_order))
    result = {"inventory_position": float(position), "suggested_order": None,
              "covered_by_on_order": False, "big_order": False}
    if "on_order" in item:
        result["on_order"] = on_order
    lead = item.get("supplier_days")
    if lead is None:
        lead = settings["default_delivery_days"]
    if not setting_number(lead, 0, MAX_SUPPLIER_DAYS):
        return result
    lead = math.ceil(lead)
    model = demand_model(item["monthly_sales"], last_month, summation=planning_sum)
    try:
        current = today if today is not None else as_of
        current = current.toordinal() if isinstance(current, date) else date.fromisoformat(current).toordinal()
        snapshot = date.fromisoformat(as_of).toordinal()
        receipts = item.get("receipts", {})
        for month, amount in receipts.items():
            if not re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", month) or not quantity(amount):
                return result
        runout = planning_runout(item, as_of, model)
        # Match Desktop's calendar validity checks even though the legacy
        # physical order_by field is deliberately not replaced by this opt-in.
        position_runout = planning_runout(item, as_of, model, position) if on_order > 0 else runout
        if position_runout is not None:
            # Same buffered deadline/calendar guard as Desktop snapshotSafety.
            if ordinal_date(position_runout - lead - min(settings["buffer_days"], math.ceil(settings["months_of_cover"] * DAYS_PER_MONTH))) is None:
                return result
        order_date = max(current, runout - lead if runout is not None else current)
        endpoint = order_date + lead + math.ceil(settings["months_of_cover"] * DAYS_PER_MONTH)
        date.fromordinal(endpoint)
        included = [amount for month, amount in receipts.items()
                    if snapshot < date.fromisoformat(f"{month}-01").toordinal() <= endpoint]
        if planning_sum(included) > MAX_AGGREGATE:
            return result
        overrides = raw_settings.get("product_overrides", {}) if isinstance(raw_settings, dict) else {}
        override = overrides.get(item.get("sku"), {}) if isinstance(overrides, dict) else {}
        override = override if isinstance(override, dict) else {}
        suggested = suggested_order_quantity(planning_demand_until(model, as_of, endpoint),
            item["on_hand"], included, override, on_order=on_order,
            safety_stock=physical.get("safety_stock"), include_backup_in_orders=settings["include_backup_in_orders"])
    except (ValueError, OverflowError, TypeError):
        return result  # Optional planning must never hold the physical result.
    result["suggested_order"] = suggested
    if suggested is not None:
        result["big_order"] = suggested > physical["monthly_demand"] * settings["big_order_months"]
        result["covered_by_on_order"] = bool(on_order > 0 and runout is not None and current + lead <= runout)
    return result


# Purchase guidance is an additive Desktop mirror. Legacy forecast dates above
# remain physical chart dates, never the purchase planner's 'now' sentinel.
SKIP_REASONS = ("Already ordered", "Not selling anymore", "One-off sale", "Other")
ORDER_BUCKET_LABELS = {"order": "Order now", "running-low": "Order soon", "healthy": "OK",
                       "no-sales": "No sales", "overstocked": "Overstocked", "needs-data": "Not enough history"}


def date_ordinal(value):
    """Strict date parsing, with Python ordinals (only differences are exposed)."""
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        return None
    try:
        return date.fromisoformat(value).toordinal()
    except ValueError:
        return None


def ordinal_date(value):
    try:
        return date.fromordinal(value).isoformat() if isinstance(value, int) and 1000 <= date.fromordinal(value).year <= 9999 else None
    except (ValueError, OverflowError):
        return None


def month_end_ordinal(month):
    if not isinstance(month, str) or not re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", month):
        return None
    year, number = map(int, month.split("-"))
    return date(year, number, calendar.monthrange(year, number)[1]).toordinal()


def active_skip(settings, sku, today, as_of):
    entries = settings.get("skipped_items", {}) if isinstance(settings, dict) else {}
    entry = entries.get(sku) if isinstance(entries, dict) else None
    if not isinstance(entry, dict):
        return None
    now, start = date_ordinal(today), date_ordinal(entry.get("skipped_on"))
    return entry if (entry.get("reason") in SKIP_REASONS and now is not None and start is not None
                     and start <= now < start + 14 and isinstance(as_of, str)
                     and isinstance(entry.get("as_of"), str) and as_of <= entry["as_of"]) else None


def sales_data_age(months, today):
    end, now = month_end_ordinal(months[-1] if months else None), date_ordinal(today)
    return None if end is None or now is None else max(0, now - end)


def big_order_warning(guidance, settings=None):
    demand, amount = guidance.get("monthly_demand", 0), guidance.get("quantity", 0)
    # Desktop renders warnings from normalized saved settings, not unchecked
    # tool arguments. Invalid containers/numbers must use the same defaults.
    threshold = normalize_order_settings(settings)["big_order_months"]
    if not (demand > 0 and amount > demand * threshold):
        return None
    months = math.floor(amount / demand * 10 + .5) / 10
    return f"Check this order: about {planning_number(months)} months of stock, much bigger than usual."


def _decimal_ratio(value):
    # Do NOT reduce these pairs: JS ratioValue converts numerator/denominator
    # separately to binary64. Reducing first changes projected balance by an ULP.
    text = planning_number(value)
    coefficient, _, exponent = text.partition('e')
    places = len(coefficient.partition('.')[2]) - int(exponent or 0)
    digits = int(coefficient.replace('.', ''))
    return (digits * 10**(-places), 1) if places < 0 else (digits, 10**places)


def _subtract_ratio(left, right):
    a, b = left
    c, d = right
    return a * d - c * b, b * d


def _ratio_value(pair):
    return float(pair[0]) / float(pair[1])


def inventory_position(item):
    return _ratio_value(_subtract_ratio(_decimal_ratio(item["on_hand"]), _decimal_ratio(-(item.get("on_order") or 0))))


def _guidance_demand(item):
    history = adopted_history(item, item["as_of"][:7])
    if history["state"] == "on":
        return lambda month: month_demand(history["model"], month)
    if item.get("seasonal") and len(item.get("monthly_sales") or []) >= 12:
        model = demand_model(item["monthly_sales"], item["as_of"][:7], summation=planning_sum)
        return lambda month: month_demand(model, month)
    return lambda month: item["monthly_demand"]


def _guidance_calendar_demand(demand_at, as_of, endpoint):
    if endpoint <= date_ordinal(as_of):
        return 0, 1
    end = ordinal_date(endpoint)
    if end is None:
        raise ValueError("Unsupported calendar")
    end_month, elapsed = end[:7], int(end[8:])
    month, whole = month_after(as_of[:7], 1), 0.0
    while month <= end_month:
        days = calendar.monthrange(*map(int, month.split('-')))[1]
        if month == end_month:
            n, d = _decimal_ratio(demand_at(month))
            wn, wd = _decimal_ratio(whole)
            return wn * d * days + n * elapsed * wd, wd * d * days
        whole = bounded(whole + demand_at(month))
        month = month_after(month, 1)
    raise ValueError("Unsupported calendar")


def dated_facts(item, as_of, today):
    """Validate optional per-item bridge facts; never trust a readiness assertion."""
    facts = item.get("planning_facts")
    result = dict(present="planning_facts" in item, state="hidden", needs="", supply=[], late=0, hold=False)
    if "planning_facts" not in item:
        return result
    def invalid():
        result.update(state="locked", hold=True, needs="HOLD: incoming order data needs checking.")
        return result
    if not isinstance(facts, dict) or facts.get("version") != "1.0":
        return invalid()
    rows = facts.get("incoming_pos")
    errors = facts.get("errors", {})
    if (not isinstance(errors, dict) or any(not isinstance(v, list) or any(not isinstance(c, str) or not c for c in v) for v in errors.values())
            or date_ordinal(today) is None or date_ordinal(as_of) is None):
        return invalid()
    if rows is None and not errors.get("dated_incoming"):
        result["present"] = False
        return result
    if errors.get("dated_incoming") or not isinstance(rows, list) or not rows or len(rows) > 10000:
        return invalid()
    warehouses = facts.get("warehouses")
    if not isinstance(warehouses, list) or not warehouses or any(not isinstance(w, str) or not w or w.strip() != w for w in warehouses) or len(set(warehouses)) != len(warehouses):
        return invalid()
    ids, confirmed = set(), []
    for row in rows:
        if not isinstance(row, dict):
            return invalid()
        for field in ("po_line_id", "sku", "warehouse", "supplier"):
            value = row.get(field)
            if not isinstance(value, str) or not value or value.strip() != value:
                return invalid()
        if row["sku"] != item.get("sku") or row["warehouse"] not in warehouses or row["po_line_id"] in ids or not quantity(row.get("remaining_qty")) or date_ordinal(row.get("due_date")) is None or row.get("status") not in ("confirmed", "draft", "cancelled", "received"):
            return invalid()
        ids.add(row["po_line_id"])
        if row["status"] == "confirmed" and row["remaining_qty"] > 0:
            confirmed.append(row)
    if confirmed and (item.get("on_order", 0) > 0 or any(v > 0 for v in (item.get("receipts") or {}).values())):
        return invalid()
    cutoff = max(date_ordinal(today), date_ordinal(as_of) + 1)
    for row in confirmed:
        due = date_ordinal(row["due_date"])
        if due < cutoff:
            result["late"] += row["remaining_qty"]
        else:
            result["supply"].append(dict(date=due, quantity=row["remaining_qty"]))
    result.update(state="locked" if result["late"] else "on", hold=bool(result["late"]),
                  needs="HOLD: Late PO - reconfirm before approving a purchase." if result["late"] else "")
    return result


def committed_facts(item, as_of, today):
    """Validated demand events; unknown/positive reservations keep approval locked.

    No reservation deduction is applied to gross stock. Mapping/usable-stock
    allocation is a later capability; these quantities remain a gross scenario.
    """
    facts = item.get("planning_facts")
    result = dict(state="hidden", needs="", orders=[], overdue=0, hold=False)
    if "planning_facts" not in item:
        return result
    def invalid(reason="HOLD: customer order data needs checking."):
        result.update(state="locked", hold=True, needs=reason)
        return result
    if not isinstance(facts, dict) or facts.get("version") != "1.0":
        return invalid()
    errors = facts.get("errors", {})
    if (not isinstance(errors, dict) or any(not isinstance(v, list) or any(not isinstance(c, str) or not c for c in v) for v in errors.values())
            or date_ordinal(today) is None or date_ordinal(as_of) is None):
        return invalid()
    rows = facts.get("customer_orders")
    if rows is None and not errors.get("committed_demand"):
        return result
    if errors.get("committed_demand") or not isinstance(rows, list) or not rows or len(rows) > 10000:
        return invalid()
    warehouses = facts.get("warehouses")
    if not isinstance(warehouses, list) or not warehouses or any(not isinstance(w, str) or not w or w.strip() != w for w in warehouses) or len(set(warehouses)) != len(warehouses):
        return invalid()
    ids, confirmed = set(), []
    for row in rows:
        if not isinstance(row, dict):
            return invalid()
        for field in ("order_line_id", "sku", "warehouse"):
            value = row.get(field)
            if not isinstance(value, str) or not value or value.strip() != value:
                return invalid()
        if (row["sku"] != item.get("sku") or row["warehouse"] not in warehouses or row["order_line_id"] in ids
                or not quantity(row.get("quantity")) or date_ordinal(row.get("delivery_date")) is None
                or row.get("status") not in ("confirmed", "draft", "cancelled")
                or not isinstance(row.get("forecast_included"), bool)):
            return invalid()
        ids.add(row["order_line_id"])
        if row["status"] == "confirmed" and row["quantity"] > 0:
            confirmed.append(row)
    cutoff = max(date_ordinal(today), date_ordinal(as_of) + 1)
    for row in confirmed:
        due = date_ordinal(row["delivery_date"])
        if due < cutoff:
            result["overdue"] = bounded(result["overdue"] + row["quantity"])
        result["orders"].append(dict(date=max(due, cutoff), quantity=row["quantity"], included=row["forecast_included"]))
    result["state"] = "on"
    if confirmed:
        if errors.get("reservations"):
            return invalid("HOLD: reservation data needs checking.")
        states = facts.get("stock_states")
        sites = {r["warehouse"] for r in confirmed}
        # Explicit zero observations are required only at committed sites. No
        # absence-to-zero inference, no imported state is subtracted here.
        known = {}
        if isinstance(states, list) and len(states) <= 10000:
            for state in states:
                if (not isinstance(state, dict) or state.get("sku") != item.get("sku")
                        or state.get("warehouse") not in warehouses or state.get("warehouse") in known
                        or any(not quantity(state.get(k)) for k in ("damaged", "reserved", "quarantine", "returns"))):
                    return invalid("HOLD: reservation data needs checking.")
                known[state["warehouse"]] = state["reserved"]
        if (not isinstance(states, list) or not sites.issubset(known) or any(known[s] > 0 for s in sites)
                or "reserved" in item and (not quantity(item["reserved"]) or item["reserved"] > 0)
                or item.get("usable_on_hand") is not None):
            return invalid("HOLD: reservation mapping is required for customer orders.")
    return result


def planning_event_facts(item, as_of, today):
    """Keep feature gates independent, merge only their adopted math and holds."""
    facts = dated_facts(item, as_of, today)
    committed = committed_facts(item, as_of, today)
    facts["orders"] = committed["orders"]
    facts["overdue_orders"] = committed["overdue"]
    facts["committed_state"] = committed["state"]
    history = adopted_history(item, as_of[:7])
    if history["state"] == "locked":
        facts["needs"] = " ".join(r for r in (facts["needs"], history["needs"]) if r)
        facts["hold"] = True
    if committed["hold"]:
        facts["needs"] = " ".join(r for r in (facts["needs"], committed["needs"]) if r)
        facts["hold"] = True
    return facts


def dated_month_baseline(item, month, facts):
    baseline = Fraction(str(_guidance_demand(item)(month)))
    included = sum((Fraction(str(o["quantity"])) for o in facts.get("orders", [])
                    if o["included"] and ordinal_date(o["date"])[:7] == month), Fraction(0))
    return max(Fraction(0), baseline - included)


def event_value(value):
    return float(value.numerator) / float(value.denominator)


def dated_demand(item, as_of, endpoint, facts):
    if not facts.get("orders"):
        return Fraction(*_guidance_calendar_demand(_guidance_demand(item), as_of, endpoint))
    if endpoint <= date_ordinal(as_of):
        return Fraction(0)
    month, total = month_after(as_of[:7], 1), Fraction(0)
    end_month = ordinal_date(endpoint)[:7]
    while month <= end_month:
        start, end = date_ordinal(month + "-01"), month_end_ordinal(month)
        elapsed = min(end, endpoint) - start + 1
        total += dated_month_baseline(item, month, facts) * elapsed / (end - start + 1)
        if month == end_month:
            break
        month = month_after(month, 1)
    total += sum((Fraction(str(o["quantity"])) for o in facts["orders"] if o["date"] <= endpoint), Fraction(0))
    bounded(event_value(total))
    return total


def dated_supply(item, as_of, facts):
    events = list(facts["supply"])
    events.extend(dict(date=date_ordinal(m + "-01"), quantity=q) for m, q in (item.get("receipts") or {}).items()
                  if m > as_of[:7])
    return sorted(events, key=lambda e: e["date"])


def dated_crossing(item, as_of, facts, stock=None):
    """Receipts at start of their exact business day, then that day's demand."""
    balance = Fraction(math.floor(item["on_hand"] if stock is None else stock))
    supply = dated_supply(item, as_of, facts)
    month = month_after(as_of[:7], 1)
    orders = facts.get("orders", [])
    last_event = max((e["date"] for e in supply + orders), default=date_ordinal(as_of))
    demand_at = _guidance_demand(item)
    annual = planning_sum(demand_at(f"2000-{n:02d}") for n in range(1, 13))
    while True:
        start, end = date_ordinal(month + "-01"), month_end_ordinal(month)
        if start > last_event:
            if annual == 0:
                return None
            years = max(0, math.ceil(balance / Fraction(str(annual))) - 1)
            if years:
                month = month_after(month, years * 12)
                balance -= Fraction(str(annual)) * years
                start, end = date_ordinal(month + "-01"), month_end_ordinal(month)
        rate = dated_month_baseline(item, month, facts) / (end - start + 1)
        cursor = start
        def consume(days):
            nonlocal balance
            if days > 0 and rate > 0 and balance - rate * days <= 0:
                return cursor + max(1, math.ceil(max(0, balance) / rate)) - 1
            balance -= rate * days
            bounded(event_value(balance))
            return None
        event_dates = sorted({e["date"] for e in supply + orders if start <= e["date"] <= end})
        for due in event_dates:
            crossing = consume(due - cursor)
            if crossing is not None:
                return ordinal_date(crossing)
            cursor = due
            # All same-day receipts precede all obligations; residual baseline
            # is consumed after the obligations, once for this calendar day.
            balance += sum((Fraction(str(e["quantity"])) for e in supply if e["date"] == due), Fraction(0))
            committed = sum((Fraction(str(e["quantity"])) for e in orders if e["date"] == due), Fraction(0))
            balance -= committed
            bounded(event_value(balance))
            if committed > 0 and balance <= 0:
                return ordinal_date(due)
        crossing = consume(end - cursor + 1)
        if crossing is not None:
            return ordinal_date(crossing)
        month = month_after(month, 1)


def dated_calendar(item, as_of, today_ordinal, facts):
    runout = dated_crossing(item, as_of, facts)
    supply = dated_supply(item, as_of, facts)
    available = Fraction(math.floor(item["on_hand"])) + sum((Fraction(str(e["quantity"])) for e in supply if e["date"] <= today_ordinal), Fraction(0))
    balance = available - dated_demand(item, as_of, today_ordinal, facts)
    delivery = next((e for e in supply if runout and e["date"] > date_ordinal(runout) and e["quantity"] > 0), None)
    out = balance <= 0
    return dict(runout=runout, gap=(runout or ordinal_date(today_ordinal)) if delivery or out else None,
                delivery=ordinal_date(delivery["date"]) if delivery else None,
                deliveryQuantity=delivery["quantity"] if delivery else None,
                outOfStock=out, balanceToday=bounded(event_value(balance)))


def dated_projection(item, as_of, horizon, today, result):
    facts = planning_event_facts(item, as_of, today)
    calculated = {**item, **result, "as_of": as_of}
    supply = dated_supply(item, as_of, facts)
    projection = []
    for offset in range(1, horizon + 1):
        month = month_after(as_of[:7], offset)
        end, start = month_end_ordinal(month), date_ordinal(month + "-01")
        demand = dated_demand(calculated, as_of, end, facts) - dated_demand(calculated, as_of, start - 1, facts)
        incoming = sum(e["quantity"] for e in supply if start <= e["date"] <= end)
        stock = Fraction(math.floor(item["on_hand"])) + sum((Fraction(str(e["quantity"])) for e in supply if e["date"] <= end), Fraction(0)) - dated_demand(calculated, as_of, end, facts)
        projection.append(dict(month=month, demand=event_value(demand), receipts=incoming, stock=bounded(event_value(stock))))
    crossing = dated_crossing(calculated, as_of, facts)
    runout = crossing if crossing and crossing[:7] <= projection[-1]["month"] else None
    lead = item.get("supplier_days")
    result.update(projection=projection, runout_day=runout, runout_month=runout[:7] if runout else None,
                  order_by=ordinal_date(date_ordinal(runout) - math.ceil(lead)) if runout and lead else None,
                  planning_facts=item["planning_facts"], purchase_hold=facts["hold"], late_po_quantity=facts["late"])
    if facts["committed_state"] != "hidden":
        result["overdue_order_quantity"] = facts["overdue_orders"]
        result["committed_quantity"] = planning_sum(o["quantity"] for o in facts["orders"])
    result["order_overdue"] = bool(result["order_by"] and result["order_by"] < as_of)
    return result


def guidance_calendar(item, as_of, today_ordinal):
    """First physical crossing, receipt restoration, and today's exact balance."""
    demand_at = _guidance_demand(item)
    balance, runout = float(math.floor(item["on_hand"])), None
    year, month = map(int, as_of[:7].split('-'))
    index, last_index = year * 12 + month, 9999 * 12 + 11
    receipts = item.get("receipts") or {}
    events = [m for m in receipts if m > as_of[:7]]
    last_receipt = max((int(m[:4]) * 12 + int(m[5:7]) - 1 for m in events), default=index - 1)
    annual = planning_sum(demand_at(f"2000-{n:02d}") for n in range(1, 13))
    while index <= last_index:
        if index > last_receipt:
            if annual == 0:
                break
            years = max(0, math.ceil(balance / annual) - 1)
            if years > 0:
                index += years * 12
                if index > last_index:
                    return {"invalid": True}
                balance = bounded(balance - years * annual)
        year, zero_month = divmod(index, 12)
        month = f"{year:04d}-{zero_month + 1:02d}"
        demand, receipt = demand_at(month), receipts.get(month, 0)
        if demand > 0 and balance - demand + receipt <= 0:
            days = calendar.monthrange(year, zero_month + 1)[1]
            elapsed = math.ceil(Fraction(str(max(0, balance + receipt))) * days / Fraction(str(demand)))
            runout = date(year, zero_month + 1, max(1, min(days, elapsed))).isoformat()
            break
        balance = bounded(balance - demand + receipt)
        index += 1
    if runout is None and annual > 0 and index > last_index:
        return {"invalid": True}
    available, delivery, delivery_quantity = float(math.floor(item["on_hand"])), None, None
    for month in sorted(events):
        due, amount = date_ordinal(month + '-01'), receipts[month]
        if due <= today_ordinal:
            available = bounded(available + amount)
        if delivery is None and runout and due > date_ordinal(runout) and amount > 0:
            delivery, delivery_quantity = ordinal_date(due), amount
    today_balance = _subtract_ratio(_decimal_ratio(available), _guidance_calendar_demand(demand_at, as_of, today_ordinal))
    out_of_stock = today_balance[0] <= 0
    gap = (runout or ordinal_date(today_ordinal)) if delivery or out_of_stock else None
    return {"runout": runout, "gap": gap, "delivery": delivery, "deliveryQuantity": delivery_quantity,
            "outOfStock": out_of_stock, "balanceToday": _ratio_value(today_balance)}


def order_guidance(item, today, settings=None, as_of=None):
    """Exact Desktop orderGuidance mirror; input is a calculated/source item.

    Retain raw stock, sales, seasonal and as_of on the input. Date defaults are
    deterministic: as_of comes from the item, and callers supply their clock.
    """
    raw_settings = settings if isinstance(settings, dict) else {}
    normalized = normalize_order_settings(raw_settings)
    item = item if isinstance(item, dict) else {}
    as_of = item.get("as_of") if as_of is None else as_of
    today = today.isoformat() if isinstance(today, date) else today
    now, snapshot = date_ordinal(today), date_ordinal(as_of)
    demand = item.get("monthly_demand")
    adopted = adopted_history(item, as_of[:7]) if snapshot is not None else {"state": "hidden", "needs": ""}
    demand_limit = (64 if adopted["state"] == "on" and adopted.get("manual_state") == "on" else 16 if adopted["state"] == "on" else 4) * MAX_QUANTITY
    def needs(reason):
        return {"status": "needs-data", "reason": reason}
    # JavaScript objects/arrays are truthy, even when their containers are empty.
    held = item.get("held")
    if (now is None or snapshot is None or month_end_ordinal(as_of[:7]) != snapshot
            or isinstance(held, (list, dict)) or held
            or not setting_number(item.get("on_hand"), 0, MAX_QUANTITY)
            or "on_order" in item and not setting_number(item["on_order"], 0, MAX_QUANTITY)
            or not setting_number(demand, 0, demand_limit)):
        return needs(item.get("reason") or "Needs a valid stock date, stock and forecast.")
    override = normalized["product_overrides"].get(item.get("sku"), {})
    overrides = raw_settings.get("product_overrides", {})
    raw_override = overrides.get(item.get("sku"), {}) if isinstance(overrides, dict) else {}
    raw_override = raw_override if isinstance(raw_override, dict) else {}
    for key, title in (("pack_size", "Pack size"), ("minimum_order", "Minimum order")):
        value = raw_override.get(key)
        if value is not None and value != "" and not (key == "minimum_order" and not isinstance(value, bool) and value == 0) and not valid_order_increment(value):
            return needs(f"{title} must be from 0.000001 to 1000000000000, with at most six decimal places.")
    source_lead = item.get("supplier_days")
    source_lead = normalized["default_delivery_days"] if source_lead is None else source_lead
    if source_lead is None or not setting_number(source_lead, 0, MAX_SUPPLIER_DAYS):
        return needs("No delivery time — set one in Advanced")
    lead, cover_days = math.ceil(source_lead), math.ceil(normalized["months_of_cover"] * DAYS_PER_MONTH)
    receipts = item.get("receipts") or {}
    if not isinstance(receipts, dict) or any(month_end_ordinal(m) is None or not setting_number(v, 0, MAX_QUANTITY) for m, v in receipts.items()):
        return needs("Confirmed delivery data needs checking.")
    try:
        facts = planning_event_facts(item, as_of, today)
        physical = dated_calendar(item, as_of, now, facts) if "planning_facts" in item else guidance_calendar(item, as_of, now)
    except (ValueError, OverflowError, TypeError, KeyError):
        return needs("The forecast exceeds the supported arithmetic range.")
    if physical.get("invalid"):
        return needs("The estimated run-out date exceeds the supported calendar.")
    on_order = item.get("on_order") or 0
    position_item = {**item, "on_hand": inventory_position(item)}
    position = (dated_calendar(position_item, as_of, now, facts) if "planning_facts" in item else guidance_calendar(position_item, as_of, now)) if on_order > 0 else physical
    if position.get("invalid"):
        return needs("The estimated inventory-position date exceeds the supported calendar.")
    # A timing margin cannot exceed the selected replenishment cover window.
    buffer = min(normalized["buffer_days"], cover_days)
    due_ordinal = date_ordinal(position["runout"]) - lead - buffer if position["runout"] else None
    due_date = ordinal_date(due_ordinal)
    if due_ordinal is not None and due_date is None:
        return needs("The order date exceeds the supported calendar.")
    due = 'now' if due_ordinal is not None and due_ordinal <= now else due_date
    runout = date_ordinal(physical["runout"])
    # Buffer advances the deadline only. Keep the original physical cover target;
    # do not add buffer-demand units on top of optional safety stock.
    order_date = max(now, runout - lead if runout is not None else now)
    endpoint = order_date + lead + cover_days
    if ordinal_date(endpoint) is None:
        return needs("The delivery and cover dates exceed the supported calendar.")
    included = ([e["quantity"] for e in dated_supply(item, as_of, facts) if snapshot < e["date"] <= endpoint] if "planning_facts" in item else
                [amount for month, amount in receipts.items() if snapshot < date_ordinal(month + '-01') <= endpoint])
    incoming = planning_sum(included)
    if not math.isfinite(incoming) or incoming > MAX_AGGREGATE:
        return needs("Confirmed delivery total is outside the supported range.")
    planning = inventory_planning(item, as_of[:7], raw_settings)
    expected = dated_demand(item, as_of, endpoint, facts) if "planning_facts" in item else Fraction(*_guidance_calendar_demand(_guidance_demand(item), as_of, endpoint))
    quantity = suggested_order_quantity(expected, item["on_hand"], included, override, on_order=on_order,
        safety_stock=planning["safety_stock"], include_backup_in_orders=normalized["include_backup_in_orders"])
    if quantity is None:
        return needs("The rounded quantity exceeds safe decimal precision (maximum 9007199254740991 units).")
    out_of_stock = physical["outOfStock"]
    covered = bool(on_order > 0 and runout and now + lead <= runout)
    uncovered_gap = (not covered and bool(physical["gap"] or out_of_stock or runout and now + lead > runout)) if on_order > 0 else bool(physical["gap"] or out_of_stock)
    status = 'order' if quantity > 0 else 'supply-gap' if uncovered_gap else 'overstocked' if demand == 0 and item["on_hand"] > 0 else 'healthy'
    result = {**planning, "status": status, "reason": "", "quantity": quantity, "lead_days": lead,
        "used_default_lead": item.get("supplier_days") is None, "incoming": incoming,
        "runout_date": physical["runout"], "order_by": due if quantity > 0 else None, "out_of_stock": out_of_stock, "stock_date": as_of,
        "supply_gap": uncovered_gap if on_order > 0 else bool(physical["gap"]),
        "gap_date": (physical["gap"] or physical["runout"]) if on_order > 0 and uncovered_gap else physical["gap"],
        "delivery_date": physical["delivery"], "delivery_quantity": physical["deliveryQuantity"],
        # Status cover and order timing use the same inventory-position crossing,
        # including calendar seasonality, dated receipts and elapsed snapshot time.
        "overstock_months": max(0, date_ordinal(position["runout"]) - now) / DAYS_PER_MONTH if position["runout"] else math.inf if inventory_position(item) > 0 else 0,
        "monthly_demand": demand, "projected_balance_today": physical["balanceToday"],
        "order_date": ordinal_date(order_date), "endpoint": ordinal_date(endpoint)}
    if "on_order" in item or "big_order_months" in raw_settings:
        result.update(inventory_position=inventory_position(item), covered_by_on_order=covered,
                      big_order=quantity > demand * normalized["big_order_months"])
    history = adopted_history(item, as_of[:7])
    if history["state"] != "hidden":
        result["demand_history"] = history
    if "planning_facts" in item:
        result.update(purchase_hold=facts["hold"], late_po_quantity=facts["late"])
        if facts["committed_state"] != "hidden":
            result["overdue_order_quantity"] = facts["overdue_orders"]
            result["committed_quantity"] = planning_sum(o["quantity"] for o in facts["orders"])
        if facts["hold"]:
            result.update(status="needs-data", reason=facts["needs"], scenario_quantity=quantity, quantity=None, order_by=None)
    if 'demand_change_pct' in item and facts['hold']:
        result.update(purchase_hold=True, status='needs-data', reason=facts['needs'], scenario_quantity=quantity, quantity=None, order_by=None)
    return result


def why_breakdown(item, today, settings=None, as_of=None):
    """Signed quantity ledger at the actual purchase window; no UI side effects.

    Finite purchases sum EXACTLY in left-to-right binary64 addition. Fixed-window
    forecast deltas separate stockout, projects, manual change and commitments;
    they are not independent re-plans with moving endpoints. A held/missing
    quantity returns one null-valued hold marker, NEVER a numeric zero order.
    Rounding and any binary64 reconciliation are explicit, not hidden demand.
    """
    guidance = order_guidance(item, today, settings, as_of)
    target = guidance.get('quantity')
    if target is None:
        key = ('late_po_hold' if guidance.get('late_po_quantity', 0) > 0 else
               'demand_history_hold' if guidance.get('demand_history', {}).get('state') == 'locked' else
               'committed_orders_hold' if guidance.get('purchase_hold') else 'data_hold')
        return [dict(key=key, qty=None)]
    as_of = item.get('as_of') if as_of is None else as_of
    now = today.isoformat() if isinstance(today, date) else today
    last, endpoint = as_of[:7], date_ordinal(guidance['endpoint'])
    facts = planning_event_facts(item, as_of, now)
    history = adopted_history(item, last)
    rows, exact, running = [], Fraction(0), 0.0
    def add(key, value):
        nonlocal exact, running
        value = value if isinstance(value, Fraction) else Fraction(str(value))
        qty = event_value(value)
        rows.append(dict(key=key, qty=qty))
        exact += value
        running += qty
    def integrate(model):
        return planning_demand_until(model, as_of, endpoint)
    baseline = Fraction(*_guidance_calendar_demand(_guidance_demand(item), as_of, endpoint))
    current = integrate(demand_model(item['monthly_sales'], last, summation=planning_sum)) if history['state']=='on' else baseline
    add('forecast_demand', current)
    if history['state'] == 'on':
        stockout = stockout_history(item, last)
        if stockout['state'] == 'on':
            after = integrate(stockout['model'])
            add('stockout_correction', after-current);current=after
        cleaned = cleaned_history(item, last)
        if cleaned.get('project_state') == 'on':
            after = integrate(cleaned['model'])
            add('projects_excluded', after-current);current=after
        if history.get('manual_state') == 'on':
            after = integrate(history['model'])
            add('manual_change', after-current);current=after
    if baseline != current:
        add('forecast_alignment', baseline-current)
    expected = dated_demand(item, as_of, endpoint, facts) if 'planning_facts' in item else baseline
    if facts['committed_state'] != 'hidden':
        add('committed_orders', expected-baseline)
    add('stock_on_hand', -Fraction(str(item['on_hand'])))
    if guidance['incoming']:
        # Re-use exact individual supply cells, not their rounded aggregate.
        amounts = ([e['quantity'] for e in dated_supply(item, as_of, facts) if date_ordinal(as_of)<e['date']<=endpoint]
                   if 'planning_facts' in item else [q for m,q in (item.get('receipts') or {}).items() if date_ordinal(as_of)<date_ordinal(m+'-01')<=endpoint])
        add('incoming_supply', -sum((Fraction(str(v)) for v in amounts), Fraction(0)))
    if item.get('on_order'):
        add('undated_incoming', -Fraction(str(item['on_order'])))
    normalized = normalize_order_settings(settings)
    if normalized['include_backup_in_orders'] and guidance.get('safety_stock') is not None:
        add('safety_stock', guidance['safety_stock'])
    if exact < 0:
        add('zero_floor', -exact)
    override = normalized['product_overrides'].get(item.get('sku'), {})
    minimum = Fraction(str(override.get('minimum_order') or 0))
    if exact > 0 and minimum > exact:
        add('minimum_order', minimum-exact)
    add('pack_rounding', Fraction(str(target))-exact)
    # Numeric clients can reduce qty directly with strict equality, even when
    # decimal fractions/cancellation leave a binary64 residue. Never hide it in
    # a forecast/stock component. Two corrections suffice; a bounded reset is a
    # defensive final fallback for future wider input ranges.
    for _ in range(2):
        if running == target:
            break
        add('arithmetic_reconciliation', target-running)
    if running != target:
        add('arithmetic_reconciliation', -running)
        add('arithmetic_reconciliation', target)
    return rows


def order_bucket(item, today, settings=None, as_of=None, *, guidance=None):
    """Desktop display bucket; skip is a separate, temporary visibility choice."""
    normalized = normalize_order_settings(settings)
    guidance = order_guidance(item, today, settings, as_of) if guidance is None else guidance
    if guidance["status"] == 'needs-data':
        return 'needs-data'
    today = today.isoformat() if isinstance(today, date) else today
    due = date_ordinal(guidance["order_by"])
    # Precedence: held > uncovered gap > positive purchase timing > no purchase.
    # A zero-quantity gap needs checking, never an instruction to Order now.
    if guidance["supply_gap"] or guidance["status"] == 'supply-gap':
        return 'order' if guidance["quantity"] > 0 else 'running-low'
    if guidance["quantity"] > 0:
        if guidance["order_by"] == 'now' or due is not None and due <= date_ordinal(today) + normalized["urgent_days"]:
            return 'order'
        buffer = min(normalized["buffer_days"], math.ceil(normalized["months_of_cover"] * DAYS_PER_MONTH))
        window = max(normalized["running_low_days"], guidance["lead_days"] + buffer)
        if due is not None and due <= date_ordinal(today) + window:
            return 'running-low'
        return 'healthy'  # Future replenishment is not surplus stock.
    history = guidance.get("demand_history", {})
    observed = [v for v, keep in zip(history.get("adjusted", history["corrected"]), history["eligible"]) if keep] if history.get("state") == "on" else item.get("monthly_sales") or []
    if guidance.get("committed_quantity", 0) == 0 and item["on_hand"] > 0 and len(observed) >= 3 and all(v == 0 for v in observed[-3:]):
        return 'no-sales'
    if item.get("on_order", 0) > 0 and guidance["status"] == 'healthy':
        return 'healthy'
    return 'overstocked' if guidance["overstock_months"] > normalized["overstock_months"] else 'healthy'


def format_guidance_date(value):
    if value == 'now':
        return 'now'
    ordinal = date_ordinal(value)
    if ordinal is None:
        return 'date unavailable'
    parsed = date.fromordinal(ordinal)
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")
    return f"{parsed.day} {months[parsed.month - 1]} {parsed.year}"


def _order_amount(value, places=6):
    from decimal import ROUND_HALF_UP
    rounded = Decimal(planning_number(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    text = format(rounded, ',f')
    return text.rstrip('0').rstrip('.') if '.' in text else text


def order_sentence(item, guidance):
    timing = 'now' if guidance['order_by'] == 'now' else 'by ' + format_guidance_date(guidance['order_by'])
    return f"Order {_order_amount(guidance['quantity'])} {item['unit']} {timing}"


def shortage_sentence(item, guidance):
    return (f"Short from {format_guidance_date(guidance['gap_date'])} until the {month_label(guidance['delivery_date'][:7]).split()[0]} delivery of {_order_amount(guidance['delivery_quantity'])} {item['unit']}."
            if guidance['delivery_date'] else None)


def gap_sentence(guidance):
    if guidance['delivery_date']:
        return ('Out of stock — ' if guidance['out_of_stock'] else '') + 'No extra order needed for the selected cover period.'
    return ('Out of stock — no recent sales; no order quantity suggested.' if guidance['monthly_demand'] == 0
            else 'Out of stock — no extra order needed for the selected cover period.')


def no_order_sentence(item, guidance):
    if item.get('on_order', 0) > 0 and guidance['quantity'] == 0:
        return (('Out of stock — ' if guidance['out_of_stock'] else '') + 'No extra purchase needed, but incoming may arrive after physical run-out.'
                if guidance['supply_gap'] else 'No extra order needed — incoming stock covers the order period.')
    if guidance['supply_gap'] or guidance['out_of_stock']:
        return gap_sentence(guidance)
    if guidance['monthly_demand'] == 0:
        return 'No order needed — stock on hand with no recent sales'
    if guidance['incoming'] > 0:
        incoming = guidance['incoming']
        amount = '<0.01' if incoming < .01 else _order_amount(incoming, 2 if incoming < 10 else 1)
        return f"No order needed — {amount} {item['unit']} in confirmed deliveries cover the order period"
    return 'No order needed — enough stock until ' + format_guidance_date(guidance['runout_date'])


def backtest(sales: list[float]) -> dict:
    if any(not quantity(v) for v in sales):
        raise ValueError("Sales quantities exceed the supported range.")
    bounded(sum(sales))
    if len(sales) < 7:
        return {"error_percent": None, "grade": "Not enough history to check"}
    forecasted, actual = [], []
    for index in range(len(sales) - 4, len(sales)):
        window = sales[index - 3:index]
        # Equal inputs have an exact mean: do not manufacture tiny float error.
        forecasted.append(window[0] if window.count(window[0]) == 3 else sum(window) / 3)
        actual.append(sales[index])
    total_actual = sum(actual)
    if total_actual == 0:
        return {"error_percent": None, "grade": "No recent sales to check"}
    raw_error = bounded(sum(abs(f - a) for f, a in zip(forecasted, actual)) / total_actual * 100)
    error = math.floor(raw_error + 0.5) or raw_error
    grade = "Usable for planning" if error <= 15 else "Use with care" if error <= 30 else "Too far off to plan on"
    return {"error_percent": error, "grade": grade}


def inventory_history(item: dict, months: list[str]) -> dict:
    """Rebuild raw month-end balances; never clamp the backward recurrence."""
    receipts = item.get("historical_receipts")
    absent = {"rows": [], "warning": "Add delivery history to see past inventory."}
    if (history_reason(months) or not quantity(item.get("on_hand"))
            or not isinstance(item.get("monthly_sales"), list)
            or any(not quantity(v) for v in item["monthly_sales"]) or not isinstance(receipts, dict) or set(receipts) != set(months)
            or len(item.get("monthly_sales", [])) != len(months)
            or any(not quantity(v) for v in receipts.values())):
        return absent
    balances = [item["on_hand"]] * len(months)
    for i in range(len(months) - 2, -1, -1):
        balances[i] = bounded(balances[i + 1] + item["monthly_sales"][i + 1] - receipts[months[i + 1]])
    negative = [i for i, value in enumerate(balances) if value < 0]
    warning = f"Supply history looks incomplete before {month_label(months[negative[-1] + 1])}" if negative else None
    return {"rows": [{"month": m, "raw_stock": balances[i], "stock": max(0, balances[i]),
                      "delivered": receipts[m]} for i, m in enumerate(months)], "warning": warning}


def forecast(item: dict, months: list[str], as_of: str, horizon: int = 6, settings=None, today=None) -> dict:
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 12:
        raise ValueError("Horizon must be a whole number from 1 to 12.")
    try:
        result = _forecast(item, months, as_of, horizon)
        if not result.get("held"):
            result.update(inventory_planning(item, months[-1], settings))
            if "planning_facts" in item:
                current = today.isoformat() if isinstance(today, date) else today or as_of
                dated_projection(item, as_of, horizon, current, result)
            if "on_order" in item or isinstance(settings, dict) and "big_order_months" in settings:
                result.update(safety_order_planning(item, months[-1], as_of, result, settings, today))
        return result
    except Exception:
        return held_item(item)


def _forecast(item, months, as_of, horizon):
    reason = validate_item(item) or history_reason(months)
    if reason:
        return {"sku": item.get("sku"), "name": item.get("name"), "held": True, "reason": reason}
    if len(months) != len(item["monthly_sales"]):
        return {"sku": item["sku"], "name": item["name"], "held": True, "reason": "Monthly history does not match its month labels."}
    try:
        latest = date.fromisoformat(as_of)
        if latest.day != calendar.monthrange(latest.year, latest.month)[1]:
            raise ValueError
    except (TypeError, ValueError):
        return {"sku": item["sku"], "name": item["name"], "held": True, "reason": "As-of date must be a month end."}
    month_after(months[-1], horizon)  # preflight before projection or order-date work
    if months[-1] != as_of[:7]:
        return {"sku": item["sku"], "name": item["name"], "held": True, "reason": "Latest sales month must match the as-of month."}
    if len(item["monthly_sales"]) < 3:
        return {"sku": item["sku"], "name": item["name"], "held": True, "reason": "At least 3 full months of sales are needed to forecast."}
    stock = math.floor(item["on_hand"])
    history = adopted_history(item, months[-1])
    model = history["model"] if history["state"] == "on" else demand_model(item["monthly_sales"], months[-1])
    next_demand = month_demand(model, month_after(months[-1], 1))
    projected = []
    runout = None
    balance = stock
    receipts = item.get("receipts", {})
    if not isinstance(receipts, dict):
        return {"sku": item["sku"], "name": item["name"], "held": True, "reason": "Receipts must be an object keyed by month."}
    if any(not quantity(v) for v in receipts.values()):
        return held_item(item, "Receipt quantities must be from 0 to 1000000000000.")
    runout_day = None
    for offset in range(1, horizon + 1):
        month = month_after(as_of[:7], offset)
        demand = month_demand(model, month)
        receipt = receipts.get(month, 0)
        if isinstance(receipt, bool) or not isinstance(receipt, (int, float)) or not math.isfinite(receipt) or receipt < 0:
            return {"sku": item["sku"], "name": item["name"], "held": True, "reason": f"Receipt for {month} must be a non-negative number."}
        opening = balance
        balance = bounded(balance - demand + receipt)
        projected.append({"month": month, "demand": demand, "receipts": receipt, "stock": balance})
        if runout is None and balance <= 0:
            runout = month
            year, number = map(int, month.split("-"))
            days = calendar.monthrange(year, number)[1]
            elapsed = max(0, (opening + receipt) / demand * days) if demand else 0
            runout_day = date.fromordinal(date(year, number, 1).toordinal() + max(0, min(days, math.ceil(elapsed)) - 1))
    supplier_days = item.get("supplier_days")
    order_by = None
    if supplier_days is not None and supplier_days > 0 and runout:
        order_by = date.fromordinal(runout_day.toordinal() - math.ceil(supplier_days)).isoformat()
    check = backtest(item["monthly_sales"])
    result = {"sku": item["sku"], "name": item["name"], "unit": item["unit"], "stock": stock,
            "monthly_demand": next_demand, "seasonal": model["seasonal"],
            "forecast_explanation": "Basic forecast uses the latest 3 eligible months; excluded months stay unobserved" if history["state"] == "on" and history.get("project_excluded_count", 0) else "Basic forecast uses the latest 3 eligible months; censored months stay unobserved" if history["state"] == "on" and history["censored_months"] else SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON,
            "runout_month": runout, "runout_day": runout_day.isoformat() if runout_day else None, "order_by": order_by,
            "order_overdue": order_by is not None and date.fromisoformat(order_by) < latest,
            "error_percent": check["error_percent"], "grade": check["grade"], "projection": projected,
            "receipts": receipts, "held": False}
    if history["state"] != "hidden":
        result["demand_history"] = history
    return result
