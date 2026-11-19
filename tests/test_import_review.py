"""Review regressions exercise Python and JS with exact report parity."""
import csv
import io
import pytest
from test_import_edges import parity


def csv_text(rows, delimiter=',', extra=()):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream, delimiter=delimiter)
    writer.writerow(['SKU', 'Name', 'On Hand', 'Jan 2026', 'Feb 2026', 'Mar 2026', *extra])
    writer.writerows(rows)
    return stream.getvalue()


@pytest.mark.parametrize('currency', ['$1,200', '1,200 €', '£1,200.50', '(¥1,200)'])
def test_boundary_currency_symbols(tmp_path, currency):
    # Parenthesized stock remains a negative-stock rejection, not a format error.
    rows = [['A', 'Good', '10', '1', '2', '3'], ['B', 'Currency', currency, '1', '2', '3']]
    data = parity(tmp_path, csv_text(rows))
    if currency.startswith('('):
        assert data['import_report']['rows_set_aside'][0]['reason'] == 'negative stock in ERP — fix count'
    else:
        assert data['items'][1]['on_hand'] == (1200.5 if '.50' in currency else 1200)


@pytest.mark.parametrize('currency', ['1$20', '1€200', '1£200.50', '1₹2'])
def test_embedded_currency_is_not_a_number(tmp_path, currency):
    data = parity(tmp_path, csv_text([['A', 'Good', '10', '1', '2', '3'], ['B', 'Bad', currency, '1', '2', '3']]))
    assert [i['sku'] for i in data['items']] == ['A']
    assert data['import_report']['rows_set_aside'][0]['reason'] == 'Row 3: on_hand must be a number.'


def test_semicolon_uses_one_decimal_comma_style(tmp_path):
    data = parity(tmp_path, csv_text([
        ['A', 'Thousands', '1.200', '2,5', '2', '3'],
        ['B', 'Grouped decimal', '1.200,50', '1', '2', '3'],
        ['C', 'Ambiguous currency', '$1,200', '1', '2', '3'],
    ], ';'))
    assert [i['on_hand'] for i in data['items']] == [1200, 1200.5]
    assert [r['reason'] for r in data['import_report']['rows_set_aside']] == ['ambiguous number format']
    assert 'Number format: decimal-comma (comma decimal; dot thousands)' in data['import_report']['warnings']


def test_semicolon_without_comma_evidence_does_not_guess_dotted_thousands(tmp_path):
    data = parity(tmp_path, csv_text([
        ['A', 'Good', '10', '1', '2', '3'],
        ['B', 'Ambiguous', '1.200', '1', '2', '3'],
        ['C', 'Currency ambiguous', '$1,200', '1', '2', '3'],
    ], ';'))
    # Currency comma alone selects comma style, but is still ambiguous itself;
    # the dotted amount follows that file-wide convention rather than becoming 1.2.
    assert [i['on_hand'] for i in data['items']] == [10, 1200]
    assert data['import_report']['rows_set_aside'][0]['reason'] == 'ambiguous number format'
    data = parity(tmp_path, csv_text([['A', 'Good', '10', '1', '2', '3'], ['B', 'Ambiguous', '1.200', '1', '2', '3']], ';'))
    assert len(data['items']) == 1
    assert data['import_report']['rows_set_aside'][0]['reason'] == 'ambiguous number format'
    assert 'Number format: decimal-dot (dot decimal; comma thousands)' in data['import_report']['warnings']


@pytest.mark.parametrize('delimiter', [',', '\t'])
def test_comma_and_tab_keep_decimal_dot_and_reject_mixed_style(tmp_path, delimiter):
    data = parity(tmp_path, csv_text([
        ['A', 'Decimal', '1.200', '1', '2', '3'],
        ['B', 'Currency', '$1,200', '1', '2', '3'],
        ['C', 'Mixed', '1.200,50', '1', '2', '3'],
        ['D', 'Comma decimal', '2,5', '1', '2', '3'],
    ], delimiter))
    assert [i['on_hand'] for i in data['items']] == [1.2, 1200]
    assert [r['reason'] for r in data['import_report']['rows_set_aside']] == ['ambiguous number format'] * 2
    assert 'Number format: decimal-dot (dot decimal; comma thousands)' in data['import_report']['warnings']


