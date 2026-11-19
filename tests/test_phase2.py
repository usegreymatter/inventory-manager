"""Dated supply/commitment milestone: actual load, physical and purchase surfaces."""
import copy
import csv
from datetime import date
import importlib
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen, assert_guidance_frozen, assert_bucket_policy
import json
from pathlib import Path
import subprocess
import sys
import types

import pytest
import engine
from health import data_health

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('phase2_package')
package.__path__ = [str(ROOT)]
sys.modules.setdefault(package.__name__, package)
sources = importlib.import_module(package.__name__ + '.sources')
tools = importlib.import_module(package.__name__ + '.tools')
MONTHS = ['2026-08', '2026-09', '2026-10']
ASOF = '2026-10-31'
TODAY = '2026-11-01'


def item(stock=10, sales=30):
    return dict(sku='A', name='Synthetic', unit='box', on_hand=stock, supplier_days=2,
                monthly_sales=[sales] * 3, receipts={})


def po(due='2026-11-20', qty=60, status='confirmed', key='P'):
    return dict(po_line_id=key, sku='A', warehouse='MAIN', supplier='S', remaining_qty=qty, due_date=due, status=status)


def with_supply(raw=None, rows=None):
    raw = item() if raw is None else copy.deepcopy(raw)
    raw['planning_facts'] = dict(version='1.0', warehouses=['MAIN'], incoming_pos=[po()] if rows is None else rows)
    return raw


def calc(raw, today=TODAY, settings=None):
    physical = engine.forecast(raw, MONTHS, ASOF, settings=settings, today=today)
    merged = dict(raw, **{k:v for k,v in physical.items() if k not in raw})
    merged.update(physical, as_of=ASOF)
    guidance = engine.order_guidance(merged, today, settings, ASOF)
    return physical, guidance


def write_csv(root, name, rows):
    with (root/name).open('w', newline='') as handle:
        csv.writer(handle).writerows(rows)


def bundle(root, rows=None, stock=10):
    write_csv(root, 'stock.csv', [['sku','name','unit','on_hand','supplier_days',*MONTHS],['A','Synthetic','box',stock,2,30,30,30],['B','Other','box',20,2,30,30,30]])
    write_csv(root, 'warehouses.csv', [['warehouse','name'],['MAIN','Main']])
    supplied = [po()] if rows is None else rows
    write_csv(root, 'incoming_pos.csv', [list(po()), *[list(r.values()) for r in supplied]])


def test_exact_date_shortage_survives_later_recovery():
    physical, g = calc(with_supply())
    assert physical['projection'][0] == dict(month='2026-11', demand=30, receipts=60, stock=40)
    assert physical['runout_day'] == g['runout_date'] == '2026-11-10'
    assert g['delivery_date'] == '2026-11-20'
    assert g['supply_gap'] and not g['purchase_hold']
    # Before Nov20 receipt: 20 days * 1/day - stock10 = 10.
    # Endpoint Jan9: 30+30+270/31 - 10 - receipt60 < 0.
    assert g['quantity'] == 10
    # A month-start receipt would erase November's shortage.
    assert calc(item() | {'receipts': {'2026-11':60}})[1]['runout_date'] > '2026-11-20'


def test_due_today_usable_but_yesterday_is_unresolved():
    raw = with_supply(rows=[po('2026-11-01')])
    physical, g = calc(raw)
    assert not g['purchase_hold'] and g['projected_balance_today'] == 69
    physical, g = calc(raw, '2026-11-02')
    assert physical['projection'][0]['receipts'] == 0
    assert physical['runout_day'] == g['runout_date'] == '2026-11-10'
    assert g['status'] == 'needs-data' and g['quantity'] is None and g['order_by'] is None
    assert g['scenario_quantity'] > 0 and g['late_po_quantity'] == 60
    assert 'Late PO' in g['reason']
    # Roll-forward from historical snapshot never marks scheduled PO fulfilled.
    assert g['projected_balance_today'] == 8


@pytest.mark.parametrize('status', ['draft','cancelled','received'])
def test_non_open_supply_excluded(status):
    physical, g = calc(with_supply(rows=[po(status=status)]))
    assert physical['projection'][0]['receipts'] == 0
    assert not g['purchase_hold']


def test_supply_before_depletion_day_and_multiple_partial_balances():
    raw = with_supply(rows=[po('2026-11-10', 5), po('2026-11-15', 5, key='P2')])
    physical, g = calc(raw)
    assert physical['runout_day'] == g['runout_date'] == '2026-11-20'
    assert physical['projection'][0]['receipts'] == 10


