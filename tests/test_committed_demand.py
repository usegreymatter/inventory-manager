"""Feature 2 policy oracles: dated forecast consumption and approval boundaries."""
import copy
import csv
from datetime import date
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import types

import pytest
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen, assert_guidance_frozen, purchase_golden
import engine
from health import data_health
from test_phase2 import item, po, with_supply, calc, write_csv, bundle, sources, tools, ROOT, MONTHS, ASOF, TODAY


def order(qty=20, due='2026-11-10', included=True, key='O', status='confirmed'):
    return dict(order_line_id=key, sku='A', warehouse='MAIN', quantity=qty,
                delivery_date=due, status=status, forecast_included=included)


def clean_state(site='MAIN', reserved=0):
    return dict(sku='A', warehouse=site, damaged=0, reserved=reserved, quarantine=0, returns=0)


def with_orders(raw=None, rows=None, states=True):
    raw=copy.deepcopy(item(25) if raw is None else raw)
    facts=raw.setdefault('planning_facts',dict(version='1.0',warehouses=['MAIN']))
    facts['customer_orders']=[order()] if rows is None else rows
    if states:facts['stock_states']=[clean_state()]
    return raw


def test_included_consumes_baseline_on_date_not_twice():
    raw=with_orders()
    p,g=calc(raw)
    assert not g['purchase_hold']
    assert p['projection'][0]['demand']==30  # residual 10 + commitment 20
    assert p['projection'][0]['stock']==-5
    assert p['runout_day']==g['runout_date']=='2026-11-15'
    assert g['quantity']==49
    merged={**raw,**p,'as_of':ASOF}
    facts=engine.planning_event_facts(raw,ASOF,TODAY)
    assert float(engine.dated_demand(merged,ASOF,engine.date_ordinal('2026-11-09'),facts))==3
    assert float(engine.dated_demand(merged,ASOF,engine.date_ordinal('2026-11-10'),facts))==pytest.approx(20+10/3)


@pytest.mark.parametrize('qty,included,monthly,runout,purchase', [
    (30,True,30,'2026-11-20',54),
    (80,True,80,'2026-11-20',104),
    (20,False,50,'2026-11-10',64),
])
def test_effective_month_formula(qty,included,monthly,runout,purchase):
    due='2026-11-20' if included else '2026-11-10'
    p,g=calc(with_orders(rows=[order(qty,due,included)]))
    assert p['projection'][0]['demand']==monthly
    assert p['runout_day']==g['runout_date']==runout
    assert g['quantity']==purchase


def test_mixed_included_incremental_and_month_boundaries():
    rows=[order(20),order(5,included=False,key='ADD'),order(40,'2026-12-01',key='DEC')]
    p,g=calc(with_orders(rows=rows))
    assert [m['demand'] for m in p['projection'][:3]]==[35,40,30]
    assert p['runout_day']==g['runout_date']=='2026-11-10'
    assert g['quantity']==59
    # The December inclusion cannot displace any November baseline.
    assert p['projection'][0]['stock']==-10


def test_no_sales_commitment_still_depletes_and_is_not_no_sales_bucket():
    raw=with_orders(item(10,0),[order(20,'2026-11-20')])
    p,g=calc(raw)
    assert p['runout_day']==g['runout_date']=='2026-11-20'
    assert p['projection'][0]['demand']==20 and g['quantity']==10
    raw=with_orders(item(100,0),[order(20,'2026-11-20')])
    p,g=calc(raw)
    assert g['quantity']==0 and not g['purchase_hold']
    assert engine.order_bucket({**raw,**p,'as_of':ASOF},TODAY)!='no-sales'


