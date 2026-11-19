"""Per-SKU manual percent: cleaned observations -> adjustment -> forecast."""
import copy
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen, assert_guidance_frozen, purchase_golden
import json
import subprocess
import types

import pytest
import engine
from health import data_health
from test_phase2 import sources, write_csv, ROOT, TODAY, ASOF
from test_project_exclusion import projected
from test_stockout_correction import calculate


@pytest.mark.parametrize('pct,expected', [(-90,3),(0,30),(50,45),(300,120)])
def test_manual_percent_without_optional_facts(pct, expected):
    raw,months=projected([30]*4,[False]*4)
    raw.pop('planning_facts');raw['demand_change_pct']=pct
    saved=copy.deepcopy(raw)
    p,g=calculate(raw,months,{'big_order_months':6})
    assert p['monthly_demand']==expected and g['monthly_demand']==expected
    assert p['demand_history']['adjusted']==[expected]*4
    assert p['demand_history']['manual_state']=='on' and raw==saved
    assert p['suggested_order']==g['quantity']
    assert data_health(dict(items=[raw],months=months,as_of=ASOF),TODAY)['features']['manual_change']['items']['A']['state']=='on'


def test_zero_percent_preserves_binary64_observations_exactly():
    raw,months=projected([88.84031387546717]*4,[False]*4)
    raw.pop('planning_facts');baseline=copy.deepcopy(raw)
    raw['demand_change_pct']=0
    p,g=calculate(raw,months)
    before,bg=calculate(baseline,months)
    assert p['demand_history']['adjusted']==raw['monthly_sales']
    for key in ['monthly_demand','projection','runout_day','safety_stock','reorder_point']:
        assert p[key]==before[key]
    assert g['quantity']==bg['quantity']


def test_manual_percent_runs_after_stockout_and_project_exclusion_once():
    raw,months=projected([30,30,30,60],[False,False,False,True],[31,31,15,10])
    raw['demand_change_pct']=50
    p,g=calculate(raw,months,{'big_order_months':6})
    h=p['demand_history']
    assert h['corrected']==[30,30,60,186]
    assert h['after_projects']==[30,30,60,0]
    assert h['adjusted']==[45,45,90,0] and p['monthly_demand']==60
    assert [t['step'] for t in h['trace'][-4:]]==['manual_change']*4
    assert p['safety_stock']>0 and p['suggested_order']==g['quantity']


@pytest.mark.parametrize('pct',[-90.01,300.01,None,True,'25',[],{},float('inf')])
def test_invalid_explicit_manual_percent_holds_even_without_planning_facts(pct):
    raw,months=projected();raw.pop('planning_facts');raw['demand_change_pct']=pct
    p,g=calculate(raw,months)
    assert not p['held'] and p['monthly_demand']==120
    assert g['status']=='needs-data' and g['purchase_hold'] and g['quantity'] is None
    assert g['order_by'] is None and g['scenario_quantity']>0
    h=data_health(dict(items=[raw],months=months,as_of=ASOF),TODAY)
    assert h['features']['manual_change']['state']=='locked'
    assert any(w['code']=='manual_locked' for w in h['warnings'])


@pytest.mark.parametrize('value', ['-90','+50','300',''])
def test_manual_column_csv_and_actual_bridge(tmp_path,value):
    months=['2026-08','2026-09','2026-10']
    write_csv(tmp_path,'stock.csv',[['sku','name','unit','on_hand','supplier_days','demand_change_pct',*months],['A','Synthetic','box',25,2,value,30,30,30],['B','Other','box',25,2,'',30,30,30]])
    data=sources.load_csv(str(tmp_path/'stock.csv'))
    assert ('demand_change_pct' in data['items'][0])==bool(value)
    assert 'demand_change_pct' not in data['items'][1]
    child=subprocess.run(['/usr/bin/python3','bundle_import.py',str(tmp_path),'--today',TODAY],cwd=ROOT,text=True,capture_output=True)
    assert child.returncode==0,child.stderr
    assert json.loads(child.stdout)['items']==data['items']


@pytest.mark.parametrize('value',['-91','301','NaN','5%','true'])
def test_bad_manual_column_rejected(tmp_path,value):
    write_csv(tmp_path,'stock.csv',[['sku','name','unit','on_hand','supplier_days','demand_change_pct','2026-08','2026-09','2026-10'],['A','Synthetic','box',25,2,value,30,30,30]])
    with pytest.raises(sources.SourceError,match='demand_change_pct'):
        sources.load_csv(str(tmp_path/'stock.csv'))


@pytest.mark.parametrize('value',['2026-01-01',''])
def test_last_count_date_optional_column_bundle(tmp_path,value):
    write_csv(tmp_path,'stock.csv',[['sku','name','unit','on_hand','supplier_days','last_count_date','2026-08','2026-09','2026-10'],['A','Synthetic','box',25,2,value,30,30,30]])
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert ('last_count_date' in data['items'][0])==bool(value)
    if value: assert data['items'][0]['last_count_date']==value


def test_manual_golden_all_surfaces():
    import importlib.util
    spec=importlib.util.spec_from_file_location('manual_golden', ROOT/'scripts/golden_diff.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    inputs=json.loads((ROOT/'tests/golden/manual-inputs.json').read_text())
    assert len(inputs['cases'])==5
    assert module.collect(inputs)==purchase_golden('manual')


def test_manual_absence_preserves_full_current_physical_guidance_and_health():
    old=read_baseline('24d8e3a:engine.py', text=True)
    # Substitute only the owner-approved Phase 4 numbers/label seam.
    old=old.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    baseline=types.ModuleType('manual_baseline');exec(compile(old,'24d8e3a:engine.py','exec'),baseline.__dict__)
    baseline.__dict__['demand_model']=engine.demand_model
    corpus=json.loads((ROOT/'tests/golden/phase2-inputs.json').read_text())
    for c in corpus['cases']:
        args=(c['item'],c['months'],ASOF,6,c.get('settings',{}),TODAY)
        p=engine.forecast(*args);before=baseline.forecast(*args)
        assert_forecast_frozen(p,before,engine,c['item'],ASOF,TODAY,c.get('settings',{}))
        raw={**c['item'],**p,'as_of':ASOF}
        assert_guidance_frozen(engine.order_guidance(raw,TODAY,c.get('settings',{})),baseline.order_guidance(raw,TODAY,c.get('settings',{})))
