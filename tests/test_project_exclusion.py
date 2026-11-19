"""Feature4: explicit whole-month eligibility and suggestion-only outlier proof."""
import calendar
import copy
from datetime import date
import io
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen, assert_guidance_frozen, assert_tool_forecast_frozen
import json
from pathlib import Path
import subprocess
import types

import pytest
import engine
from forecast_lab import clean_demand
from health import data_health
from test_phase2 import sources, tools, write_csv, ROOT, TODAY, ASOF
from test_stockout_correction import with_exposure, calculate


def projected(sales=(30,30,30,300),flags=(False,False,False,True),exposed=None,project_only=False):
    raw,months=with_exposure(sales,exposed)
    for row,flag in zip(raw['planning_facts']['sales_history'],flags):
        row['project']=flag
        if project_only:
            row.pop('in_stock_days');row.pop('backorder')
    return raw,months


def test_whole_project_month_excluded_not_observed_zero_or_calendar_shift():
    raw,months=projected();saved=copy.deepcopy(raw)
    p,g=calculate(raw,months,{'big_order_months':6})
    h=p['demand_history']
    assert p['monthly_demand']==30 and p['runout_day']==g['runout_date']=='2026-11-25'
    assert g['quantity']==p['suggested_order']==59 and not g['purchase_hold']
    assert h['raw']==[30,30,30,300] and h['corrected']==[30,30,30,300]
    assert h['after_projects']==[30,30,30,0] and h['eligible']==[True,True,True,False]
    assert h['months']==months and h['eligible_months']==months[:-1]
    assert h['project_months']==['2026-10'] and h['project_excluded_count']==1
    assert h['project_state']=='on' and h['stockout_state']=='on'
    assert not p['seasonal'] and raw==saved


def test_lab_correction_then_project_exclusion_once_with_real_trace():
    raw,months=projected([30,30,30,60],[False,False,False,True],[31,31,30,10])
    p,g=calculate(raw,months)
    expected=clean_demand([dict(sku='A',month=r['month'],demand=r['quantity'],in_stock_days=r['in_stock_days'],days_in_month=calendar.monthrange(*map(int,r['month'].split('-')))[1],backorder=r['backorder'],one_off=r['project']) for r in raw['planning_facts']['sales_history']])
    h=p['demand_history']
    assert h['trace']==[t for t in expected['trace'] if t['step'] in ('stockout_correction','project_exclusion')]
    assert h['corrected'][-1]==186 and h['after_projects'][-1]==0
    assert h['trace'][-1]==dict(step='project_exclusion',sku='A',month='2026-10',before=186,after=0)
    assert p['monthly_demand']==30 and g['quantity']==59
    assert p['safety_stock']==0 and p['reorder_point']==2


def test_project_only_evidence_uses_raw_without_inventing_exposure():
    raw,months=projected(project_only=True)
    p,g=calculate(raw,months)
    assert engine.stockout_history(raw,'2026-10')['state']=='hidden'
    assert p['demand_history']['stockout_state']=='hidden'
    assert p['demand_history']['corrected']==raw['monthly_sales']
    assert p['monthly_demand']==30 and g['quantity']==59 and not g['purchase_hold']


def test_censored_and_project_eligibility_are_independent_and_union_once():
    raw,months=projected([30,30,0,30,90],[False,False,False,False,True],[30,31,0,30,31])
    p,g=calculate(raw,months)
    h=p['demand_history']
    assert h['censored_months']==['2026-08'] and h['project_months']==['2026-10']
    assert h['stockout_eligible']==[True,True,False,True,True]
    assert h['eligible']==[True,True,False,True,False]
    assert h['eligible_months']==['2026-06','2026-07','2026-09']
    assert p['monthly_demand']==30 and g['quantity']==59
    # A month can be both censored and project; it is never removed twice.
    raw['planning_facts']['sales_history'][2]['project']=True
    other,og=calculate(raw,months)
    assert other['demand_history']['eligible']==h['eligible'] and og['quantity']==g['quantity']


def test_gapped_long_history_uses_latest_three_without_seasonal_shift():
    raw,months=projected([10,20,30,40,50,60,70,80,90,100,45,60,75],[False]*6+[True]+[False]*6)
    p,g=calculate(raw,months)
    assert p['monthly_demand']==60 and not p['seasonal']
    assert p['demand_history']['months']==months
    assert p['demand_history']['eligible_months']==months[:6]+months[7:]
    # Reordering annotations does not reorder either raw history or attribution.
    raw['planning_facts']['sales_history'].reverse()
    assert calculate(raw,months)==(p,g)