def test_decimal_style_scan_includes_sales_but_not_ignored_columns(tmp_path):
    data = parity(tmp_path, csv_text([
        ['A', 'Good', '1.200', '1', '2', '3', '9,5'],
        ['B', 'Good', '10', '1', '2', '3', 'not numeric'],
    ], ';', ['Unused']))
    assert len(data['items']) == 1
    assert data['import_report']['rows_set_aside'][0]['reason'] == 'ambiguous number format'


@pytest.mark.parametrize('first,repeat', [('Main Warehouse', ' main WAREHOUSE '), ('Straße', ' STRASSE '), ('ΟΣ', 'ος')])
def test_warehouse_casefold_and_combined_labels(tmp_path, first, repeat):
    data = parity(tmp_path, csv_text([
        ['A', 'Good', '10', '1', '2', '3', first],
        ['A', 'Duplicate', '20', '4', '5', '6', repeat],
        ['A', 'Other', '30', '7', '8', '9', 'Branch 2'],
    ], extra=['Warehouse']))
    assert data['items'][0]['on_hand'] == 40
    assert data['import_report']['rows_set_aside'][0]['reason'] == 'duplicate sku at same warehouse/location — first row kept'
    assert f'A: combined 2 warehouse rows ({first}, Branch 2); stock, on order, sales and receipts summed; first-row metadata kept' in data['import_report']['warnings']


@pytest.mark.parametrize('value', ['', 'pending', '2026-12-01', '1$20'])
def test_dropped_aliased_on_order_is_disclosed(tmp_path, value):
    data = parity(tmp_path, csv_text([['A', 'Good', '10', '1', '2', '3', value]], extra=['Incoming']))
    report = data['import_report']
    assert 'Incoming' in report['ignored']
    assert 'on_order' not in data['items'][0]
    assert 'Incoming ignored: no numeric on_order values parsed; no incoming stock counted' in report['warnings']


@pytest.mark.parametrize('space', [' ', '\t', '\u00a0', '\u2007', '\u202f', '\ufeff', '\u0085', '\u001f'])
def test_explicit_whitespace_currency_and_lead_parity(tmp_path, space):
    data = parity(tmp_path, csv_text([
        ['A', 'Good', f'${space}1,200', '1', '2', '3', f'2{space}weeks'],
    ], extra=['Lead Time']))
    assert data['items'][0]['on_hand'] == 1200
    assert data['items'][0]['supplier_days'] == 14


@pytest.mark.parametrize('space', [' ', '\t', '\u00a0', '\u2007', '\u202f', '\ufeff'])
def test_explicit_grouping_whitespace_parity(tmp_path, space):
    data = parity(tmp_path, csv_text([['A', 'Good', f'1{space}200.50', '1', '2', '3']]))
    assert data['items'][0]['on_hand'] == 1200.5


@pytest.mark.parametrize('delimiter,bad,evidence', [(';', '0.500', '0,25'), (',', '0,500', '1'), ('\t', '0,500', '1')])
def test_leading_zero_is_not_a_thousands_group(tmp_path, delimiter, bad, evidence):
    data = parity(tmp_path, csv_text([['A', 'Good', '10', evidence, '2', '3'], ['B', 'Bad', bad, '1', '2', '3']], delimiter))
    assert len(data['items']) == 1
    assert data['import_report']['rows_set_aside'][0]['reason'] == 'ambiguous number format'


def test_mixed_file_does_not_reinterpret_comma_thousands_as_decimal(tmp_path):
    data = parity(tmp_path, csv_text([
        ['A', 'Good', '10', '1', '2', '3'],
        ['B', 'Ambiguous', '1,500', '1', '2', '3'],
        ['C', 'Dot convention', '1,200.50', '1', '2', '3'],
    ], ';'))
    assert len(data['items']) == 1
    assert [r['reason'] for r in data['import_report']['rows_set_aside']] == ['ambiguous number format'] * 2


def test_lead_units_follow_file_number_convention(tmp_path):
    data = parity(tmp_path, csv_text([
        ['A', 'Good', '10', '0,25', '2', '3', '1,5 weeks'],
        ['B', 'Grouped days', '10', '1', '2', '3', '1.500 days'],
    ], ';', ['Lead Time']))
    assert [i['supplier_days'] for i in data['items']] == [10.5, 1500]
