"""Synthetic health oracles + browser/Python parity, seeded and reproducible."""
from baseline import read_baseline
import copy
import json
from pathlib import Path
import random
import subprocess

from health import data_health

ROOT = Path(__file__).resolve().parents[1]


def fixture(n=24):
    months = [f'{2024 + i // 12}-{i % 12 + 1:02d}' for i in range(n)]
    return {'as_of': '2025-12-31', 'months': months, 'items': [
        {'sku': 'SYN-A', 'name': 'Synthetic item', 'unit': 'units', 'on_hand': 10,
         'monthly_sales': [10] * n}]}


def test_thresholds_and_no_mutation():
    d = fixture()
    saved = copy.deepcopy(d)
    assert data_health(d)['features']['seasonality']['state'] == 'on'
    assert d == saved
    future = fixture(30)
    future['as_of'] = '2025-11-30'
    assert data_health(future)['features']['seasonality']['state'] == 'locked'
    future['as_of'] = None
    assert data_health(future)['features']['seasonality']['state'] == 'locked'
    assert data_health(fixture(23))['features']['seasonality']['state'] == 'locked'
    d['partial_last_month'] = True
    assert data_health(d)['features']['seasonality']['state'] == 'locked'
    d = fixture(4)
    d['items'][0]['monthly_sales'] = [0, 0, 1, 1]
    assert data_health(d)['features']['intermittent']['state'] == 'locked'
    d['items'][0]['monthly_sales'] = [0, 0, 0, 1]
    assert data_health(d)['features']['intermittent']['state'] == 'on'


def test_dated_receipts_and_optional_capabilities():
    d = fixture()
    item = d['items'][0]
    item['receipt_history'] = [{'ordered_on': '2025-01-01', 'received_on': '2025-01-05', 'quantity': 10}] * 4
    assert data_health(d)['features']['lead_time_spread']['state'] == 'locked'
    item['receipt_history'].append({'ordered_on': '2025-02-01', 'received_on': '2025-02-08', 'quantity': 3})
    item.update(usable_on_hand=0, committed_orders=[{'quantity': 1}], substitutes=['SYN-B'],
                kit_components=['SYN-C'], warehouse_stock=[{'stock': 2}, {'stock': 3}])
    result = data_health(d)['features']
    assert all(result[k]['state'] == 'on' for k in ('lead_time_spread', 'usable_stock', 'committed_orders', 'receipts', 'substitutes', 'kits', 'multi_warehouse'))
    # Monthly totals are not dated lead-time observations.
    item.pop('receipt_history')
    item['historical_receipts'] = {'2025-01': 10, '2025-02': 10}
    assert data_health(d)['features']['lead_time_spread']['state'] == 'locked'


def test_warning_oracles():
    d = fixture()
    item = d['items'][0]
    item.update(on_hand=241, minimum_order=11, pack_size=6, max_stock=11)
    d['items'].append(copy.deepcopy(item))
    result = data_health(d, '2026-02-15')
    codes = {(w['code'], w['sku']) for w in result['warnings']}
    assert codes == {('unit_sanity', 'SYN-A'), ('order_conflict', 'SYN-A'), ('duplicate_sku', 'SYN-A'), ('stale_snapshot', '')}
    assert len(codes) == len(result['warnings'])
    assert not any(w['code'] == 'stale_snapshot' for w in data_health(d, '2026-02-14')['warnings'])
    item['on_hand'] = 240
    assert not any(w['code'] == 'unit_sanity' for w in data_health({'as_of': d['as_of'], 'months': d['months'], 'items': [item]})['warnings'])
    item['monthly_sales'][0] = -1
    del item['unit']
    codes = {w['code'] for w in data_health(d)['warnings']}
    assert {'negative_value', 'missing_value'} <= codes
    d['as_of'] = '2025-12-15'
    assert any(w['code'] == 'partial_month' for w in data_health(d)['warnings'])


def test_malformed_incoming_is_absent_and_huge_integers_warn():
    d = fixture()
    for value in [None, False, True, 3, 'receipt', {}, {'length': 2}, {'quantity': 3}, []]:
        d['items'][0]['open_receipts'] = value
        assert data_health(d)['features']['receipts']['state'] == 'hidden'
    d['items'][0]['open_receipts'] = [{'quantity': 3}]
    assert data_health(d)['features']['receipts']['state'] == 'locked'
    d['items'][0]['on_hand'] = 10**400
    assert {'code': 'invalid_value', 'sku': 'SYN-A', 'severity': 'error',
            'short_label': 'Invalid value'} in data_health(d)['warnings']


