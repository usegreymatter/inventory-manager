"""Owner-approved Phase 1 maths, separate from legacy/backtest safeguards."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("phase1_cli", ROOT / "stock_runway.py")
assert spec is not None and spec.loader is not None
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
engine, _ = cli._load_modules()


def test_fractional_months_accumulate_before_single_purchase_rounding():
    model = engine.demand_model([10.125, 10.25, 10.375], '2026-10')
    assert engine.month_demand(model, '2026-11') == 10.25
    # Exactly two full months; early ceilings would turn 20.5 into 22.
    assert engine.planning_calendar_demand(model, '2026-10', 61) == 20.5
    assert engine.suggested_order_quantity(20.5, 0, []) == 21
    assert engine.suggested_order_quantity(20.5, 0, [], {'pack_size': 2.5}) == 22.5
    assert engine.suggested_order_quantity(20.5, 0, [], {'minimum_order': 10000, 'pack_size': 12}) == 10008


def test_status_cover_uses_same_calendar_crossing_as_order_date():
    data = __import__('json').loads((ROOT / 'data/sample.json').read_text())
    raw = next(i for i in data['items'] if i['sku'] == 'SEAL-CLR-300')
    item = {**raw, **engine.forecast(raw, data['months'], data['as_of']), 'as_of': data['as_of']}
    guidance = engine.order_guidance(item, '2026-11-12')
    cover = (engine.date_ordinal(guidance['runout_date']) - engine.date_ordinal('2026-11-12')) / 30
    assert guidance['overstock_months'] == cover
    assert engine.order_bucket(item, '2026-11-12') == 'healthy'
    # Lead-time urgency wins over abundant snapshot stock; never Overstocked + order now.
    long_lead = {**item, 'supplier_days': 240}
    assert engine.order_guidance(long_lead, '2026-11-12')['order_by'] == 'now'
    assert engine.order_bucket(long_lead, '2026-11-12') == 'order'


def test_buffer_days_adds_end_window_demand_without_moving_trigger_or_runout():
    raw = dict(sku='BUFFER', name='Synthetic', unit='ea', on_hand=300,
               monthly_sales=[30,30,30], supplier_days=14, receipts={})
    physical = engine.forecast(raw, ['2026-08','2026-09','2026-10'], '2026-10-31')
    item = {**raw, **physical, 'as_of':'2026-10-31'}
    zero = engine.order_guidance(item, '2026-11-12', {'buffer_days':0})
    default = engine.order_guidance(item, '2026-11-12')
    assert zero == default  # Policy v2 default is zero buffer.
    for backup in [False,True]:
        settings = {'buffer_days':0,'include_backup_in_orders':backup}
        baseline = engine.order_guidance(item, '2026-11-12', settings)
        for buffer in [0,7,30,3650]:
            g = engine.order_guidance(item, '2026-11-12', {**settings,'buffer_days':buffer})
            from fractions import Fraction
            from datetime import date, timedelta
            import calendar, math
            start = date.fromisoformat('2026-10-31')
            end = date.fromisoformat(g['endpoint']) + timedelta(days=min(buffer,365))
            demand = Fraction(0)
            while start < end:
                start += timedelta(days=1)
                demand += Fraction(30,calendar.monthrange(start.year,start.month)[1])
            assert g['quantity'] == math.ceil(max(Fraction(0),demand-300))
            assert g['runout_date'] == baseline['runout_date']
            assert g['order_by'] == baseline['order_by']
            assert g['endpoint'] == baseline['endpoint']
    assert engine.normalize_order_settings()['buffer_days'] == 0
    for invalid in [-1,1.5,True,'7',None,3651]:
        assert engine.normalize_order_settings({'buffer_days':invalid})['buffer_days'] == 0
    assert engine.normalize_order_settings({'buffer_days':0})['buffer_days'] == 0


def test_cli_and_slash_accept_explicit_buffer_days():
    import subprocess
    command = subprocess.run(['python3', str(ROOT/'stock_runway.py'), '--help'], text=True, capture_output=True)
    assert command.returncode == 0
    assert '--buffer-days' in command.stdout
    import types, sys, importlib
    pkg = types.ModuleType('phase1_slash'); pkg.__path__ = [str(ROOT)]; sys.modules[pkg.__name__] = pkg
    commands = importlib.import_module(pkg.__name__ + '.commands')
    assert commands.build_args('--buffer-days 0') == {'source':'sample','settings':{'buffer_days':0}}
    assert commands.build_args('A --buffer-days 21')['settings'] == {'buffer_days':21}
    assert 'error' in commands.build_args('--buffer-days -1')


def test_cli_process_buffer_validation_and_zero_override(tmp_path):
    import csv, io, subprocess
    source = tmp_path/'synthetic.csv'
    source.write_text('sku,name,unit,on_hand,supplier_days,2026-08,2026-09,2026-10\nA,Synthetic,ea,300,14,30,30,30\n')
    def run(*args):
        return subprocess.run(['python3',str(ROOT/'stock_runway.py'),str(source),'--today','2026-11-12','--all',*args],text=True,capture_output=True)
    default = run(); zero = run('--buffer-days','0')
    assert default.returncode == zero.returncode == 0
    a, = csv.DictReader(io.StringIO(default.stdout)); b, = csv.DictReader(io.StringIO(zero.stdout))
    assert b['order_by'] == a['order_by']
    assert a['order_qty'] == b['order_qty']
    assert b['arrives_by'] == a['arrives_by']
    extra, = csv.DictReader(io.StringIO(run('--buffer-days','7').stdout))
    assert int(extra['order_qty']) > int(a['order_qty'])
    assert extra['order_by'] == a['order_by']
    for invalid in ['-1','1.5','366','3651','NaN']:
        assert run('--buffer-days',invalid).returncode == 2


def test_zero_observations_stays_distinct_from_missing_history():
    import json
    spec = importlib.util.spec_from_file_location('phase1_golden', ROOT/'scripts/golden_diff.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    inputs = json.loads((ROOT/'tests/golden/inputs.json').read_text())
    zero = next(c for c in inputs['cases'] if c['item']['sku']=='ZERO-HISTORY')
    inputs['cases'] = [{**zero,'item':{**zero['item'],'monthly_sales':[]}}]
    row, = module.collect(inputs)
    assert row['js'] == row['python'] == row['cli'] == dict(order_qty=None,order_by=None,run_out=None,status='needs-data')


def test_plan_bounded_buffer_avoids_previous_calendar_underflow():
    raw = dict(sku='EDGE',name='Synthetic',unit='ea',on_hand=10,on_order=1,
               supplier_days=0,monthly_sales=[30,30,30],receipts={})
    row = engine.forecast(raw,['1000-01','1000-02','1000-03'],'1000-03-31',settings={'buffer_days':3650})
    assert row['held'] is False
    assert row['suggested_order'] is not None
    g = engine.order_guidance({**raw,**row,'as_of':'1000-03-31'},'1000-03-31',{'buffer_days':3650})
    assert g['status'] == 'order'
    assert g['order_by'] == '1000-04-11'


def test_buffer_is_bounded_by_one_year_and_selected_cover():
    assert engine.normalize_order_settings({'buffer_days':3650})['buffer_days'] == 365
    assert engine.normalize_order_settings({'buffer_days':366})['buffer_days'] == 365
    raw = dict(sku='BOUNDS',name='Synthetic',unit='ea',on_hand=990,
               supplier_days=14,monthly_sales=[30,30,30],receipts={})
    row = engine.forecast(raw,['2026-08','2026-09','2026-10'],'2026-10-31')
    item = {**raw,**row,'as_of':'2026-10-31'}
    for cover in [0,.125,2]:
        zero = engine.order_guidance(item,'2026-11-12',{'buffer_days':0,'months_of_cover':cover})
        big = engine.order_guidance(item,'2026-11-12',{'buffer_days':3650,'months_of_cover':cover})
        assert big['quantity'] >= zero['quantity']
        assert big['order_by'] == zero['order_by']
        if cover == 0:
            assert big['quantity'] == zero['quantity'] == 0
        else:
            assert big['quantity'] > zero['quantity']
        assert big['runout_date'] == zero['runout_date']
        assert big['order_by'] != 'now'
        if big['quantity'] == 0:
            assert big['order_by'] is None
        else:
            assert big['order_by'] == zero['order_by']
        assert engine.order_bucket(item,'2026-11-12',{'buffer_days':3650,'months_of_cover':cover}) == ('healthy' if big['quantity'] > 0 else 'overstocked')


def test_zero_purchase_has_no_order_now_deadline():
    raw = dict(sku='ZERO',name='Synthetic',unit='ea',on_hand=30,
               supplier_days=0,monthly_sales=[30,30,30],receipts={})
    row = engine.forecast(raw,['2026-08','2026-09','2026-10'],'2026-10-31')
    item = {**raw,**row,'as_of':'2026-10-31'}
    g = engine.order_guidance(item,'2026-11-12',{'buffer_days':365,'months_of_cover':0})
    assert g['quantity'] == 0
    assert g['order_by'] is None
    assert engine.order_bucket(item,'2026-11-12',{'buffer_days':365,'months_of_cover':0}) != 'order'


def test_displayed_reorder_point_excludes_additive_end_window_buffer():
    raw = dict(sku='POINT',name='Synthetic',unit='ea',on_hand=300,
               supplier_days=14,monthly_sales=[30,30,30],receipts={})
    assert engine.inventory_planning(raw,'2026-10',{'buffer_days':0})['reorder_point'] == 14
    assert engine.inventory_planning(raw,'2026-10',{'buffer_days':7})['reorder_point'] == 14
    assert engine.inventory_planning(raw,'2026-10',{'buffer_days':3650,'months_of_cover':0})['reorder_point'] == 14
    # Buffer changes purchase quantity only; ROP remains lead demand plus SS.
    assert engine.inventory_planning(raw,'2026-10',{'buffer_days':3650})['reorder_point'] == 14


def test_cli_day_flags_use_ascii_digits_like_slash(tmp_path):
    import subprocess, types, sys, importlib
    source = tmp_path/'digits.csv'
    source.write_text('sku,name,unit,on_hand,2026-08,2026-09,2026-10\nA,Synthetic,ea,10,30,30,30\n')
    pkg = types.ModuleType('phase1_digits'); pkg.__path__ = [str(ROOT)]; sys.modules[pkg.__name__] = pkg
    commands = importlib.import_module(pkg.__name__ + '.commands')
    for token in ['٧','1_0','+7','7.0','NaN']:
        assert 'error' in commands.build_args('--buffer-days '+token)
        for flag in ['--buffer-days','--delivery-days']:
            process = subprocess.run(['python3',str(ROOT/'stock_runway.py'),str(source),flag,token],text=True,capture_output=True)
            assert process.returncode == 2, (flag,token,process.stdout,process.stderr)
    assert 'error' in commands.build_args('--buffer-days 366')
    assert commands.build_args('--buffer-days 365')['settings']['buffer_days'] == 365


def test_a3_and_tool_buffer_bounds_match_engine_cap():
    import json, re, types, sys, importlib
    pkg = types.ModuleType('phase1_buffer_schema'); pkg.__path__ = [str(ROOT)]; sys.modules[pkg.__name__] = pkg
    tools = importlib.import_module(pkg.__name__ + '.tools')
    schema = tools.TOOL_SCHEMA['parameters']['properties']['settings']['properties']['buffer_days']
    assert (schema['minimum'], schema['maximum']) == (0, 365)
    design = ROOT / 'standalone/design'
    html = (design / 'controls-a3.html').read_text()
    assert 'id="buffer-days" type="number" min="0" max="365"' in html
    assert "['buffer-days', 'buffer_days', 0, 365, true]" in (design / 'app-a3.js').read_text()
    text = (design / 'strings-a3.js').read_text().split('const STRINGS = ', 1)[1].split('\nconst S =', 1)[0]
    assert json.loads(text)['buffer_days_help'] == 'Extra demand days · max 365 · default 0'