def test_overdue_obligations_adopt_today_and_today_month():
    raw=with_orders(rows=[order(40,'2026-10-20'),order(10,'2026-11-12',False,'YESTERDAY')])
    p,g=calc(raw,'2026-11-13')
    assert p['runout_day']==g['runout_date']=='2026-11-13'
    assert p['projection'][0]['demand']==50
    assert g['overdue_order_quantity']==50 and p['overdue_order_quantity']==50
    assert g['projected_balance_today']==-25
    assert not g['purchase_hold']
    p,g=calc(with_orders(rows=[order(40,'2026-11-13')]),'2026-11-13')
    assert g['overdue_order_quantity']==0
    p,g=calc(with_orders(rows=[order(40,'2026-11-20')]),'2026-12-02')
    assert [m['demand'] for m in p['projection'][:2]]==[30,40]
    # No phantom November fulfillment: old baseline + outstanding December obligation.
    assert g['projected_balance_today']==-45


def test_snapshot_cutoff_adopts_older_order_next_business_day():
    p,g=calc(with_orders(rows=[order(30,'2026-10-31')]),ASOF)
    assert p['runout_day']==g['runout_date']=='2026-11-01'
    assert g['overdue_order_quantity']==30
    assert g['projected_balance_today']==25


def test_same_day_all_receipts_then_obligations_then_residual():
    raw=with_orders(with_supply(item(25,0),[po('2026-11-10',5),po('2026-11-10',10,key='P2')]),
                    [order(15,key='O1'),order(20,key='O2')])
    p,g=calc(raw)
    assert p['runout_day'] is None and g['runout_date'] is None
    assert p['projection'][0]['stock']==5 and g['quantity']==0
    raw=with_orders(with_supply(item(5),[po('2026-11-01',20)]),[order(20,'2026-11-01')])
    p,g=calc(raw)
    assert p['runout_day']==g['runout_date']=='2026-11-15'
    # Changing file row order cannot create a same-day artificial shortage.
    raw['planning_facts']['incoming_pos'].reverse();raw['planning_facts']['customer_orders'].reverse()
    assert calc(raw)[0]==p


@pytest.mark.parametrize('status',['draft','cancelled'])
def test_excluded_orders_do_not_consume_forecast(status):
    p,g=calc(with_orders(rows=[order(999,status=status)]))
    assert p['projection'][0]['demand']==30 and p['runout_day']=='2026-11-25'
    assert g['committed_quantity']==0 and not g['purchase_hold']


@pytest.mark.parametrize('mutation',[
    lambda r:r.update(quantity=-1), lambda r:r.update(quantity=True),
    lambda r:r.update(delivery_date='2026-02-30'),lambda r:r.update(forecast_included=None),
    lambda r:r.update(forecast_included='true'),lambda r:r.update(warehouse='UNKNOWN'),
    lambda r:r.update(status='delivered'),lambda r:r.update(order_line_id=' O'),
    lambda r:r.update(sku='B'),
])
def test_invalid_customer_facts_hold_without_partial_demand(mutation):
    row=order();mutation(row)
    p,g=calc(with_orders(rows=[order(key='VALID'),row]))
    assert g['purchase_hold'] and g['status']=='needs-data' and g['quantity'] is None
    assert p['projection'][0]['demand']==30 and p['runout_day']=='2026-11-25'


def test_reservations_unknown_positive_or_partial_always_hold_no_double_draw():
    raw=with_orders(states=False)
    p,g=calc(raw)
    assert g['purchase_hold'] and g['quantity'] is None and g['scenario_quantity']==49
    assert p['projection'][0]['demand']==30 and p['projection'][0]['stock']==-5
    raw['planning_facts']['stock_states']=[clean_state(reserved=5)]
    assert calc(raw)[1]['scenario_quantity']==49
    assert calc(raw)[1]['purchase_hold']
    # An unvalidated mapping assertion cannot grant approval in this milestone.
    raw['planning_facts']['reservation_mapping']=[{'order_line_id':'O','quantity':5}]
    assert calc(raw)[1]['purchase_hold']
    raw['planning_facts']['stock_states']=[clean_state()]
    assert not calc(raw)[1]['purchase_hold']
    raw['planning_facts']['stock_states'].append(clean_state())
    assert calc(raw)[1]['purchase_hold']