def test_thin_project_history_holds_raw_basic_scenario_never_zero_baseline():
    raw,months=projected([30,30,300],[False,False,True])
    p,g=calculate(raw,months)
    assert g['status']=='needs-data' and g['quantity'] is None and g['order_by'] is None
    assert p['demand_history']['project_state']=='locked' and p['demand_history']['eligible']==[True,True,False]
    assert p['monthly_demand']==120 and g['scenario_quantity']>0
    assert '3 eligible' in g['reason']


@pytest.mark.parametrize('flag',[None,'false',0,1,[],{}])
def test_unknown_or_nonboolean_project_flag_holds_without_guessing(flag):
    raw,months=projected();raw['planning_facts']['sales_history'][-1]['project']=flag
    p,g=calculate(raw,months)
    assert p['demand_history']['project_state']=='locked'
    assert g['purchase_hold'] and g['quantity'] is None
    assert p['monthly_demand']==120  # inspectable raw scenario, not partially cleaned adoption


def test_partial_flag_coverage_and_declared_unknown_exposure_are_locked():
    raw,months=projected();del raw['planning_facts']['sales_history'][0]['project']
    assert calculate(raw,months)[1]['purchase_hold']
    raw,months=projected(project_only=True)
    raw['planning_facts']['sales_history'][-1]['in_stock_days']=None
    assert calculate(raw,months)[1]['purchase_hold']


def test_outlier_suggestion_never_auto_excludes_or_changes_numbers():
    raw,months=projected([30]*7+[300,30],[False]*9)
    base=copy.deepcopy(raw)
    for row in base['planning_facts']['sales_history']:row.pop('project')
    p,g=calculate(raw,months);bp,bg=calculate(base,months)
    h=p['demand_history'];suggestions=h['outlier_suggestions']
    assert suggestions==dict(state='on',needs='',chip='Check spike',months=['2026-09'])
    assert all(h['eligible']) and h['project_excluded_count']==0
    for key in ['projection','monthly_demand','runout_day','safety_stock','reorder_point']:assert p[key]==bp[key]
    for key in ['quantity','runout_date','order_by','endpoint']:assert g[key]==bg[key]
    assert p['monthly_demand']==120 and h['after_projects']==raw['monthly_sales']
    assert [f for f in h['flags'] if f['code']=='outlier_suggestion']==[dict(sku='A',month='2026-09',code='outlier_suggestion')]
    # An excluded spike and censored zero do not contaminate the diagnostic population.
    raw['planning_facts']['sales_history'][-2]['project']=True
    assert calculate(raw,months)[0]['demand_history']['outlier_suggestions']['months']==[]


def test_unmapped_oneoff_remains_off():
    raw,months=projected(flags=[False]*4)
    for row in raw['planning_facts']['sales_history']:row['one_off']=True
    p,g=calculate(raw,months)
    assert p['monthly_demand']==120 and p['demand_history']['project_excluded_count']==0
    assert all(t['step'] in ('stockout_correction','project_exclusion') for t in p['demand_history']['trace'])


def write_project_bundle(root,project_only=False,blank=False):
    raw,months=projected(project_only=project_only)
    write_csv(root,'stock.csv',[['sku','name','unit','on_hand','supplier_days',*months],['A','Synthetic','box',25,2,30,30,30,300],['B','Other','box',25,2,30,30,30,30]])
    rows=raw['planning_facts']['sales_history'];headers=list(rows[0])
    if blank:rows[-1]['project']=''
    write_csv(root,'sales_history.csv',[headers,*[[str(r[k]).lower() if isinstance(r[k],bool) else r[k] for k in headers] for r in rows]])
    return raw,months


