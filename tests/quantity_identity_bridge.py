"""History-free ce20b2d/display-fix quantity identity and Python/JS parity."""
import hashlib
import json
from pathlib import Path
import sys
import types
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import stock_runway
engine, _ = stock_runway._load_modules()
source = (ROOT/'engine.py').read_text()
stock_blob = (ROOT/'tests/fixtures/v130-stock-date-approved-delta.json').read_bytes()
assert hashlib.sha256(stock_blob).hexdigest() == 'c7a1eaa04831f0fe6d8de05fed9389828d179ce8369fc0f2683691b916846855'
for span in json.loads(stock_blob)['engine']:
    assert source.count(span['after']) == 1
    source = source.replace(span['after'], span['before'])
v122_blob = (ROOT/'tests/fixtures/v122-approved-delta.json').read_bytes()
# Hash must match the JS fail-closed reviewed helper.
import re
pin = re.search(r"digest\('hex'\),'([0-9a-f]{64})'", (ROOT/'tests/reviewed-v122-delta.cjs').read_text()).group(1)
assert hashlib.sha256(v122_blob).hexdigest() == pin
for span in json.loads(v122_blob)['engine']:
    assert source.count(span['after']) == 1
    source = source.replace(span['after'], span['before'])
blob = (ROOT/'tests/fixtures/v12-display-approved-delta.json').read_bytes()
assert hashlib.sha256(blob).hexdigest() == 'f5cce9e9de3ad2108054c4b464870ea0d423816ec8646a9714384429e6d65181'
delta = json.loads(blob)
for span in delta['engine']:
    assert source.count(span['after']) == 1
    source = source.replace(span['after'], span['before'])
assert hashlib.sha256(source.encode()).hexdigest() == delta['engine_before_sha256']
before = types.ModuleType(engine.__package__+'.quantity_baseline')
before.__package__ = engine.__package__
before.__file__ = engine.__file__
sys.modules[before.__name__] = before
exec(compile(source, before.__file__, 'exec'), before.__dict__)

def project(module, c):
    data, settings, today = c['data'], c['settings'], c['today']
    out = []
    for raw in data['items']:
        physical = module.forecast(raw, data['months'], data['as_of'], settings=settings, today=today)
        item = {**raw, **physical, 'as_of': data['as_of']}
        g = module.order_guidance(item, today, settings, data['as_of'])
        suggestion = g.get('profit_suggestion')
        out.append([item['sku'], g.get('quantity'), g.get('uncapped_qty'), g.get('shelf_cap_qty'),
                    suggestion['qty'] if suggestion else None,
                    [a['qty'] for a in suggestion['alt']] if suggestion else None])
    return out

if __name__ == '__main__':
    cases = json.load(sys.stdin)
    for c in cases:
        previous, current = project(before, c), project(engine, c)
        assert previous == current, (c['id'], previous, current)
        assert current == c['quantities'], (c['id'], current, c['quantities'])
    print(json.dumps(dict(cases=len(cases), unchanged=True, python_js_parity=True)))