def test_invalid_demand_does_not_hide_valid_supply_and_late_supply_hold_survives():
    raw=with_orders(with_supply(),[order()|{'forecast_included':None}])
    p,g=calc(raw)
    assert p['projection'][0]['receipts']==60 and g['purchase_hold']
    raw=with_orders(with_supply(item(25),[po('2026-10-31')]))
    p,g=calc(raw)
    assert p['projection'][0]['demand']==30 and p['projection'][0]['receipts']==0
    assert g['purchase_hold'] and g['late_po_quantity']==60 and 'Late PO' in g['reason']


def write_customer_bundle(root, reserved=0):
    bundle(root,stock=25)
    (root/'incoming_pos.csv').unlink()
    r=order()
    write_csv(root,'customer_orders.csv',[list(r),list(r.values())[:-1]+['true']])
    write_csv(root,'warehouse_stock.csv',[['sku','warehouse','on_hand'],['A','MAIN',25],['B','MAIN',20]])
    r=clean_state(reserved=reserved)
    write_csv(root,'stock_states.csv',[list(r),list(r.values())])


def test_actual_bundle_bridge_tool_cli_and_health(tmp_path):
    write_customer_bundle(tmp_path)
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    raw=data['items'][0];p,g=calc(raw)
    assert not g['purchase_hold'] and g['quantity']==49
    assert 'planning_facts' not in data['items'][1]
    tool=json.loads(tools.make_handler(today=date.fromisoformat(TODAY))({'source':'csv','bundle_path':str(tmp_path)}))
    assert tool['items'][0]['guidance']==g and tool['items'][0]['projection']==p['projection']
    exported=subprocess.run(['/usr/bin/python3','stock_runway.py',str(tmp_path),'--bundle','--today',TODAY,'--all'],cwd=ROOT,text=True,capture_output=True)
    assert exported.returncode==0,exported.stderr
    row=next(csv.DictReader(io.StringIO(exported.stdout)))
    assert row['order_qty']=='49' and row['run_out']==g['runout_date']
    bridge=subprocess.run(['/usr/bin/python3','bundle_import.py',str(tmp_path),'--today',TODAY],cwd=ROOT,text=True,capture_output=True)
    assert bridge.returncode==0,bridge.stderr
    assert json.loads(bridge.stdout)==data
    gates=data_health(data,TODAY)['features']['committed_demand']['items']
    assert gates['A']['state']=='on' and gates['B']['state']=='hidden'
    # Source gate is CSV-ready, runtime policy additionally rejects positive reservations.
    write_customer_bundle(tmp_path,reserved=5)
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calc(data['items'][0])[1]['purchase_hold']
    assert data_health(data,TODAY)['features']['committed_demand']['items']['A']['state']=='locked'


def test_invalid_bundle_demand_scoped_and_partial_reservations(tmp_path):
    write_customer_bundle(tmp_path)
    text=(tmp_path/'customer_orders.csv').read_text().replace('true','')
    (tmp_path/'customer_orders.csv').write_text(text)
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calc(data['items'][0])[1]['purchase_hold'] and 'planning_facts' not in data['items'][1]
    write_customer_bundle(tmp_path)
    (tmp_path/'warehouse_stock.csv').unlink()
    data=sources.load_bundle(str(tmp_path),today=TODAY)
    assert calc(data['items'][0])[1]['purchase_hold']
    assert calc(data['items'][0])[0]['runout_day']=='2026-11-15'


