"""Feature 3 actual adoption: raw history, exposure, eligibility and purchase proof."""
import calendar
import copy
from datetime import date
import importlib.util
import io
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen, assert_guidance_frozen
import json
from pathlib import Path
import subprocess
import types

import pytest
import engine
from forecast_lab import clean_demand
from health import data_health
from test_phase2 import item, calc, sources, tools, write_csv, ROOT, TODAY, ASOF


def with_exposure(sales=(30,30,30), exposed=None, policies=None, stock=25):
    months=[engine.month_after('2026-10',i-len(sales)+1) for i in range(len(sales))]
    exposed=exposed if exposed is not None else [calendar.monthrange(*map(int,m.split('-')))[1] for m in months]
    policies=policies if policies is not None else [False]*len(sales)
    raw=item(stock);raw['monthly_sales']=list(sales)
    raw['planning_facts']=dict(version='1.0',sales_history=[dict(sku='A',month=m,quantity=v,in_stock_days=e,backorder=b)
                                  for m,v,e,b in zip(months,sales,exposed,policies)])
    return raw,months


def calculate(raw,months,settings=None):
    p=engine.forecast(raw,months,ASOF,6,settings,TODAY)
    g=engine.order_guidance({**raw,**p,'as_of':ASOF},TODAY,settings)
    return p,g


def test_actual_lab_corrects_physical_guidance_planning_once_and_keeps_raw():
    raw,months=with_exposure(exposed=[31,30,15]);before=copy.deepcopy(raw)
    p,g=calculate(raw,months,{'big_order_months':6,'include_backup_in_orders':True})
    trace=p['demand_history']
    expected=clean_demand([dict(sku='A',month=m,demand=r['quantity'],in_stock_days=r['in_stock_days'],days_in_month=calendar.monthrange(*map(int,m.split('-')))[1],backorder=r['backorder']) for m,r in zip(months,raw['planning_facts']['sales_history'])])
    assert trace['corrected']==[r['demand'] for r in expected['rows']]==[30,30,62]
    assert trace['trace']==[t for t in expected['trace'] if t['step']=='stockout_correction']
    assert p['monthly_demand']==pytest.approx(122/3)
    assert p['runout_day']==g['runout_date']=='2026-11-19'
    assert p['safety_stock']==g['safety_stock']==32
    assert p['reorder_point']==g['reorder_point']==35
    assert p['suggested_order']==g['quantity']==91
    assert g['demand_history']==trace and not g['purchase_hold']
    assert raw==before  # never overwrite monthly_sales or metadata


def test_quarter_exposure_floor_never_exceeds_four_times_observed():
    raw,months=with_exposure(exposed=[31,30,1])
    p,g=calculate(raw,months)
    assert p['demand_history']['corrected']==[30,30,120]
    assert p['monthly_demand']==60
    assert {'sku':'A','month':'2026-10','code':'stockout_floor'} in p['demand_history']['flags']
    assert p['runout_day']==g['runout_date']=='2026-11-13'


def test_backorders_are_observed_and_never_uplifted():
    raw,months=with_exposure(exposed=[0,1,15],policies=[True]*3)
    p,g=calculate(raw,months)
    assert p['monthly_demand']==30
    assert p['demand_history']['corrected']==[30,30,30]
    assert all(p['demand_history']['eligible'])
    assert g['quantity']==59


def test_censored_month_is_not_observed_zero_and_keeps_calendar():
    raw,months=with_exposure([30,30,30,0],[31,31,30,0])
    p,g=calculate(raw,months)
    h=p['demand_history']
    assert h['months']==months and h['eligible']==[True,True,True,False]
    assert h['corrected']==[30,30,30,0] and h['raw']==raw['monthly_sales']
    assert h['eligible_months']==months[:-1] and h['censored_months']==['2026-10']
    assert p['monthly_demand']==30 and p['runout_day']==g['runout_date']=='2026-11-25'
    assert not p['seasonal'] and g['quantity']==59
    # A long gapped series is never compacted into a shifted seasonal model.
    sales=[10,20,30,40,20,30,40,10,20,30,40,0,60]
    raw,months=with_exposure(sales)
    raw['planning_facts']['sales_history'][-2]['in_stock_days']=0
    p,g=calculate(raw,months)
    assert p['demand_history']['months']==months and not p['seasonal']
    assert p['monthly_demand']==pytest.approx((30+40+60)/3)


def test_censored_insufficient_eligible_is_locked_never_actionable():
    raw,months=with_exposure([30,30,0],[31,30,0])
    p,g=calculate(raw,months)
    assert p['demand_history']['eligible']==[True,True,False]
    assert p['demand_history']['state']=='locked' and g['purchase_hold']
    assert g['quantity'] is None and g['order_by'] is None and g['scenario_quantity'] is not None
    assert p['monthly_demand']==20  # explicitly held raw basic scenario, not a claimed corrected model
    assert '3 eligible' in g['reason']


@pytest.mark.parametrize('change',[
    lambda r:r.update(in_stock_days=None),lambda r:r.update(backorder=None),
    lambda r:r.update(backorder='false'),lambda r:r.update(in_stock_days=0),
    lambda r:r.update(in_stock_days=32),lambda r:r.update(in_stock_days=2.5),
    lambda r:r.update(month=['bad']),lambda r:r.update(quantity=31),
])
def test_partial_or_inconsistent_supplied_facts_hold_basic_scenario(change):
    raw,months=with_exposure();change(raw['planning_facts']['sales_history'][-1])
    p,g=calculate(raw,months)
    assert p['monthly_demand']==30 and p['demand_history']['state']=='locked'
    assert g['purchase_hold'] and g['quantity'] is None


