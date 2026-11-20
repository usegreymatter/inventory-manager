"""Round-two reviewer repros through the actual CLI (synthetic only)."""
import csv
import io
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HEADER = 'sku,name,unit,on_hand,supplier_days,2026-07,2026-08,2026-09,reserved,on_order,Sales unit,Warehouse\n'


def run(path, *flags, today='2026-11-19'):
    result = subprocess.run(['/usr/bin/python3', 'stock_runway.py', str(path), '--all', '--today', today, *flags], cwd=ROOT, capture_output=True, text=True)
    meaning = next((json.loads(line[len('Input meaning: '):]) for line in result.stderr.splitlines() if line.startswith('Input meaning: ')), None)
    assert meaning is not None, result.stderr
    return result, meaning


def test_astra_warehouse_reservations_cli(tmp_path):
    path = tmp_path / 'warehouse.csv'
    path.write_text(HEADER + 'A,Alpha,pcs,10,14,10,10,10,100,0,pcs,East\nA,Alpha,pcs,100,14,10,10,10,0,0,pcs,West\n')
    result, meaning = run(path, '--stock-includes-reserved')
    assert result.returncode == 0, result.stderr
    assert list(csv.DictReader(io.StringIO(result.stdout)))[0]['on_hand'] == '10'
    assert any(w.startswith('Oversold:') for w in meaning['warnings'])


def test_astra_partial_incoming_cli(tmp_path):
    path = tmp_path / 'warehouse.csv'
    path.write_text(HEADER + 'A,Alpha,pcs,10,14,3,3,3,0,100,pcs,East\nA,Alpha,pcs,100,14,3,3,3,0,,pcs,West\n')
    result, meaning = run(path)
    assert result.returncode == 0, result.stderr
    assert list(csv.DictReader(io.StringIO(result.stdout)))[0]['on_order'] == '100'
    assert meaning['incoming_unknown'] == ['A']
    assert any(w.startswith('Incoming partly unknown') for w in meaning['warnings'])


def test_astra_all_units_cli_order_independent(tmp_path):
    path = tmp_path / 'warehouse.csv'
    rows = ['A,Alpha,pcs,10,14,3,3,3,0,0,boxes,East\n', 'A,Alpha,pcs,100,14,3,3,3,0,0,pcs,West\n']
    for ordered in [rows, rows[::-1]]:
        path.write_text(HEADER + ''.join(ordered))
        result, meaning = run(path)
        assert result.returncode == 2
        assert not result.stdout
        assert meaning['requires_ack'] is True
        assert any(w.startswith('Sales and stock units') for w in meaning['warnings'])


def test_astra_decimal_comma_cli(tmp_path):
    path = tmp_path / 'decimal.csv'
    path.write_text(HEADER.replace(',', ';') + 'A;Alpha;pcs;10,5;14;1.000;1.000;1.000;0,5;0;pcs;East\n')
    result, meaning = run(path, '--stock-includes-reserved')
    assert result.returncode == 0, result.stderr
    assert list(csv.DictReader(io.StringIO(result.stdout)))[0]['on_hand'] == '10'
    assert 'ambiguous number format' not in result.stderr
    assert meaning['missing_rows'] == 0


def test_opus_f1_original_internal_blank_still_requires_ack():
    result, meaning = run(ROOT / 'tests/fixtures/import-probes/blank_sales_cell.csv')
    assert result.returncode == 2, result.stderr
    assert meaning['requires_ack'] is True
    assert meaning['missing_rows'] == 1
    assert meaning['not_yet_launched_cells'] == 0


def test_opus_f1_leading_prelaunch_blank_cli(tmp_path):
    path = tmp_path / 'launch.csv'
    path.write_text(HEADER + 'A,Alpha,pcs,10,14,,3,3,0,0,pcs,East\n')
    result, meaning = run(path)
    assert result.returncode == 0, result.stderr
    assert meaning['requires_ack'] is False
    assert meaning['missing_rows'] == 0
    assert meaning['not_yet_launched_cells'] == 1


def test_opus_f3_current_month_cli_json_and_override(tmp_path):
    path = tmp_path / 'partial.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,2026-09,2026-10,2026-11\nA,Alpha,pcs,10,14,3,3,1\n')
    result, meaning = run(path)
    warning = 'Latest month (2026-11) is still in progress — partial sales may lower the forecast. Remove it or wait for month end.'
    assert result.returncode == 2
    assert result.stdout == ''
    assert meaning['requires_ack'] is True
    assert warning in meaning['warnings'] and warning in meaning['reasons']
    accepted, _ = run(path, '--show-orders-anyway')
    assert accepted.returncode == 0, accepted.stderr
    assert len(list(csv.DictReader(io.StringIO(accepted.stdout)))) == 1


def test_csv_contributing_rows_match_importer(tmp_path):
    path = tmp_path / 'locations.csv'
    for locations in [('', 'West'), ('East', '')]:
        path.write_text(HEADER + f'A,Alpha,pcs,10,14,3,3,3,100,0,pcs,{locations[0]}\nA,Alpha,pcs,100,14,3,3,3,0,0,pcs,{locations[1]}\n')
        result, _ = run(path, '--stock-includes-reserved')
        assert result.returncode == 0, result.stderr
        assert list(csv.DictReader(io.StringIO(result.stdout)))[0]['on_hand'] == '10'
    for invalid in ['A,Alpha,pcs,-1,14,3,3,3,0,7,pcs,East\n', 'A,Alpha,pcs,50,14,3,3,3,0,7,pcs,East,extra\n']:
        path.write_text(HEADER + invalid + 'A,Alpha,pcs,100,14,3,3,3,0,,pcs,East\nA,Alpha,pcs,10,14,3,3,3,100,5,pcs,West\n')
        result, meaning = run(path, '--stock-includes-reserved', '--show-orders-anyway')
        assert result.returncode == 0, result.stderr
        assert list(csv.DictReader(io.StringIO(result.stdout)))[0]['on_hand'] == '10'
        assert meaning['incoming_unknown'] == ['A']
    path.write_text(HEADER + 'A,Alpha,pcs,10,14,3,3,3,0,100,pcs,\nA,Alpha,pcs,100,14,3,3,3,0,,pcs,West\n')
    result, meaning = run(path)
    assert result.returncode == 0, result.stderr
    assert meaning['incoming_unknown'] == ['A']
    assert any(w.startswith('Incoming partly unknown') for w in meaning['warnings'])


def test_reserved_blank_stock_set_aside_reason(tmp_path):
    path = tmp_path / 'blank.csv'
    path.write_text(HEADER + 'A,Alpha,pcs,,14,3,3,3,4,0,pcs,East\nB,Beta,pcs,10,14,3,3,3,0,0,pcs,East\n')
    result, _ = run(path, '--stock-includes-reserved', '--show-orders-anyway')
    assert result.returncode == 0, result.stderr
    report = next(json.loads(line[len('Import check: '):]) for line in result.stderr.splitlines() if line.startswith('Import check: '))
    assert any('Stock is blank but reserved is filled' in r['reason'] for r in report['rows_set_aside'])
