"""Pure stock runway calculations. No I/O and no third-party dependencies."""
from __future__ import annotations

import calendar
import math
import re
from datetime import date


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
    for field in ("on_hand",):
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


def forecast(item: dict, months: list[str], as_of: str, horizon: int = 6) -> dict:
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 12:
        raise ValueError("Horizon must be a whole number from 1 to 12.")
    try:
        return _forecast(item, months, as_of, horizon)
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
    monthly_mean = bounded(sum(item["monthly_sales"][-3:])) / 3
    demand = math.ceil(monthly_mean)
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
    return {"sku": item["sku"], "name": item["name"], "unit": item["unit"], "stock": stock,
            "monthly_demand": demand, "runout_month": runout, "runout_day": runout_day.isoformat() if runout_day else None, "order_by": order_by,
            "order_overdue": order_by is not None and date.fromisoformat(order_by) < latest,
            "error_percent": check["error_percent"], "grade": check["grade"], "projection": projected,
            "receipts": receipts, "held": False}
