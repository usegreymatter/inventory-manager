"""JSON bridge for exact core why attribution, no UI or network."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine


def run(c):
    raw=c['item'];settings=c.get('settings',{});asof=c['as_of'];today=c['today']
    p=engine.forecast(raw,c['months'],asof,6,settings,today)
    item={**raw,**p,'as_of':asof}
    g=engine.order_guidance(item,today,settings)
    return dict(quantity=g.get('quantity'),rows=engine.why_breakdown(item,today,settings))


print(json.dumps([run(c) for c in json.load(sys.stdin)],allow_nan=False))
