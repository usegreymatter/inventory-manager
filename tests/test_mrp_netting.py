"""Independent window netting regression oracles; local synthetic inventory."""
from datetime import date
from fractions import Fraction
from baseline import read_baseline
import math
import engine

ASOF = '2026-10-31'

def guidance(receipts=None, **changes):
    item = dict(sku='MRP', name='Synthetic', unit='ea', as_of=ASOF,
                on_hand=150, supplier_days=30, monthly_sales=[100]*3,
                monthly_demand=100, seasonal=False, receipts=receipts or {})
    item.update(changes)
    return engine.order_guidance(item, ASOF)

def test_in_window_receipt_reduces_quantity_without_changing_trigger():
    before = guidance()
    inside = guidance({'2027-01':300})
    outside = guidance({'2027-03':300})
    assert before['order_by'] == inside['order_by'] == outside['order_by'] == '2026-11-16'
    assert before['endpoint'] == inside['endpoint'] == '2027-02-14'
    assert before['quantity'] == outside['quantity'] == 200
    # Largest uncovered demand is just before Jan1 receipt (same date demand,
    # receipt excluded): Nov100 + Dec100 + Jan100/31 - stock150.
    assert inside['quantity'] == math.ceil(Fraction(200) + Fraction(100,31) - 150) == 54

def test_arrival_and_endpoint_receipts_net_but_future_receipt_cannot_erase_bridge():
    # Arrival Dec16: receipts on that date already count at A.
    raw = dict(planning_facts=dict(version='1.0', warehouses=['MAIN'], incoming_pos=[]))
    def po(due, qty, key):
        return dict(po_line_id=key,sku='MRP',warehouse='MAIN',supplier='S',remaining_qty=qty,due_date=due,status='confirmed')
    raw['planning_facts']['incoming_pos'] = [po('2026-12-16',10,'A'),po('2027-02-14',300,'E')]
    g = guidance(**raw)
    # The first receipt delays the trigger by three days, hence arrival Dec19
    # and endpoint Feb17. Just before Feb14 requires 350-150-10 = 190.
    assert g['quantity'] == 190

def test_multiple_receipts_same_day_are_excluded_together_before_receipt():
    facts = dict(version='1.0',warehouses=['MAIN'],incoming_pos=[
        dict(po_line_id=str(i),sku='MRP',warehouse='MAIN',supplier='S',remaining_qty=150,due_date='2027-01-01',status='confirmed') for i in range(2)])
    assert guidance(planning_facts=facts)['quantity'] == 54

def test_why_ledger_names_netting_instead_of_negative_pack_rounding():
    item = dict(sku='MRP',name='Synthetic',unit='ea',as_of=ASOF,on_hand=150,
                monthly_sales=[100]*3,monthly_demand=100,supplier_days=30,
                seasonal=False,receipts={'2027-01':300})
    rows = engine.why_breakdown(item,ASOF)
    assert sum(r['qty'] for r in rows) == 54
    assert next(r['qty'] for r in rows if r['key']=='pack_rounding') >= 0
    assert next(r['qty'] for r in rows if r['key']=='dated_receipt_netting') < 0


def test_sample_table_and_required_probes_unchanged_without_future_receipts(tmp_path):
    import importlib.util
    import json
    from pathlib import Path
    import subprocess
    baseline = tmp_path/'baseline_policy.py'
    baseline.write_bytes(read_baseline('e8cdcfd:engine.py'))
    spec = importlib.util.spec_from_file_location('baseline_policy',baseline)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    sample = json.loads((Path(__file__).resolve().parents[1]/'data/sample.json').read_text())
    cases = [(raw,{}) for raw in sample['items']]
    grout = next(r for r in sample['items'] if r['sku']=='GRT-GRY-5')
    white = next(r for r in sample['items'] if r['sku']=='SEAL-WHT-300')
    cases += [({**grout,'on_order':500},{}),(grout,{'include_backup_in_orders':False,'product_overrides':{'GRT-GRY-5':{'pack_size':913}}}),(grout,{'months_of_cover':0})]
    cases += [(white,{'service_level':level}) for level in [.9,.95,.99]]
    assert len(cases)==11
    for raw,settings in cases:
        def compute(module):
            row = module.forecast(raw,sample['months'],ASOF,settings=settings,today=ASOF)
            return module.order_guidance({**raw,**row,'as_of':ASOF},ASOF,settings)
        assert compute(engine)==compute(old)


def test_fractional_year_skip_preserves_exact_crossing_day():
    # 74 full months at .3 plus 23/31 of January .3: exact crossing Jan23.
    # The year shortcut must not turn twelve decimal .3 values into
    # 3.6 - epsilon before subtracting whole years.
    stock = 22.42258064516129
    item = dict(sku='s11/32',as_of=ASOF,on_hand=22,on_order=stock-22,
                supplier_days=0,monthly_sales=[.3]*3,monthly_demand=.3,
                seasonal=False,receipts={})
    # Decimal input is deliberately just BELOW the exact 23-day threshold.
    assert Fraction(str(stock)) < Fraction(222,10)+Fraction(69,310)
    assert engine.order_guidance(item,ASOF,{'include_backup_in_orders':False})['order_by'] == '2033-01-23'
