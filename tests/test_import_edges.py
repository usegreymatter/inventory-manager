"""Regression coverage for Unicode ERP cells and duplicate warehouse rows."""
import json
import subprocess
import pytest
from test_import_preflight import ROOT, load_csv
from stock_runway.tools import make_handler


def parity(tmp_path, text):
    path = tmp_path / 'edges.csv'
    path.write_text(text, encoding='utf-8')
    data = load_csv(str(path))
    js = json.loads(subprocess.run(['node', 'tests/import-parity.cjs', str(path)], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    assert js[str(path)] == {'data': data}
    return data


@pytest.mark.parametrize('space', ['\u00a0', '\u2007', '\u202f'])
def test_unicode_whitespace_and_header_bom(tmp_path, space):
    data = parity(tmp_path, f'\ufeffSKU,\ufeffName,On{space}Hand,Jan{space}2026,Feb 2026,Mar 2026\n{space}A{space},{space}Widget{space},{space}1{space}200.50{space},1,2,3\n')
    assert data['items'][0]['sku'] == 'A'
    assert data['items'][0]['name'] == 'Widget'
    assert data['items'][0]['on_hand'] == 1200.5


@pytest.mark.parametrize('space', ['\u0085', '\u001f', '\ufeff'])
def test_unicode_identity_trimming_parity(tmp_path, space):
    data = parity(tmp_path, f'SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\n{space}A{space},{space}Widget{space},{space}10{space},1,2,3\nA,Widget,20,4,5,6\n')
    assert [item['sku'] for item in data['items']] == ['A']
    assert data['items'][0]['on_hand'] == 10
    assert len(data['import_report']['rows_set_aside']) == 1


@pytest.mark.parametrize('location', ['W1', '', ' W1 '])
def test_repeat_location_is_set_aside_without_double_count(tmp_path, location):
    first = 'W1' if location.strip() else ''
    data = parity(tmp_path, f'SKU,Name,Warehouse,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,Widget,{first},10,1,2,3\nA,Widget,{location},20,4,5,6\nA,Widget,W2,30,7,8,9\n')
    assert data['items'][0]['on_hand'] == 40
    assert data['items'][0]['monthly_sales'] == [8, 10, 12]
    report = data['import_report']
    assert report['rows_imported'] == 2
    assert report['rows_set_aside'][0]['row'] == 3
    assert report['rows_set_aside'][0]['reason'] == 'duplicate sku at same warehouse/location — first row kept'
    assert 'A: some warehouse rows set aside; totals include usable rows only' in report['warnings']


def test_tool_exposes_set_aside_rows_and_warnings(tmp_path):
    path = tmp_path / 'tool.csv'
    path.write_text('SKU,Name,Warehouse,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,Widget,W1,10,1,2,3\nA,Widget,W2,-1,1,2,3\n')
    result = json.loads(make_handler()({'source': 'csv', 'csv_path': str(path)}))
    assert result['import_report']['rows_set_aside'][0]['reason'] == 'negative stock in ERP — fix count'
    assert result['import_report']['products_ready'] == 1
    assert 'A: some warehouse rows set aside; totals include usable rows only' in result['import_report']['warnings']
    assert '1 rows set aside' in result['disclosure']


def test_invalid_location_row_does_not_reserve_the_location(tmp_path):
    data = parity(tmp_path, 'SKU,Name,Warehouse,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,Widget,W1,-1,1,2,3\nA,Widget,W1,10,1,2,3\nA,Widget,W2,20,4,5,6\n')
    assert data['items'][0]['on_hand'] == 30
    assert data['import_report']['rows_imported'] == 2
