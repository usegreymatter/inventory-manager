"""Local JSON adapter: physical forecast, purchase guidance and status together."""
import json
import math
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine
from health import data_health


def wire(v):
    if isinstance(v,float) and not math.isfinite(v):return None
    if isinstance(v,dict):return {k:wire(x) for k,x in v.items()}
    if isinstance(v,list):return [wire(x) for x in v]
    return v


def compare(c):
    raw=c['item'];asof=c['as_of'];today=c['today'];settings=c.get('settings',{})
    p=engine.forecast(raw,c['months'],asof,6,settings,today)
    i={**raw,**p,'as_of':asof}
    g=engine.order_guidance(i,today,settings,asof)
    return dict(physical=p,
                guidance=g,bucket=engine.order_bucket(i,today,settings,asof),
                health=data_health(dict(items=[i],as_of=asof,months=c['months']),today,settings))

print(json.dumps(wire([compare(c) for c in json.load(sys.stdin)]),allow_nan=False))