def test_python_js_seeded_fuzz_parity():
    rng = random.Random(73019)
    cases = [(None, None, {}), ({}, None, {}), (fixture(), '2026-02-15', {})]
    for value in [None, False, True, 3, 'receipt', {}, {'length': 2}, {'quantity': 3}, [], [{'quantity': 3}]]:
        d = fixture()
        d['items'][0]['open_receipts'] = value
        cases.append((d, None, {}))
    for field in ['on_hand', 'guidance', 'suggested_order']:
        d = fixture()
        d['items'][0][field] = {'quantity': 241} if field == 'guidance' else 241
        codes = {w['code'] for w in data_health(d)['warnings']}
        assert 'excess_stock' not in codes
        assert 'unit_sanity' in codes
        cases.append((d, None, {}))
    for key in ['on_hand', 'on_order', 'pack_size', 'minimum_order', 'max_stock']:
        d = fixture()
        d['items'][0][key] = 10**400
        cases.append((d, None, {}))
    for key in ['monthly_sales', 'receipts', 'historical_receipts']:
        d = fixture()
        if key == 'monthly_sales':
            d['items'][0][key][0] = 10**400
        else:
            d['items'][0][key] = {'2025-12': 10**400}
        cases.append((d, None, {}))
    for sku_kind in ['missing', None, 0]:
        for capability in ['empty', 'stockout', 'project', 'manual', 'combined']:
            d = fixture()
            item = d['items'][0]
            if sku_kind == 'missing':
                item.pop('sku')
            else:
                item['sku'] = sku_kind
            item['planning_facts'] = {'version': '1.0'}
            if capability in ('stockout', 'project', 'combined'):
                rows = []
                for month in d['months']:
                    row = dict(month=month, quantity=10)
                    if 'sku' in item:
                        row['sku'] = item['sku']
                    if capability in ('stockout', 'combined'):
                        row.update(in_stock_days=10, backorder=False)
                    if capability in ('project', 'combined'):
                        row['project'] = False
                    rows.append(row)
                item['planning_facts']['sales_history'] = rows
            if capability in ('manual', 'combined'):
                item['demand_change_pct'] = 10
            cases.append((d, None, {}))
    for _ in range(320):
        d = fixture(rng.choice([0, 3, 4, 12, 23, 24, 25]))
        d['as_of'] = rng.choice(['2025-12-31', '2025-12-15', '2025-02-30', None])
        item = d['items'][0]
        for key in ('on_hand', 'on_order', 'damaged', 'reserved', 'usable_on_hand', 'pack_size', 'minimum_order', 'max_stock'):
            if rng.random() < .5:
                item[key] = rng.choice([None, -3, 0, .5, 1, 9, 12, 1000, 'bad', True])
        item['monthly_sales'] = [rng.choice([0, 0, 0, 3, 10, 12]) for _ in d['months']]
        if rng.random() < .2 and item['monthly_sales']:
            item['monthly_sales'][0] = rng.choice([None, -1, 'bad', False])
        if rng.random() < .2:
            d['months'] = ['bad'] + d['months'][1:]
        if rng.random() < .2:
            item.pop(rng.choice(['sku', 'name', 'unit', 'on_hand', 'monthly_sales']))
        item['receipt_history'] = [{'ordered_on': '2025-01-01', 'received_on': rng.choice(['2025-01-05', '2024-12-31', None]), 'quantity': rng.choice([0, 3, -1])} for _ in range(rng.randrange(7))]
        if rng.random() < .2:
            d['items'].append(copy.deepcopy(item))
        item['receipts'] = {'2026-01': rng.choice([0, 3, -1, None])}
        item['substitutes'] = rng.choice([[], ['SYN-B'], None])
        item['kit_components'] = rng.choice([[], ['SYN-C']])
        item['warehouse_stock'] = rng.choice([[], [{}, {}]])
        item['open_receipts'] = rng.choice([[], [{'quantity': 3}]])
        item['guidance'] = {'quantity': rng.choice([0, 100000])}
        if rng.random() < .7:
            item['last_count_date'] = rng.choice(['2025-01-01','2025-12-31','2026-02-30','2027-01-01',None,''])
        cases.append((d, rng.choice(['2026-01-01', '2026-02-15', None]), {}))
    script = """const fs=require('node:fs'),vm=require('node:vm');
    const context=vm.createContext({TextEncoder,TextDecoder});
    const plugin=fs.readFileSync('desktop/plugin.js','utf8');
    vm.runInContext(plugin.slice(plugin.indexOf('const SAMPLE ='),plugin.indexOf('const pageStyle =')).replaceAll('export ','')+String.fromCharCode(10)+fs.readFileSync('standalone/design/health.js','utf8'),context);
    const cases=JSON.parse(fs.readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify(cases.map(args=>context.dataHealth(...args))));"""

    run = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(cases), text=True, capture_output=True)
    assert run.returncode == 0, run.stderr
    actual = json.loads(run.stdout)
    assert len(actual) == len(cases)
    for args, result in zip(cases, actual):
        assert result == data_health(*args), args
        assert all(len(w['short_label'].split()) <= 3 for w in result['warnings'])
        assert all(f['state'] in ('hidden', 'locked', 'on') for f in result['features'].values())


