"""Synthetic CLI interpretation flags; default quantities stay unchanged."""
import csv
import importlib
import io
import json
from pathlib import Path
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('meaning_test_pkg')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('meaning_test_pkg', package)
meaning = importlib.import_module('meaning_test_pkg.input_meaning')


def test_cli_flags_subtract_reserved_and_emit_json_warnings(tmp_path):
    path = tmp_path / 'synthetic.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,reserved,on_order,2026-07,2026-08,2026-09\nA,Alpha,pcs,10,14,4,50,3,3,3\n')
    def run(*flags):
        result = subprocess.run(['/usr/bin/python3', 'stock_runway.py', str(path), '--all', '--today', '2026-11-19', *flags], cwd=ROOT, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return list(csv.DictReader(io.StringIO(result.stdout)))[0], result.stderr
    default, stderr = run()
    assert default['on_hand'] == '10'
    assert default['on_order'] == '50'
    row, stderr = run('--stock-includes-reserved', '--incoming-not-in-file')
    assert row['on_hand'] == '6'
    assert row['on_order'] == ''
    report = json.loads(next(line.removeprefix('Input meaning: ') for line in stderr.splitlines() if line.startswith('Input meaning: ')))
    assert meaning.INCOMING_UNKNOWN in report['warnings']
    assert report['affected'][0]['sku'] == 'A'
    assert report['choices']['stock_includes_reserved'] is True


def test_cli_reserved_absence_warns_without_inventing_allocations(tmp_path):
    path = tmp_path / 'synthetic.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,2026-07,2026-08,2026-09\nA,Alpha,pcs,10,14,3,3,3\n')
    result = subprocess.run(['/usr/bin/python3', 'stock_runway.py', str(path), '--all', '--stock-includes-reserved'], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    report = json.loads(next(line.removeprefix('Input meaning: ') for line in result.stderr.splitlines() if line.startswith('Input meaning: ')))
    assert any('no reserved column' in warning for warning in report['warnings'])
    assert list(csv.DictReader(io.StringIO(result.stdout)))[0]['on_hand'] == '10'


def test_cli_input_risk_requires_acknowledgement_only_when_meaning_is_opted_in(tmp_path):
    path = tmp_path / 'synthetic.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,2026-07,2026-08,2026-09\nA,Alpha,pcs,10,14,3,,3\nB,Beta,pcs,20,14,3,3,3\n')
    command = ['/usr/bin/python3', 'stock_runway.py', str(path), '--all', '--today', '2026-11-19', '--incoming-not-in-file']
    blocked = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    assert blocked.returncode == 2
    assert blocked.stdout == ''
    assert '--show-orders-anyway' in blocked.stderr
    accepted = subprocess.run([*command, '--show-orders-anyway'], cwd=ROOT, capture_output=True, text=True)
    assert accepted.returncode == 0, accepted.stderr
    assert len(list(csv.DictReader(io.StringIO(accepted.stdout)))) == 2
