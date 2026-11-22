import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inventory_mcp_server_for_errors', ROOT / 'mcp_server.py')
mcp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp)


def test_mcp_load_reasons_are_curated_and_actionable():
    assert mcp.safe_source_reason(ValueError('CSV must be a local file no larger than 2 MiB.')) == 'CSV must be a local file no larger than 2 MiB.'
    assert mcp.safe_source_reason(ValueError('CSV contains more than 10000 rows.')) == 'CSV contains more than 10000 rows.'
    missing = 'CSV is missing required product code, stock on hand columns. Required columns are product code, product name and stock on hand; unit and supplier lead time are optional. Common ERP names also work, e.g. Item Code, Item Name, UoM, Qty On Hand, Lead Time.'
    assert mcp.safe_source_reason(ValueError(missing)) == missing
    months = 'Add at least three YYYY-MM monthly sales columns after supplier_days.'
    assert mcp.safe_source_reason(ValueError(months)) == months
    fallback = mcp.safe_source_reason(ValueError('private/path: customer row contents'))
    assert fallback == 'Check the local CSV or bundle path, required columns (product code, product name, stock on hand, three or more monthly sales columns) and whether flagged risks need --show-orders-anyway.'


def test_mcp_main_reports_real_oversize_file_without_leaking_path(tmp_path):
    import subprocess
    import sys
    path = tmp_path / 'synthetic-private-name.csv'
    path.write_bytes(b'x' * (2 * 1024 * 1024 + 1))
    result = subprocess.run([sys.executable, '-B', str(ROOT / 'mcp_server.py'), '--csv', str(path)], capture_output=True, text=True)
    assert result.returncode == 1
    assert not result.stdout
    assert 'CSV must be a local file no larger than 2 MiB.' in result.stderr
    assert str(path) not in result.stderr and path.name not in result.stderr
    assert 'Traceback' not in result.stderr


def test_mcp_main_reports_acknowledgement_required_without_leaking_input(tmp_path):
    import subprocess
    import sys
    path = tmp_path / 'synthetic-private-risk.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,2026-09,2026-10,2026-11\nSYNTHETIC-PRIVATE,Private synthetic product,pcs,50,14,10,12,3\n', encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', str(ROOT / 'mcp_server.py'), '--csv', str(path), '--today', '2026-11-10'], capture_output=True, text=True, timeout=15)
    assert result.returncode == 1
    assert not result.stdout
    assert result.stderr == 'Inventory source could not be loaded: Input review flagged risks. Check the file, then add --show-orders-anyway to acknowledge them.\n'
    assert str(path) not in result.stderr and path.name not in result.stderr
    assert 'SYNTHETIC-PRIVATE' not in result.stderr and 'Private synthetic product' not in result.stderr
