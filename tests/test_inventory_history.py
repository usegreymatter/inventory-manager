"""Amendment 4: synthetic data only; historical receipts never feed forecast."""
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('stock_runway')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', package)
from stock_runway import engine
from stock_runway.sources import load_csv, SourceError

MONTHS = ['2026-08', '2026-09', '2026-10']
ITEM = dict(sku='SYNTHETIC', name='Synthetic', unit='ea', on_hand=5.5,
            supplier_days=None, monthly_sales=[10, 20, 30], receipts={})


def test_raw_backward_balance_anchor_and_forecast_independence():
    item = {**ITEM, 'historical_receipts': dict(zip(MONTHS, [0, 100, 40]))}
    history = engine.inventory_history(item, MONTHS)
    assert [row['raw_stock'] for row in history['rows']] == [-84.5, -4.5, 5.5]
    assert [row['stock'] for row in history['rows']] == [0, 0, 5.5]
    assert history['warning'] == 'Supply history looks incomplete before Oct 2026'
    baseline = engine.forecast(ITEM, MONTHS, '2026-10-31')
    actual = engine.forecast(item, MONTHS, '2026-10-31')
    for key in ['projection', 'monthly_demand', 'stock', 'runout_day', 'grade']:
        assert actual[key] == baseline[key]


def test_absent_partial_and_explicit_zero_history():
    assert engine.inventory_history(ITEM, MONTHS)['rows'] == []
    assert engine.inventory_history({**ITEM, 'historical_receipts': {'2026-10': 0}}, MONTHS)['rows'] == []
    result = engine.inventory_history({**ITEM, 'historical_receipts': dict.fromkeys(MONTHS, 0)}, MONTHS)
    assert [r['raw_stock'] for r in result['rows']] == [55.5, 35.5, 5.5]
    assert result['warning'] is None


def test_csv_category_and_complete_zero_receipts(tmp_path):
    path = tmp_path / 'synthetic.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,category,2026-08,2026-09,2026-10,rcv:2026-08,rcv:2026-09,rcv:2026-10\nA,Synthetic,ea,5,,Trim,10,20,30,0,0,0\n')
    item = load_csv(str(path))['items'][0]
    assert item['category'] == 'Trim'
    assert item['historical_receipts'] == dict.fromkeys(MONTHS, 0)


@pytest.mark.parametrize('columns,values', [
    ('rcv:2026-08', '0'),
    ('rcv:2026-08,rcv:2026-09,rcv:2026-11', '0,0,0'),
    ('rcv:2026-08,rcv:2026-09,rcv:2026-13', '0,0,0'),
    ('rcv:2026-08,rcv:2026-09,rcv:2026-10,rcv:2026-10', '0,0,0,0'),
    ('rcv:2026-08,rcv:2026-09,rcv:2026-10', '0,-1,0'),
    ('rcv:2026-08,rcv:2026-09,rcv:2026-10', '0,,0'),
])
def test_csv_rejects_incomplete_invalid_receipt_history(tmp_path, columns, values):
    path = tmp_path / 'synthetic.csv'
    path.write_text(f'sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10,{columns}\nA,Synthetic,ea,5,,10,20,30,{values}\n')
    with pytest.raises(SourceError):
        load_csv(str(path))


def test_sample_sales_stock_and_future_receipts_preserved():
    import json
    import hashlib
    original = (ROOT / 'tests/fixtures/original-sample.json').read_bytes()
    assert hashlib.sha256(original).hexdigest() == '25ee9f210b24f3b7862be8b6b95044438af3b141cec5bc06a7735348473c2677'
    before = json.loads(original)
    after = json.loads((ROOT / 'data/sample.json').read_text())
    assert before['months'] == after['months']
    for old, new in zip(before['items'], after['items']):
        for key, value in old.items():
            assert new[key] == value
        assert set(new['historical_receipts']) == set(after['months'])
        assert engine.inventory_history(new, after['months'])['warning'] is None
        assert engine.forecast(old, before['months'], before['as_of']) == engine.forecast(new, after['months'], after['as_of'])