def test_no_optional_health_equals_base_in_python_and_js():
    baseline = {}
    source = read_baseline('3dde510:health.py', text=True)
    exec(compile(source, '3dde510:health.py', 'exec'), baseline)
    cases = []
    for stock, suggested in [(-5, None), (241, None), (241, 241)]:
        d = dict(as_of='2026-03-31', months=['2026-01', '2026-02', '2026-03'],
                 items=[dict(sku='A', name='Synthetic', unit='ea', on_hand=stock, monthly_sales=[10]*3)])
        if suggested is not None:
            d['items'][0]['suggested_order'] = suggested
        cases.append(d)
    sample = json.loads((ROOT / 'data/sample.json').read_text())
    cases.append(sample)
    health_sample = copy.deepcopy(sample)
    health_sample['partial_last_month'] = True
    for i, item in enumerate(health_sample['items']):
        item.update(sku=f'SYN-HEALTH-{i}', name=f'Synthetic product {i}')
    health_sample['items'][0].update(on_hand=1000000, pack_size=6, minimum_order=11, max_stock=11)
    cases.append(health_sample)
    script = """const fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
    const sources=[fs.readFileSync('standalone/design/health.js','utf8'),BASELINE_HEALTH_JS];
    const cases=JSON.parse(fs.readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify(sources.map(source=>{
      const c=vm.createContext({});vm.runInContext(source,c);
      return cases.map(d=>c.dataHealth(d,'2026-11-12'));
    })));"""
    script = script.replace('BASELINE_HEALTH_JS', json.dumps(read_baseline('3dde510:standalone/design/health.js', text=True)))
    run = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(cases), text=True, capture_output=True)
    assert run.returncode == 0, run.stderr
    current_js, base_js = json.loads(run.stdout)
    for d, js, old_js in zip(cases, current_js, base_js):
        expected = baseline['data_health'](d, '2026-11-12')
        current = data_health(d, '2026-11-12')
        assert current['features'].pop('smart_forecast')['state'] == 'locked'
        assert js['features'].pop('smart_forecast')['state'] == 'locked'
        assert current == expected
        assert js == old_js == expected
    assert len(data_health(health_sample, '2026-11-12')['warnings']) == 3


def test_stock_accuracy_warning_codes_thresholds_and_purity():
    from datetime import date, timedelta
    d=fixture();item=d['items'][0];today='2026-01-01'
    item['last_count_date']='2025-12-31'
    item['on_hand']=-1
    assert 'negative_stock' in {w['code'] for w in data_health(d,today)['warnings']}
    item['on_hand']=240
    assert 'excess_stock' not in {w['code'] for w in data_health(d,today)['warnings']}
    item['on_hand']=240.001
    assert 'excess_stock' in {w['code'] for w in data_health(d,today)['warnings']}
    item['monthly_sales']=[0]*24
    assert 'excess_stock' not in {w['code'] for w in data_health(d,today)['warnings']}  # no baseline, no invented ratio
    for age,expected in [(180,False),(181,True)]:
        item['last_count_date']=(date.fromisoformat(today)-timedelta(days=age)).isoformat()
        saved=copy.deepcopy(d);warnings=data_health(d,today)['warnings']
        assert ('stale_stock_count' in {w['code'] for w in warnings})==expected
        assert d==saved
        assert all(len(w['short_label'].split())<=3 for w in warnings)
    for value in ['2026-02-30','2026-01-02',None,'']:
        item['last_count_date']=value
        assert 'invalid_count_date' in {w['code'] for w in data_health(d,today)['warnings']}
    item.pop('last_count_date')
    assert not any(w['code'] in ('stale_stock_count','invalid_count_date') for w in data_health(d,today)['warnings'])
