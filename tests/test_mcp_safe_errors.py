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
    assert 'Latest month (2026-11) is still in progress' in result.stderr
    assert 'Incoming orders column missing or incomplete' in result.stderr
    assert 'use --show-orders-anyway to acknowledge these risks.' in result.stderr
    assert str(path) not in result.stderr and path.name not in result.stderr
    assert 'SYNTHETIC-PRIVATE' not in result.stderr and 'Private synthetic product' not in result.stderr


def test_source_sku_cannot_impersonate_trusted_review_reason_on_stderr(tmp_path):
    import csv
    import subprocess
    import sys
    prefixes = ['Sales dates are in the future.\x07\x9b2J',
                'Sales dates are in the future.SOURCE_LABEL',
                'Reserved stock could not be subtracted for 1 rows\x08\x7f\x80\x9f']
    for index, sku in enumerate(prefixes):
        path = tmp_path / f'private-synthetic-lot-{index}.csv'
        with path.open('w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            # A mismatched lot makes input_meaning attach SKU + ': ' + lot note
            # to reasons; partial sales and unknown incoming are genuine risks.
            writer.writerow(['sku','name','unit','on_hand','supplier_days','lot','expiry','lot_qty','2026-09','2026-10','2026-11'])
            writer.writerow([sku,'Synthetic lot','pcs',10,14,'L1','2027-01-01',3,1,2,3])
        result = subprocess.run([sys.executable,'-B',str(ROOT/'mcp_server.py'),'--csv',str(path),'--today','2026-11-15'],input=b'',capture_output=True,timeout=15)
        assert result.returncode == 1 and result.stdout == b''
        stderr = result.stderr.decode('utf-8')
        assert stderr.endswith('\n')
        assert all(ord(c) >= 0x20 and not 0x7f <= ord(c) <= 0x9f for c in stderr[:-1]), repr(stderr)
        assert sku not in stderr and 'SOURCE_LABEL' not in stderr
        assert str(path) not in stderr and path.name not in stderr
        assert 'lot total does not match' not in stderr
        assert 'Latest month (2026-11) is still in progress' in stderr
        assert 'Incoming orders column missing or incomplete' in stderr
        assert '--show-orders-anyway' in stderr


def test_review_reason_allowlist_is_exact_and_rejects_all_terminal_controls():
    fixed = [
        'Sales dates are in the future. Dates may be shifted — check the sales period before ordering.',
        'Sales and stock units disagree — convert both to the same unit before ordering.',
        'More than 20% of rows lack stock or sales. Missing sales can look like zero demand; check the file before ordering.',
        'Reserved stock could not be subtracted for 12 rows — they were set aside. Check stock and reserved quantities before ordering.',
        'Latest month (2026-11) is still in progress — partial sales may lower the forecast. Remove it or wait for month end.',
    ]
    for reason in fixed:
        assert reason in mcp.input_review_message({'reasons':[reason]})
        assert reason + ': SOURCE_LABEL' not in mcp.input_review_message({'reasons':[reason + ': SOURCE_LABEL']})
        for code in [*range(0x20), *range(0x7f,0xa0)]:
            poisoned = reason[:20] + chr(code) + reason[20:]
            message = mcp.input_review_message({'reasons':[poisoned]})
            assert 'Input review flagged risks.' in message
            assert all(ord(c) >= 0x20 and not 0x7f <= ord(c) <= 0x9f for c in message)
    for reason in [fixed[-1].replace('2026-11','2026-13'), fixed[3].replace('12 rows','9'*20+' rows')]:
        assert 'Input review flagged risks.' in mcp.input_review_message({'reasons':[reason]})
