"""Core-produced purchase attribution, fixed to the actual planner's endpoint."""
import copy
import json
import math

import pytest
import engine
from test_phase2 import ROOT, TODAY, ASOF
from test_project_exclusion import projected
from test_stockout_correction import calculate


def left_sum(rows):
    value=0.0
    for row in rows:value+=row['qty']
    return value


def test_why_exact_after_cleaning_and_manual_without_mutation():
    raw,months=projected([30,30,30,60],[False,False,False,True],[31,31,15,10])
    raw['demand_change_pct']=50
    settings={'big_order_months':6,'include_backup_in_orders':True,'product_overrides':{'A':{'pack_size':.125,'minimum_order':100}}}
    p,g=calculate(raw,months,settings);item={**raw,**p,'as_of':ASOF};saved=copy.deepcopy(item)
    rows=engine.why_breakdown(item,TODAY,settings)
    assert item==saved
    assert left_sum(rows)==g['quantity']
    keys=[r['key'] for r in rows]
    assert keys[:4]==['forecast_demand','stockout_correction','projects_excluded','manual_change']
    assert 'stock_on_hand' in keys and 'safety_stock' in keys and 'pack_rounding' in keys
    assert next(r['qty'] for r in rows if r['key']=='stockout_correction')>0
    assert next(r['qty'] for r in rows if r['key']=='projects_excluded')<0
    assert next(r['qty'] for r in rows if r['key']=='manual_change')>0


def test_why_committed_orders_and_late_po_hold_never_claim_zero_purchase():
    corpus=json.loads((ROOT/'tests/golden/phase2-inputs.json').read_text())
    late=copy.deepcopy(next(c for c in corpus['cases'] if c['item']['sku']=='SAME-DAY-SUPPLY'))
    late['item']['planning_facts']['incoming_pos'][0]['due_date']='2026-10-31'
    checked=set()
    for c in [*corpus['cases'],late]:
        raw=c['item'];p,g=calculate(raw,c['months'],c.get('settings',{}));item={**raw,**p,'as_of':ASOF}
        rows=engine.why_breakdown(item,TODAY,c.get('settings',{}))
        assert all(set(r)=={'key','qty'} for r in rows)
        if g.get('quantity') is None:
            assert len(rows)==1 and rows[0]['qty'] is None
            if g.get('late_po_quantity',0)>0:
                assert rows[0]['key']=='late_po_hold';checked.add('late')
        else:
            assert all(isinstance(r['qty'],(int,float)) and math.isfinite(r['qty']) for r in rows)
            assert left_sum(rows)==g['quantity']
            if g.get('committed_quantity',0)>0:
                assert any(r['key']=='committed_orders' for r in rows);checked.add('orders')
    assert checked=={'late','orders'}


@pytest.mark.parametrize('stock,pack',[(100,.000001),(0,.1),(.1,.3),(25,.125)])
def test_why_exact_zero_floor_pack_and_decimal_reconciliation(stock,pack):
    raw,months=projected([.1,.2,.3],[False]*3,project_only=True)
    raw['on_hand']=stock
    settings={'product_overrides':{'A':{'pack_size':pack,'minimum_order':.4}}}
    p,g=calculate(raw,months,settings)
    rows=engine.why_breakdown({**raw,**p,'as_of':ASOF},TODAY,settings)
    assert left_sum(rows)==g['quantity']
    assert next(r['qty'] for r in rows if r['key']=='pack_rounding')>=0
