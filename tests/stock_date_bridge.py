"""JSON wire adapter: Python side of the stock count date parity oracle."""
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("stock_date_bridge_engine", ROOT / "engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

KEYS = ("quantity", "order_by", "runout_date", "out_of_stock", "status", "safety_stock", "reorder_point")


def wire(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: wire(v) for k, v in value.items()}
    if isinstance(value, list):
        return [wire(v) for v in value]
    return value


def run(case):
    data, today, stock_date = case["data"], case["today"], case.get("stock_date")
    out = {"notice": engine.stock_date_notice(data["as_of"], today, stock_date),
           "reason": engine.stock_date_reason(stock_date, data["as_of"], today) if stock_date else None}
    try:
        moved = engine.apply_stock_date(data, stock_date, today) if stock_date else data
    except ValueError as error:
        out["error"] = str(error)
        return out
    rows = []
    for raw in moved["items"]:
        row = {k: raw.get(k) for k in ("on_hand", "counted_on_hand", "stock_counted_on", "stock_date_adjustment", "input_warnings")}
        try:
            physical = engine.forecast(raw, moved["months"], moved["as_of"], today=today)
            item = {**raw, **physical, "on_hand": raw["on_hand"], "monthly_sales": raw["monthly_sales"], "as_of": moved["as_of"]}
            guidance = engine.order_guidance(item, today, None, moved["as_of"])
            row["guidance"] = {k: guidance.get(k) for k in KEYS}
        except (ValueError, TypeError, KeyError) as error:
            row["guidance_error"] = type(error).__name__
        rows.append(row)
    out["items"] = rows
    return out


print(json.dumps(wire([run(case) for case in json.load(sys.stdin)])))
