"""/stock slash command: a quick run-out list with no model call.

Usage:
  /stock                      sample store, soonest run-out first
  /stock SKU [SKU ...]        only these items
  /stock path/to/file.csv     your own CSV (see README for the format)
"""
import json

from .engine import month_label, valid_month

USAGE = "Usage: /stock  |  /stock SKU [SKU ...]  |  /stock path/to/file.csv  [--buffer-days N]"


def build_args(raw: str) -> dict:
    parts = (raw or "").split()
    if parts and parts[0].lower() in {"help", "-h", "--help"}:
        return {"help": True}
    settings = {}
    if "--buffer-days" in parts:
        index = parts.index("--buffer-days")
        try:
            token = parts[index + 1]
            if not token.isascii() or not token.isdecimal() or not 0 <= int(token) <= 365:
                raise ValueError
            settings["buffer_days"] = int(token)
            del parts[index:index + 2]
            if "--buffer-days" in parts:
                raise ValueError
        except (IndexError, ValueError):
            return {"error": "Buffer days must be a whole number from 0 to 365."}
    if len(parts) == 1 and parts[0].lower().endswith(".csv"):
        args = {"source": "csv", "csv_path": parts[0]}
        if settings:
            args["settings"] = settings
        return args
    args: dict = {"source": "sample"}
    if settings:
        args["settings"] = settings
    if parts:
        args["skus"] = parts
    return args


def format_result(payload: dict) -> str:
    if "error" in payload:
        return f"Inventory Manager: {payload['error']}\n{USAGE}"
    items = payload.get("items", [])
    order = sorted(items, key=lambda i: (bool(i.get("held")), i.get("runout_day") or "9999-12-31"))
    by_sku = {}
    for line in payload.get("summary", []):
        sku, _, rest = line.partition(": ")
        by_sku[sku] = rest
    lines = [f"Inventory Manager (stock as of {payload.get('as_of')}, next {payload.get('horizon')} months)"]
    for item in order:
        sku = item.get("sku", "?")
        lines.append(f"• {sku}: {by_sku.get(sku, item.get('reason', 'held'))}")
    # Preserve the physical forecast section for existing consumers. The new
    # purchase lines use Desktop's planner, not its legacy physical order_by.
    if payload.get("purchase_summary"):
        lines.append("Purchase guidance (Desktop rules)")
        lines.extend("• " + line for line in payload["purchase_summary"])
    if payload.get("truncated"):
        lines.append(f"Showing 50 of {payload.get('total_count')} items.")
    age = payload.get("data_age_days")
    if isinstance(age, (int, float)) and not isinstance(age, bool) and age > 45:
        month = payload.get("sales_month", str(payload.get("as_of", ""))[:7])
        if valid_month(month):
            lines.append(f"Your sales data ends {month_label(month)} ({age:g} days ago). Numbers may be out of date — load a newer file.")
    lines.append(payload.get("disclosure", ""))
    return "\n".join(line for line in lines if line)


def make_command(tool_handler):
    def stock(raw_args: str = "", **_: object) -> str:
        args = build_args(raw_args)
        if args.get("help"):
            return USAGE
        if args.get("error"):
            return format_result(args)
        try:
            payload = json.loads(tool_handler(args))
        except Exception:  # never break the chat over a display command
            return "Inventory Manager could not run. " + USAGE
        return format_result(payload)
    return stock