@pytest.mark.parametrize('project_only',[False,True])
def test_actual_bundle_bridge_tool_cli_and_health_per_sku(tmp_path,project_only):
    raw,months=write_project_bundle(tmp_path,project_only)
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert data['items'][0]['planning_facts']['sales_history']==raw['planning_facts']['sales_history']
    assert 'planning_facts' not in data['items'][1]
    p,g=calculate(data['items'][0],months)
    payload=json.loads(tools.make_handler(today=date.fromisoformat(TODAY))({'source':'csv','bundle_path':str(tmp_path)}))
    assert payload['items'][0]['guidance']==g and g['quantity']==59
    child=subprocess.run(['/usr/bin/python3','stock_runway.py',str(tmp_path),'--bundle','--today',TODAY,'--all'],cwd=ROOT,text=True,capture_output=True)
    assert child.returncode==0,child.stderr
    import csv
    row=next(csv.DictReader(io.StringIO(child.stdout)))
    assert row['order_qty']=='59' and row['run_out']==g['runout_date']
    bridge=subprocess.run(['/usr/bin/python3','bundle_import.py',str(tmp_path),'--today',TODAY],cwd=ROOT,text=True,capture_output=True)
    assert bridge.returncode==0 and json.loads(bridge.stdout)==data
    h=data_health(data,TODAY)
    assert h['features']['project_exclusion']['items']['A']['state']=='on'
    assert h['features']['project_exclusion']['items']['B']['state']=='hidden'
    assert h['features']['stockout_correction']['items']['A']['state']==('hidden' if project_only else 'on')
    write_project_bundle(tmp_path,project_only,blank=True)
    invalid=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calculate(invalid['items'][0],months)[1]['purchase_hold']
    assert data_health(invalid,TODAY)['features']['project_exclusion']['items']['A']['state']=='locked'


def test_explicit_empty_project_file_preserves_locked_capability(tmp_path):
    write_project_bundle(tmp_path)
    write_csv(tmp_path,'sales_history.csv',[['sku','month','quantity','project']])
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calculate(data['items'][0],data['months'])[1]['purchase_hold']
    assert data_health(data,TODAY)['features']['project_exclusion']['state']=='locked'


def test_absent_project_whole_physical_guidance_json_equal_feature3():
    source=read_baseline('fa2da9e:engine.py', text=True)
    # Owner-approved Phase 4 method label accompanies the model substitution.
    source = source.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    old=types.ModuleType('f3baseline');exec(compile(source,'fa2da9e:engine.py','exec'),old.__dict__)
    old.demand_model = engine.demand_model  # Owner-approved Phase 4 model seam.
    corpus=json.loads((ROOT/'tests/golden/phase2-inputs.json').read_text())
    for case in corpus['cases']:
        raw=copy.deepcopy(case['item'])
        for r in raw.get('planning_facts',{}).get('sales_history',[]):r.pop('project',None)
        for settings in [{},{'big_order_months':6,'include_backup_in_orders':True}]:
            args=(raw,case['months'],ASOF,6,settings,TODAY)
            p=engine.forecast(*args);before=old.forecast(*args)
            assert_forecast_frozen(p,before,engine,raw,ASOF,TODAY,settings)
            merged={**raw,**p,'as_of':ASOF}
            assert_guidance_frozen(engine.order_guidance(merged,TODAY,settings),old.order_guidance(merged,TODAY,settings))


@pytest.mark.parametrize('partial',[False,True])
def test_absent_project_actual_tool_dto_bytes_equal_feature3(tmp_path,partial):
    import sys
    package_name='f4_absent_project_baseline'
    package=types.ModuleType(package_name);package.__path__=[str(ROOT)];sys.modules[package_name]=package
    for name in ['engine','sources','tools']:
        module=types.ModuleType(package_name+'.'+name);module.__package__=package_name;module.__file__=str(ROOT/(name+'.py'))
        sys.modules[module.__name__]=module
        source=read_baseline('fa2da9e:'+name+'.py', text=True)
        if name == 'engine':
            # Preserve the DTO byte oracle around the approved model/label seam.
            source=source.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
        exec(compile(source,'fa2da9e:'+name+'.py','exec'),module.__dict__)
        if name == 'engine':
            module.__dict__['demand_model']=engine.demand_model
    baseline=sys.modules[package_name+'.tools']
    raw,months=with_exposure(exposed=[31,30,15])
    write_csv(tmp_path,'stock.csv',[['sku','name','unit','on_hand','supplier_days',*months],['A','Synthetic','box',25,2,30,30,30]])
    rows=raw['planning_facts']['sales_history'];headers=list(rows[0])
    if partial:rows[-1]['in_stock_days']=''
    write_csv(tmp_path,'sales_history.csv',[headers,*[[str(r[k]).lower() if isinstance(r[k],bool) else r[k] for k in headers] for r in rows]])
    args={'source':'csv','bundle_path':str(tmp_path),'settings':{'big_order_months':6,'include_backup_in_orders':True}}
    assert_tool_forecast_frozen(tools.make_handler(today=date.fromisoformat(TODAY))(args),
                               baseline.make_handler(today=date.fromisoformat(TODAY))(args),
                               engine,sources.load_bundle(str(tmp_path),today=TODAY)['items'],TODAY,args['settings'])
    assert 'project_exclusion' not in sources.load_bundle(str(tmp_path),today=TODAY)['items'][0]['planning_facts'].get('errors',{})