def test_feature1_whole_physical_and_guidance_stay_equal_committed_baseline():
    old=read_baseline('afea1c3:engine.py', text=True)
    # Keep the complete physical/guidance oracle around the approved model seam.
    old=old.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    baseline=types.ModuleType('supply_engine');exec(compile(old,'supply_engine','exec'),baseline.__dict__)
    baseline.__dict__['demand_model']=engine.demand_model
    for stock in [0,3.5,25,200]:
        for today in [TODAY,'2026-11-13','2026-12-02']:
            for due in ['2026-10-31',TODAY,'2026-11-20']:
                raw=with_supply(item(stock),[po(due)])
                p,g=calc(raw,today)
                expected=baseline.forecast(raw,MONTHS,ASOF,6,None,today)
                assert_forecast_frozen(p,expected,engine,raw,ASOF,today)
                assert_guidance_frozen(g,baseline.order_guidance({**raw,**expected,'as_of':ASOF},today))


def test_reviewed_optional_goldens_all_surfaces_and_actual_sources(tmp_path):
    inputs=json.loads((ROOT/'tests/golden/phase2-inputs.json').read_text())
    expected=purchase_golden('phase2')
    spec=importlib.util.spec_from_file_location('optional_golden',ROOT/'scripts/golden_diff.py')
    golden=importlib.util.module_from_spec(spec);spec.loader.exec_module(golden)
    assert golden.collect(inputs)==expected
    assert len(expected)==19  # original twelve plus seven project/outlier cases; no old fields dropped
    for case,want in zip(inputs['cases'],expected):
        raw=case['item'];root=tmp_path/raw['sku'];root.mkdir()
        write_csv(root,'stock.csv', [['sku','name','unit','on_hand','supplier_days',*case['months']],
                                   [raw['sku'],raw['name'],raw['unit'],raw['on_hand'],raw['supplier_days'],*raw['monthly_sales']]])
        write_csv(root,'warehouses.csv',[['warehouse','name'],['MAIN','Main']])
        write_csv(root,'warehouse_stock.csv',[['sku','warehouse','on_hand'],[raw['sku'],'MAIN',raw['on_hand']]])
        for table in ['customer_orders','stock_states','incoming_pos','sales_history']:
            rows=raw['planning_facts'].get(table)
            if not rows:continue
            headers=list(rows[0]);values=[]
            for row in rows:
                values.append([str(row[k]).lower() if isinstance(row[k],bool) else row[k] for k in headers])
            write_csv(root,table+'.csv',[headers,*values])
        loaded=sources.load_bundle(str(root),today=inputs['today'])
        actual=json.loads(tools.make_handler(today=date.fromisoformat(inputs['today']))({'source':'csv','bundle_path':str(root)}))
        g=actual['items'][0]['guidance']
        tool=dict(order_qty=g.get('quantity'),order_by=g.get('order_by'),run_out=g.get('runout_date'),status=actual['items'][0]['order_bucket'])
        assert tool==want['python']
        child=subprocess.run(['/usr/bin/python3','stock_runway.py',str(root),'--bundle','--today',inputs['today'],'--all'],cwd=ROOT,text=True,capture_output=True)
        assert child.returncode==0,child.stderr
        row=next(csv.DictReader(io.StringIO(child.stdout)))
        exported={k:row[k] or None for k in ['order_by','run_out','status']}
        exported['order_qty']=float(row['order_qty']) if row['order_qty'] else None
        assert exported==want['cli']
        # Real strict bundle path and bridge row types match direct fact fixtures.
        for table in ['customer_orders','sales_history']:
            if table in raw['planning_facts']:
                assert loaded['items'][0]['planning_facts'][table]==raw['planning_facts'][table]


@pytest.mark.parametrize('rows,states', [
    ([order(),order(key='O')],[clean_state()]),
    ([order()],[clean_state()|{'reserved':None}]),
    ([order()],[clean_state()|{'reserved':True}]),
    ([order()],[clean_state('OTHER')]),
    ([],[clean_state()]),
])
def test_duplicate_and_partial_metadata_gates(rows,states):
    raw=with_orders(rows=rows);raw['planning_facts']['stock_states']=states
    assert calc(raw)[1]['purchase_hold']
