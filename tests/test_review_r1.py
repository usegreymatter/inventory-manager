"""Review-round-1 CLI guards; synthetic only."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def test_cli_future_and_mismatched_units_always_reviewed(tmp_path):
    for header, row in [
        ('sku,name,unit,on_hand,2027-07,2027-08,2027-09', 'A,Alpha,kg,10,100,100,100'),
        ('sku,name,unit,on_hand,Sales unit,2026-07,2026-08,2026-09', 'A,Alpha,kg,10,boxes,100,100,100'),
    ]:
        path = tmp_path / 'synthetic.csv'
        path.write_text(header+'\n'+row+'\n')
        cmd = ['/usr/bin/python3', 'stock_runway.py', str(path), '--all', '--json', '--today', '2026-11-19']
        blocked = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        assert blocked.returncode == 2, blocked.stdout
        assert '--show-orders-anyway' in blocked.stderr
        accepted = subprocess.run(cmd+['--show-orders-anyway'], cwd=ROOT, capture_output=True, text=True)
        assert accepted.returncode == 0, accepted.stderr
        assert json.loads(accepted.stdout)[0]['input_warnings']


def test_cli_oversold_and_blank_reserved_rows_stay_in_plan(tmp_path):
    path = tmp_path / 'synthetic.csv'
    path.write_text('sku,name,unit,on_hand,reserved,2026-07,2026-08,2026-09\nA,Alpha,kg,10,20,100,100,100\nB,Beta,kg,10,,100,100,100\n')
    cmd = ['/usr/bin/python3', 'stock_runway.py', str(path), '--stock-includes-reserved', '--show-orders-anyway', '--all', '--json', '--today', '2026-11-19']
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    rows = json.loads(result.stdout)
    assert {r['sku'] for r in rows} == {'A','B'}
    assert all(r['order_qty'] > 0 for r in rows)
