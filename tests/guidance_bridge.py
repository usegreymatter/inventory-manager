"""JSON wire adapter for Node's real Desktop oracle (no third-party modules)."""
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))  # Direct script execution must resolve sibling pure modules.
spec = importlib.util.spec_from_file_location("guidance_engine", ROOT / "engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def wire(value):
    # JSON.stringify maps JS Infinity/NaN to null. Keep the public Python API's
    # Infinity sentinel intact and normalize only the JSON transport boundary.
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: wire(v) for k, v in value.items()}
    if isinstance(value, list):
        return [wire(v) for v in value]
    return value


def compare(case):
    item, today, settings, as_of = (case[k] for k in ("item", "today", "settings", "as_of"))
    guidance = engine.order_guidance(item, today, settings, as_of)
    result = {"guidance": guidance, "bucket": engine.order_bucket(item, today, settings, as_of),
              "skip": engine.active_skip(settings, item.get("sku"), today, as_of),
              "age": engine.sales_data_age(case["months"], today),
              "warning": engine.big_order_warning(guidance, settings)}
    if guidance["status"] != "needs-data":
        result.update(order_sentence=engine.order_sentence(item, guidance),
                      shortage_sentence=engine.shortage_sentence(item, guidance),
                      gap_sentence=engine.gap_sentence(guidance),
                      no_order_sentence=engine.no_order_sentence(item, guidance))
    return result


if __name__ == "__main__":
    if sys.argv[1:] == ["--chat"]:
        from datetime import date
        package_spec = importlib.util.spec_from_file_location("guidance_chat", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
        package = importlib.util.module_from_spec(package_spec)
        sys.modules["guidance_chat"] = package
        package_spec.loader.exec_module(package)
        from guidance_chat.tools import make_handler
        from guidance_chat.commands import format_result
        payload = json.loads(make_handler(today=date(2026, 11, 12))({}))
        print(json.dumps({"payload": payload, "slash": format_result(payload)}, allow_nan=False))
    else:
        # Preserve non-finite test inputs instead of JSON.stringify's null so
        # NaN/Infinity exercise numeric fallback, not intentional null lead time.
        cases = json.load(sys.stdin, object_hook=lambda value: float(value["__nonfinite__"])
                          if set(value) == {"__nonfinite__"} else value)
        print(json.dumps(wire([compare(case) for case in cases]), allow_nan=False))
