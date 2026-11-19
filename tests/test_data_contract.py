"""Offline contract tests; synthetic temporary exports only."""
import csv
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'data_contract' / 'validate.py'


def validator():
    assert MODULE.exists(), 'versioned CSV validator is missing'
    spec = importlib.util.spec_from_file_location('contract_validator', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def put(root, filename, headers, rows):
    with (root / filename).open('w', encoding='utf-8', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def base(root):
    put(root, 'stock.csv', ['sku', 'name', 'unit', 'on_hand', 'supplier_days',
                           '2026-08', '2026-09', '2026-10'],
        [['A', 'Synthetic tile', 'box', '12', '', '2', '3', '4']])


def codes(result, severity='errors'):
    return {entry['code'] for entry in result[severity]}


def test_legacy_minimum_remains_valid(tmp_path):
    base(tmp_path)
    result = validator().validate_bundle(tmp_path)
    assert result['valid']
    assert result['features']['baseline']['items']['A']['state'] == 'on'
    assert result['features']['transfers']['state'] == 'hidden'
    assert 'legacy_snapshot' in codes(result, 'warnings')


@pytest.mark.parametrize('value', ['NaN', 'Infinity', '-1', '1000000000001', '１２', ''])
def test_bad_quantity_is_structured(tmp_path, value):
    base(tmp_path)
    text = (tmp_path / 'stock.csv').read_text()
    (tmp_path / 'stock.csv').write_text(text.replace(',12,', ',' + value + ','))
    result = validator().validate_bundle(tmp_path)
    assert not result['valid']
    error = next(entry for entry in result['errors'] if entry['field'] == 'on_hand')
    assert error['file'] == 'stock.csv' and error['row'] == 2 and error['sku'] == 'A'
    assert result['features']['baseline']['items']['A']['state'] == 'locked'


@pytest.mark.parametrize('headers,row,code', [
    (['sku','name','unit','on_hand','supplier_days','2026-08','2026-10','2026-11'], ['A','x','box',1,1,1,1,1], 'months'),
    (['sku','name','unit','on_hand','supplier_days','2026-08','2026-09','2026-09'], ['A','x','box',1,1,1,1,1], 'duplicate_header'),
    (['sku','name','unit','on_hand','supplier_days','2026-08','2026-09','2026-10'], ['A','x','box',1,1,1,1], 'row_width'),
])
def test_malformed_structure(tmp_path, headers, row, code):
    put(tmp_path,'stock.csv',headers,[row])
    result = validator().validate_bundle(tmp_path)
    assert not result['valid'] and code in codes(result)


def test_optional_errors_do_not_disable_baseline(tmp_path):
    base(tmp_path)
    put(tmp_path,'product_master.csv',['sku','unit_cost','critical'],[['A','NaN','maybe']])
    result = validator().validate_bundle(tmp_path)
    assert not result['valid']
    assert result['features']['baseline']['items']['A']['state'] == 'on'
    assert result['features']['classification']['items']['A']['state'] == 'locked'


def test_reference_and_duplicate_checks(tmp_path):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    put(tmp_path,'warehouse_stock.csv',['sku','warehouse','on_hand'],
        [['A','MAIN',12],['A','MAIN',12],['MISSING','NOPE',1]])
    result = validator().validate_bundle(tmp_path)
    assert {'duplicate_key','unknown_sku','unknown_warehouse'} <= codes(result)


def test_stock_states_are_disjoint_and_reconcile(tmp_path):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    put(tmp_path,'warehouse_stock.csv',['sku','warehouse','on_hand'],[['A','MAIN',12]])
    put(tmp_path,'stock_states.csv',['sku','warehouse','damaged','reserved','quarantine','returns'],[['A','MAIN',7,6,0,0]])
    result = validator().validate_bundle(tmp_path)
    assert 'stock_states_exceed' in codes(result)
    assert result['features']['usable_stock']['items']['A']['state'] == 'locked'
    put(tmp_path,'warehouse_stock.csv',['sku','warehouse','on_hand'],[['A','MAIN',11]])
    assert 'stock_reconciliation' in codes(validator().validate_bundle(tmp_path))


def test_relationship_cycles_and_reciprocal_units(tmp_path):
    base(tmp_path)
    with (tmp_path/'stock.csv').open('a') as handle:
        handle.write('B,Synthetic grout,bag,0,1,1,1,1\n')
    put(tmp_path,'relationships.csv',['source_sku','target_sku','kind','direction','ratio'],
        [['A','B','kit','forward',1],['B','A','complement','forward',1]])
    put(tmp_path,'unit_conversions.csv',['sku','from_unit','to_unit','factor'],
        [['A','box','m2',1.44],['A','m2','box',1]])
    result = validator().validate_bundle(tmp_path)
    assert {'relationship_cycle','conversion_conflict'} <= codes(result)


def test_complete_months_and_receipt_po_threshold(tmp_path):
    base(tmp_path)
    put(tmp_path,'receipts.csv', ['receipt_id','po_id','sku','warehouse','po_date','promised_date','received_date','quantity','supplier'],
        [[f'R{i}','SAME-PO','A','MAIN','2026-01-01','2026-02-01','2026-02-02',1,'S'] for i in range(5)])
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    result = validator().validate_bundle(tmp_path)
    assert result['features']['lead_spread']['items']['A']['state'] == 'locked'
    assert result['features']['seasonality']['items']['A']['state'] == 'locked'


def test_malformed_manifest_fails_closed(tmp_path):
    base(tmp_path)
    (tmp_path/'manifest.json').write_text('{')
    result = validator().validate_bundle(tmp_path)
    assert 'manifest' in codes(result) and not result['valid']
    assert result['features']['baseline']['state'] == 'locked'


@pytest.mark.parametrize('version', ['2.0','1.7','1.0.0'])
def test_unknown_contract_version_is_not_guessed(tmp_path, version):
    base(tmp_path)
    (tmp_path/'manifest.json').write_text(json.dumps({'contract_version':version,'snapshot_date':'2026-10-31','currency':'KWD'}))
    assert 'version' in codes(validator().validate_bundle(tmp_path))


def test_unknown_columns_warn_not_break(tmp_path):
    base(tmp_path)
    put(tmp_path,'product_master.csv',['sku','supplier','future_note'],[['A','S','ignored']])
    result = validator().validate_bundle(tmp_path)
    assert result['valid'] and 'unknown_column' in codes(result,'warnings')


def test_incoming_overlap_and_overdue_are_not_silent(tmp_path):
    base(tmp_path)
    text = (tmp_path/'stock.csv').read_text().replace('supplier_days,','supplier_days,on_order,').replace(',12,,',',12,,10,')
    (tmp_path/'stock.csv').write_text(text)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    put(tmp_path,'incoming_pos.csv',['po_line_id','sku','warehouse','supplier','remaining_qty','due_date','status'],
        [['PO1','A','MAIN','S',10,'2026-10-01','confirmed']])
    result = validator().validate_bundle(tmp_path)
    assert 'incoming_overlap' in codes(result)
    assert 'overdue_incoming' in codes(result,'warnings')


def test_sample_generation_is_deterministic_and_compatible(tmp_path):
    script = ROOT/'scripts'/'make_samples.py'
    assert script.exists(), 'deterministic sample generator is missing'
    for output in [tmp_path/'one',tmp_path/'two']:
        subprocess.run([sys.executable,str(script),'--output',str(output)],check=True,capture_output=True)
    one = {p.name:p.read_bytes() for p in (tmp_path/'one').iterdir()}
    two = {p.name:p.read_bytes() for p in (tmp_path/'two').iterdir()}
    assert one == two
    committed = {p.name:p.read_bytes() for p in (ROOT/'samples'/'synthetic').iterdir()}
    assert one == committed
    result = validator().validate_bundle(tmp_path/'one',today='2026-11-01')
    assert result['valid'], result['errors']
    assert result['counts']['stock.csv'] == 6
    assert result['counts']['warehouses.csv'] == 3
    assert result['features']['lead_spread']['items']['TILE-SAND']['state'] == 'on'
    assert result['features']['seasonality']['state'] == 'locked'
    # Exercise existing CLI loader, not a replacement/parser imitation.
    spec = importlib.util.spec_from_file_location('contract_cli',ROOT/'stock_runway.py')
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    _, sources = cli._load_modules()
    assert len(sources.load_csv(str(tmp_path/'one'/'stock.csv'))['items']) == 6
    run = subprocess.run([sys.executable,str(MODULE),str(tmp_path/'one'),'--today','2026-11-01'],capture_output=True,text=True)
    assert run.returncode == 0 and json.loads(run.stdout)['valid']


def test_missing_bundle_cli_exits_two(tmp_path):
    assert MODULE.exists()
    run = subprocess.run([sys.executable,str(MODULE),str(tmp_path/'missing')],capture_output=True,text=True)
    assert run.returncode == 2
    assert json.loads(run.stdout)['errors']


@pytest.mark.parametrize('filename,headers,row,code', [
    ('product_master.csv',['sku','moq','max_order_qty','pack_size'],['A',13,15,12],'order_conflict'),
    ('product_master.csv',['sku','unit'],['A','m2'],'unit_mismatch'),
    ('relationships.csv',['source_sku','target_sku','kind','direction','ratio'],['A','A','kit','both',1],'self_link'),
    ('unit_conversions.csv',['sku','from_unit','to_unit','factor'],['A','box','m2','1e-1000000'],'number'),
    ('incoming_pos.csv',['po_line_id','sku','warehouse','supplier','remaining_qty','due_date','status'],['P','A','MAIN','S',1,'2026-02-30','confirmed'],'date'),
    ('product_master.csv',['sku','critical'],['A','maybe'],'boolean'),
    ('product_master.csv',['sku','lifecycle'],['A','obsolete'],'enum'),
    ('reorder_rules.csv',['rule_id','sku','warehouse','min_qty','max_qty','multiple','route','trigger'],['R','A','MAIN',20,10,1,'buy','manual'],'rule_range'),
    ('receipts.csv',['receipt_id','po_id','sku','warehouse','po_date','received_date','quantity','supplier'],['R','P','A','MAIN','2026-10-02','2026-10-01',1,'S'],'receipt_chronology'),
])
def test_optional_contract_checks(tmp_path, filename, headers, row, code):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    put(tmp_path,filename,headers,[row])
    result=validator().validate_bundle(tmp_path)
    assert code in codes(result), result


def test_unknown_optional_column_really_is_ignored(tmp_path):
    base(tmp_path)
    put(tmp_path,'product_master.csv',['sku','quantity'],[['A','not a known master field']])
    result=validator().validate_bundle(tmp_path)
    assert result['valid'] and 'unknown_column' in codes(result,'warnings')


def test_legacy_receipt_month_total_is_bounded(tmp_path):
    base(tmp_path)
    put(tmp_path,'legacy_receipts.csv',['sku','month','quantity'],[['A','2026-11',10**12],['A','2026-11',1]])
    assert 'aggregate_quantity' in codes(validator().validate_bundle(tmp_path))


def test_missing_warehouse_zeros_is_not_complete(tmp_path):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main'],['EAST','East']])
    put(tmp_path,'warehouse_stock.csv',['sku','warehouse','on_hand'],[['A','MAIN',12]])
    assert 'warehouse_coverage' in codes(validator().validate_bundle(tmp_path))


def test_po_completeness_assertions_must_agree(tmp_path):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    put(tmp_path,'receipts.csv',['receipt_id','po_id','sku','warehouse','po_date','received_date','quantity','supplier','po_complete'],
        [['R1','P','A','MAIN','2026-01-01','2026-01-05',1,'S','true'],['R2','P','A','MAIN','2026-01-02','2026-01-10',1,'S','false']])
    assert 'po_observation_conflict' in codes(validator().validate_bundle(tmp_path))


def test_manifest_snapshot_must_match_engine_cutoff(tmp_path):
    base(tmp_path)
    (tmp_path/'manifest.json').write_text(json.dumps({'contract_version':'1.0','snapshot_date':'2026-10-30','currency':'KWD'}))
    assert 'snapshot' in codes(validator().validate_bundle(tmp_path))


@pytest.mark.parametrize('field',['pack_size','moq','max_order_qty'])
def test_extremely_small_order_increment_returns_error_not_overflow(tmp_path,field):
    base(tmp_path)
    put(tmp_path,'product_master.csv',['sku','moq','max_order_qty','pack_size'],
        [['A','1e-2000000' if field=='moq' else 24,'1e-2000000' if field=='max_order_qty' else 120,'1e-2000000' if field=='pack_size' else 12]])
    result=validator().validate_bundle(tmp_path)
    assert 'number' in codes(result)


@pytest.mark.parametrize('payload',[None,[], 'x',0,False])
def test_manifest_non_object_is_structured_and_cli_exits_two(tmp_path,payload):
    base(tmp_path)
    (tmp_path/'manifest.json').write_text(json.dumps(payload))
    result=validator().validate_bundle(tmp_path)
    assert 'manifest' in codes(result)
    assert result['features']['baseline']['state']=='locked'
    run=subprocess.run([sys.executable,str(MODULE),str(tmp_path)],text=True,capture_output=True)
    assert run.returncode==2 and json.loads(run.stdout)['valid'] is False
    assert not run.stderr


def test_deep_manifest_returns_structured_error(tmp_path):
    base(tmp_path)
    (tmp_path/'manifest.json').write_text('['*20000+']'*20000)
    assert 'manifest' in codes(validator().validate_bundle(tmp_path))


def test_allocation_requires_complete_state_matrix(tmp_path):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main'],['EAST','East']])
    put(tmp_path,'warehouse_stock.csv',['sku','warehouse','on_hand'],[['A','MAIN',6],['A','EAST',6]])
    put(tmp_path,'stock_states.csv',['sku','warehouse','damaged','reserved','quarantine','returns'],[['A','MAIN',0,0,0,0]])
    put(tmp_path,'customer_orders.csv',['order_line_id','sku','warehouse','quantity','delivery_date','status','forecast_included'],
        [['SO','A','EAST',1,'2026-11-10','confirmed','true']])
    assert validator().validate_bundle(tmp_path)['features']['allocation']['items']['A']['state']=='locked'


def test_supply_overlap_locks_dated_incoming_gate(tmp_path):
    base(tmp_path)
    put(tmp_path,'warehouses.csv',['warehouse','name'],[['MAIN','Main']])
    put(tmp_path,'incoming_pos.csv',['po_line_id','sku','warehouse','supplier','remaining_qty','due_date','status'],
        [['PO','A','MAIN','S',2,'2026-11-01','confirmed']])
    put(tmp_path,'legacy_receipts.csv',['sku','month','quantity'],[['A','2026-11',2]])
    result=validator().validate_bundle(tmp_path)
    assert not result['valid']
    assert result['features']['dated_incoming']['items']['A']['state']=='locked'


def test_classification_requires_complete_comparison_costs(tmp_path):
    base(tmp_path)
    cols=['sku','name','unit','on_hand','supplier_days']+[f'2025-{m:02d}' for m in range(1,13)]
    put(tmp_path,'stock.csv',cols,[['A','A','box',12,1]+[2]*12,['B','B','bag',12,1]+[3]*12])
    (tmp_path/'manifest.json').write_text(json.dumps({'contract_version':'1.0','snapshot_date':'2025-12-31','currency':'KWD'}))
    put(tmp_path,'product_master.csv',['sku','unit_cost','critical'],[['A',10,'false'],['B','','false']])
    result=validator().validate_bundle(tmp_path)
    assert result['features']['classification']['items']['A']['state']=='locked'


@pytest.mark.parametrize('extra',[['B','A','substitute','forward',2],['A','B','kit','forward',1]])
def test_parallel_relationships_cannot_conflict_or_double_attach(tmp_path,extra):
    base(tmp_path)
    with (tmp_path/'stock.csv').open('a') as handle:
        handle.write('B,Bag,bag,12,1,1,1,1\n')
    first=['A','B','substitute','both',1] if extra[2]=='substitute' else ['A','B','complement','forward',1]
    put(tmp_path,'relationships.csv',['source_sku','target_sku','kind','direction','ratio'],[first,extra])
    assert 'relationship_conflict' in codes(validator().validate_bundle(tmp_path))


def test_order_increment_precision_is_checked_without_decimal_rounding(tmp_path):
    base(tmp_path)
    put(tmp_path,'product_master.csv',['sku','pack_size'],[['A','1.000000000000000000000000000001']])
    assert 'number' in codes(validator().validate_bundle(tmp_path))
    put(tmp_path,'product_master.csv',['sku','pack_size'],[['A','1.000000000000000000000000000000']])
    assert validator().validate_bundle(tmp_path)['valid']


def test_malformed_optional_file_is_locked_not_hidden(tmp_path):
    base(tmp_path)
    put(tmp_path,'incoming_pos.csv',['sku','due_date'],[['A','2026-11-10']])
    result=validator().validate_bundle(tmp_path)
    assert result['features']['dated_incoming']['items']['A']['state']=='locked'


def test_csv_size_and_row_bounds(tmp_path):
    base(tmp_path)
    (tmp_path/'product_master.csv').write_text('x'*(2*1024*1024+1))
    module=validator()
    assert 'file_size' in codes(module.validate_bundle(tmp_path))
    put(tmp_path,'product_master.csv',['sku','supplier'],[['A','S'],['A','S'],['A','S']])
    module.MAX_ROWS=2
    assert 'row_limit' in codes(module.validate_bundle(tmp_path))


def test_input_symlinks_are_not_followed(tmp_path):
    base(tmp_path)
    (tmp_path/'outside.csv').write_text('sku,supplier\nA,S\n')
    (tmp_path/'product_master.csv').symlink_to(tmp_path/'outside.csv')
    assert 'file_size' in codes(validator().validate_bundle(tmp_path))