@pytest.mark.parametrize('mutation', [
    lambda r:r.update(due_date='2026-02-30'), lambda r:r.update(remaining_qty=-1),
    lambda r:r.update(status='unknown'), lambda r:r.update(supplier=''),
    lambda r:r.update(warehouse='UNKNOWN'), lambda r:r.update(sku='B'),
    lambda r:r.update(remaining_qty=True), lambda r:r.update(po_line_id=' P'),
])
def test_invalid_fact_holds_and_is_not_supply(mutation):
    row=po();mutation(row)
    physical,g=calc(with_supply(rows=[row]))
    assert not physical['held'] and physical['projection'][0]['receipts'] == 0
    assert g['purchase_hold'] and g['quantity'] is None


@pytest.mark.parametrize('field,value', [('on_order',10),('receipts',{'2026-11':10})])
def test_overlapping_supply_held(field,value):
    raw=with_supply();raw[field]=value
    physical,g=calc(raw)
    assert g['purchase_hold'] and g['status']=='needs-data'
    assert physical['projection'][0]['receipts'] == (10 if field=='receipts' else 0)


def test_bundle_actual_source_tool_and_bridge(tmp_path):
    bundle(tmp_path)
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert 'planning_facts' in data['items'][0] and 'planning_facts' not in data['items'][1]
    payload=json.loads(tools.make_handler(today=date.fromisoformat(TODAY))({'source':'csv','bundle_path':str(tmp_path)}))
    assert 'error' not in payload
    raw=data['items'][0];physical,g=calc(raw)
    actual=payload['items'][0]
    assert actual['runout_day']==physical['runout_day']
    assert actual['guidance']==g
    assert actual['order_bucket']==engine.order_bucket(dict(raw,**{k:v for k,v in physical.items() if k not in raw},as_of=ASOF),TODAY)
    output=subprocess.run(['/usr/bin/python3','bundle_import.py',str(tmp_path),'--today',TODAY],cwd=ROOT,text=True,capture_output=True)
    assert output.returncode==0,output.stderr
    assert json.loads(output.stdout)==data


def test_partial_invalid_bundle_scopes_gate_to_sku(tmp_path):
    row=po();row['due_date']='2026-02-30';bundle(tmp_path,[row])
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calc(data['items'][0])[1]['purchase_hold']
    assert 'planning_facts' not in data['items'][1]
    (tmp_path/'warehouses.csv').unlink()
    assert calc(sources.load_bundle(str(tmp_path),today=TODAY)['items'][0])[1]['purchase_hold']


def test_health_gate_only_valid_per_sku():
    raw=with_supply(rows=[po('2026-11-01')])
    data=dict(items=[raw,item()|{'sku':'B'}],as_of=ASOF,months=MONTHS)
    gate=data_health(data,TODAY)['features']['dated_incoming']
    assert gate['items']['A']['state']=='on' and gate['items']['B']['state']=='hidden'
    health=data_health(data,'2026-11-02')
    assert health['features']['dated_incoming']['items']['A']['state']=='locked'
    assert any(w['short_label']=='Late PO' for w in health['warnings'])


def test_absent_facts_entire_forecast_and_guidance_equal_phase1():
    old=read_baseline('a0b3264:engine.py', text=True)
    # Owner-approved Phase 4 method label accompanies the model substitution.
    old = old.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    baseline=types.ModuleType('phase1_engine');exec(compile(old,'phase1_engine','exec'),baseline.__dict__)
    baseline.demand_model = engine.demand_model  # Owner-approved Phase 4 model seam.
    for dataset in [sources.load_sample(), *[sources.load_csv(str(p)) for p in sorted((ROOT/'docs/erp-examples').glob('*.csv'))]]:
        for raw in dataset['items']:
            for settings in [{},{'months_of_cover':1.5,'buffer_days':0},{'include_backup_in_orders':True}]:
                args=(raw,dataset['months'],dataset['as_of'],6,settings,TODAY)
                actual=engine.forecast(*args)
                assert_forecast_frozen(actual,baseline.forecast(*args),engine,raw,dataset['as_of'],TODAY,settings)
                merged={**raw,**actual,'as_of':dataset['as_of']}
                assert_guidance_frozen(engine.order_guidance(merged,TODAY,settings),baseline.order_guidance(merged,TODAY,settings))
                assert_bucket_policy(engine,merged,TODAY,settings)