def test_unmapped_oneoff_cannot_activate_project_exclusion():
    raw,months=with_exposure()
    for r in raw['planning_facts']['sales_history']:r.update(one_off=True)
    p,g=calculate(raw,months)
    assert p['monthly_demand']==30 and g['quantity']==59
    assert all(t['step']=='stockout_correction' for t in p['demand_history']['trace'])


def test_raw_history_reconstruction_and_backtest_stay_immutable():
    raw,months=with_exposure([10,20,10,0,20,30,40,0],[31,30,31,0,31,31,30,0])
    # Month lengths must match actual calendar (Mar..Oct).
    for row in raw['planning_facts']['sales_history']:
        row['in_stock_days']=0 if row['quantity']==0 else calendar.monthrange(*map(int,row['month'].split('-')))[1]
    raw['historical_receipts']={m:10 for m in months}
    history=engine.inventory_history(raw,months);check=engine.backtest(raw['monthly_sales'])
    p,g=calculate(raw,months)
    assert p['grade']==check['grade'] and p['error_percent']==check['error_percent']
    assert engine.inventory_history(raw,months)==history
    assert p['demand_history']['eligible'].count(False)==2


def test_actual_bundle_bridge_tool_cli_and_per_sku_gate(tmp_path):
    raw,months=with_exposure(exposed=[31,30,15])
    write_csv(tmp_path,'stock.csv',[['sku','name','unit','on_hand','supplier_days',*months],['A','Synthetic','box',25,2,30,30,30],['B','Other','box',25,2,30,30,30]])
    rows=raw['planning_facts']['sales_history'];headers=list(rows[0])
    write_csv(tmp_path,'sales_history.csv',[headers,*[[str(r[k]).lower() if isinstance(r[k],bool) else r[k] for k in headers] for r in rows]])
    loaded=sources.load_bundle(str(tmp_path),today=TODAY)
    assert loaded['items'][0]['planning_facts']['sales_history']==rows
    assert 'planning_facts' not in loaded['items'][1]
    p,g=calculate(loaded['items'][0],months)
    tool=json.loads(tools.make_handler(today=date.fromisoformat(TODAY))({'source':'csv','bundle_path':str(tmp_path)}))
    assert tool['items'][0]['guidance']==g
    assert tool['items'][0]['monthly_demand']==p['monthly_demand']
    child=subprocess.run(['/usr/bin/python3','stock_runway.py',str(tmp_path),'--bundle','--today',TODAY,'--all'],cwd=ROOT,text=True,capture_output=True)
    assert child.returncode==0,child.stderr
    import csv
    row=next(csv.DictReader(io.StringIO(child.stdout)))
    assert float(row['order_qty'])==g['quantity'] and row['run_out']==g['runout_date']
    bridge=subprocess.run(['/usr/bin/python3','bundle_import.py',str(tmp_path),'--today',TODAY],cwd=ROOT,text=True,capture_output=True)
    assert bridge.returncode==0,bridge.stderr
    assert json.loads(bridge.stdout)==loaded
    gate=data_health(loaded,TODAY)['features']['stockout_correction']['items']
    assert gate['A']['state']=='on' and gate['B']['state']=='hidden'
    # Missing exposure is not zero: scoped lock, not zero correction or import traceback.
    rows[-1]['in_stock_days']=''
    write_csv(tmp_path,'sales_history.csv',[headers,*[[str(r[k]).lower() if isinstance(r[k],bool) else r[k] for k in headers] for r in rows]])
    loaded=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calculate(loaded['items'][0],months)[1]['purchase_hold']
    assert 'planning_facts' not in loaded['items'][1]


def test_absent_history_whole_results_byte_identical_aeecfd7():
    old=read_baseline('aeecfd7:engine.py', text=True)
    # Owner-approved Phase 4 method label accompanies the model substitution.
    old = old.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    baseline=types.ModuleType('repair_engine');exec(compile(old,'aeecfd7:engine.py','exec'),baseline.__dict__)
    baseline.demand_model = engine.demand_model  # Owner-approved Phase 4 model seam.
    corpus=json.loads((ROOT/'tests/golden/phase2-inputs.json').read_text())
    assert len(corpus['cases']) == 19
    for case in corpus['cases']:
      for no_facts in (False, True):
        raw=copy.deepcopy(case['item']);raw.get('planning_facts',{}).pop('sales_history',None)
        if no_facts: raw.pop('planning_facts', None)
        for settings in [{},{'big_order_months':6,'include_backup_in_orders':True}]:
            args=(raw,case['months'],ASOF,6,settings,TODAY)
            actual=engine.forecast(*args);expected=baseline.forecast(*args)
            assert_forecast_frozen(actual,expected,engine,raw,ASOF,TODAY,settings)
            merged={**raw,**actual,'as_of':ASOF}
            assert_guidance_frozen(engine.order_guidance(merged,TODAY,settings),baseline.order_guidance(merged,TODAY,settings))


def test_embedded_lab_is_exact_generated_source():
    spec=importlib.util.spec_from_file_location('lab_sync',ROOT/'scripts/sync_cleaning_lab.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    source=(ROOT/'desktop/plugin.js').read_text()
    assert source.count(module.START)==source.count(module.END)==1
    actual=module.START+source.split(module.START,1)[1].split(module.END,1)[0]+module.END
    assert actual==module.block()


def test_corrected_seasonal_range_does_not_reject_supported_adopted_demand():
    raw,months=with_exposure([1e12]*9+[2.5e11]*3,[1]*9+[31,30,31],stock=1e12)
    p,g=calculate(raw,months)
    assert not p['held'] and p['demand_history']['state']=='on'
    assert g['status']!='needs-data' and g['quantity'] is not None
    assert raw['monthly_sales']==[1e12]*9+[2.5e11]*3
