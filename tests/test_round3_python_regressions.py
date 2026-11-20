"""Round-three Python-only synthetic import contracts (no live/network data)."""
import csv
import importlib
import io
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('round3_pkg')
pkg.__path__ = [str(ROOT)]
sys.modules.setdefault('round3_pkg', pkg)
smart = importlib.import_module('round3_pkg.smart_import')
meaning = importlib.import_module('round3_pkg.input_meaning')
csv_import = importlib.import_module('round3_pkg.csv_import')


def text(rows):
    output = io.StringIO()
    csv.writer(output, lineterminator='\n').writerows(rows)
    return output.getvalue()


def values(report):
    return dict(zip(report['canonical_rows'][0], report['canonical_rows'][1]))


class RoundThreePythonTests(unittest.TestCase):
    def test_blank_locations_all_aggregate_without_dropping_rows(self):
        rows = [['sku', 'name', 'unit', 'on_hand', 'supplier_days', 'Warehouse', '2026-07', '2026-08', '2026-09'],
                ['A', 'Alpha', 'pcs', '10', '14', '', '1', '1', '1'],
                ['A', 'Alpha', 'pcs', '20', '14', '', '1', '1', '1'],
                ['A', 'Alpha', 'pcs', '30', '14', 'West', '1', '1', '1']]
        workbook = smart.understand_workbook([dict(name='Stock', rows=rows)])
        self.assertEqual(values(workbook)['on_hand'], '60')
        self.assertIn('Unspecified', ' '.join(workbook['warnings']))
        parsed = csv_import.preflight_csv(text(rows))
        self.assertEqual(parsed['items'][0]['on_hand'], 60)
        self.assertEqual(parsed['import_report']['accepted_rows'], [1, 2, 3])
        self.assertIn('Unspecified', ' '.join(parsed['import_report']['warnings']))

    def test_joined_incoming_review_matches_joined_facts(self):
        sheets = [dict(name='Stock', rows=[['sku', 'name', 'on_hand', '2026-07', '2026-08', '2026-09'], ['A', 'Alpha', '100', '30', '30', '30']]),
                  dict(name='Incoming', rows=[['sku', 'on_order'], ['A', '50']])]
        report = smart.understand_workbook(sheets)
        review = meaning.review_input_meaning(sheets, report, {}, '2026-11-20')
        self.assertNotIn('A', review['incoming_unknown'])
        self.assertNotIn(meaning.INCOMING_UNKNOWN, review['warnings'])
        self.assertEqual(report['review_sheets'][0]['rows'], report['canonical_rows'])
        self.assertEqual(report['review_report']['sheets'][0]['accepted_rows'], [1])

    def test_joined_reserved_units_and_stock_use_one_canonical_review(self):
        sheets = [dict(name='Stock', rows=[['sku', 'name', 'on_hand', 'Stock unit', '2026-07', '2026-08', '2026-09'], ['A', 'Alpha', '100', 'pcs', '30', '30', '30']]),
                  dict(name='Allocations', rows=[['sku', 'reserved'], ['A', '60']]),
                  dict(name='Sales units', rows=[['sku', 'Sales unit'], ['A', 'boxes']])]
        report = smart.understand_workbook(sheets)
        self.assertEqual(values(report)['reserved'], '60')
        review = meaning.review_input_meaning(sheets, report, dict(stock_includes_reserved=True), '2026-11-20')
        adjusted = smart.understand_workbook(review['sheets'])
        self.assertEqual(values(adjusted)['on_hand'], '40')
        self.assertTrue(review['requires_ack'])
        self.assertIn('Sales and stock units disagree', ' '.join(review['warnings']))

    def test_warehouse_sheets_sum_stock_reserved_incoming_and_ack_metadata_conflict(self):
        header = ['sku', 'name', 'unit', 'on_hand', 'reserved', 'on_order', 'supplier_days', '2026-07', '2026-08', '2026-09']
        sheets = [dict(name='East', rows=[header, ['A', 'Alpha', 'pcs', '10', '100', '5', '14', '30', '30', '30']]),
                  dict(name='West', rows=[header, ['A', 'Alpha', 'pcs', '100', '0', '7', '21', '30', '30', '30']])]
        report = smart.understand_workbook(sheets)
        self.assertEqual(values(report)['on_hand'], '110')
        self.assertEqual(values(report)['reserved'], '100')
        self.assertEqual(values(report)['on_order'], '12')
        review = meaning.review_input_meaning(sheets, report, dict(stock_includes_reserved=True), '2026-11-20')
        self.assertEqual(values(smart.understand_workbook(review['sheets']))['on_hand'], '10')
        self.assertTrue(review['requires_ack'])
        self.assertIn('supplier_days', ' '.join(review['reasons']))

    def test_partial_joined_incoming_retains_known_and_uncertainty(self):
        header = ['sku', 'name', 'on_hand', '2026-07', '2026-08', '2026-09']
        sheets = [dict(name='East', rows=[header, ['A', 'Alpha', '10', '1', '1', '1']]),
                  dict(name='West', rows=[header + ['on_order'], ['A', 'Alpha', '20', '1', '1', '1', '50']])]
        report = smart.understand_workbook(sheets)
        review = meaning.review_input_meaning(sheets, report, {}, '2026-11-20')
        self.assertIn('A', review['incoming_unknown'])
        self.assertIn(meaning.INCOMING_PARTLY_UNKNOWN, review['warnings'])
        self.assertNotIn(meaning.INCOMING_UNKNOWN, review['warnings'])

    def test_csv_accepted_rows_identify_real_contributors_with_multiline_cells(self):
        rows = [['sku', 'name', 'unit', 'on_hand', 'supplier_days', 'Warehouse', 'on_order', '2026-07', '2026-08', '2026-09'],
                ['A', 'Alpha\nlabel', 'pcs', '10', '14', '', '50', '1', '1', '1'],
                ['A', 'Alpha', 'pcs', '100', '14', 'West', '', '1', '1', '1'],
                ['A', 'Alpha', 'pcs', '50', '14', 'Bad', '-1', '1', '1', '1']]
        parsed = csv_import.preflight_csv(text(rows))
        self.assertEqual(parsed['import_report']['accepted_rows'], [1, 2])
        self.assertEqual(parsed['import_report']['rows_imported'], 2)

    def test_csv_reservations_ignore_rejected_incoming_and_keep_unknown_supply(self):
        import tempfile
        rows = [['sku', 'name', 'unit', 'on_hand', 'supplier_days', 'Warehouse', 'reserved', 'on_order', '2026-07', '2026-08', '2026-09'],
                ['A', 'Alpha', 'pcs', '10', '14', '', '100', '50', '30', '30', '30'],
                ['A', 'Alpha', 'pcs', '100', '14', 'West', '0', '', '30', '30', '30'],
                ['A', 'Alpha', 'pcs', '10', '14', 'Bad', '100', '-1', '30', '30', '30']]
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'warehouse.csv'
            path.write_text(text(rows))
            data = csv_import.preflight_csv(text(rows))
            result = meaning.interpret_csv(path, data, dict(stock_includes_reserved=True), '2026-11-20')
        self.assertEqual(result['items'][0]['on_hand'], 10)
        self.assertEqual(result['items'][0]['on_order'], 50)
        self.assertTrue(result['items'][0]['incoming_unknown'])
        self.assertIn(meaning.INCOMING_PARTLY_UNKNOWN, result['items'][0]['input_warnings'])

    def test_csv_blank_records_do_not_shift_accepted_identities(self):
        import tempfile
        rows = [['sku', 'name', 'unit', 'on_hand', 'supplier_days', 'Warehouse', 'reserved', 'on_order', '2026-07', '2026-08', '2026-09'],
                ['', '', '', '', '', '', '', '', '', '', ''],
                ['A', 'Alpha', 'pcs', '10', '14', '', '100', '50', '30', '30', '30'],
                ['A', 'Alpha', 'pcs', '100', '14', 'West', '0', '', '30', '30', '30']]
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'warehouse.csv'
            path.write_text(text(rows))
            result = meaning.interpret_csv(path, csv_import.preflight_csv(text(rows)), dict(stock_includes_reserved=True), '2026-11-20')
        self.assertEqual(result['items'][0]['on_hand'], 10)
        self.assertIn(meaning.INCOMING_PARTLY_UNKNOWN, result['items'][0]['input_warnings'])

    def test_workbook_does_not_hide_invalid_reserved_by_aggregation(self):
        rows = [['sku', 'name', 'on_hand', 'reserved', 'Warehouse'],
                ['A', 'Alpha', '10', '-1', 'East'], ['A', 'Alpha', '20', '2', 'West']]
        sheets = [dict(name='Stock', rows=rows)]
        review = meaning.review_input_meaning(sheets, smart.understand_workbook(sheets), dict(stock_includes_reserved=True), '2026-11-20')
        self.assertTrue(review['requires_ack'])
        self.assertIn('Reserved stock could not be subtracted', ' '.join(review['warnings']))

    def test_absent_location_column_does_not_claim_distinct_warehouses(self):
        report = smart.understand_workbook([dict(name='Stock', rows=[['sku', 'name', 'on_hand'], ['A', 'Alpha', '10'], ['A', 'Alpha', '20']])])
        self.assertEqual(values(report)['on_hand'], '10')
        self.assertIn('duplicate sku without warehouse/location', ' '.join(report['warnings']))

    def test_stock_unit_is_the_default_canonical_unit(self):
        sheets = [dict(name='Stock', rows=[['sku', 'name', 'Stock unit', 'on_hand', '2026-07', '2026-08', '2026-09'], ['A', 'Alpha', 'pcs', '100', '30', '30', '30']])]
        report = smart.understand_workbook(sheets)
        self.assertEqual(values(report)['unit'], 'pcs')
        review = meaning.review_input_meaning(sheets, report, {}, '2026-11-20')
        self.assertNotIn('Sales and stock units disagree', ' '.join(review['warnings']))

    def test_repeated_ledger_reserved_is_not_summed(self):
        sheets = [dict(name='Ledger', rows=[['sku', 'name', 'date', 'quantity', 'on_hand', 'reserved'],
                  ['A', 'Alpha', '2026-07-01', '30', '100', '20'],
                  ['A', 'Alpha', '2026-08-01', '30', '100', '20'],
                  ['A', 'Alpha', '2026-09-01', '30', '100', '20']])]
        report = smart.understand_workbook(sheets)
        self.assertEqual(values(report)['reserved'], '20')
        review = meaning.review_input_meaning(sheets, report, dict(stock_includes_reserved=True), '2026-11-20')
        self.assertEqual(values(smart.understand_workbook(review['sheets']))['on_hand'], '80')

    def test_same_sheet_metadata_conflict_requires_acknowledgement(self):
        sheets = [dict(name='Stock', rows=[['sku', 'name', 'on_hand', 'supplier_days', 'Warehouse'],
                  ['A', 'Alpha', '10', '14', 'East'], ['A', 'Alpha', '20', '21', 'West']])]
        review = meaning.review_input_meaning(sheets, smart.understand_workbook(sheets), {}, '2026-11-20')
        self.assertTrue(review['requires_ack'])
        self.assertIn('supplier_days', ' '.join(review['reasons']))

    def test_canonical_netting_retains_warehouse_oversold_warning(self):
        sheets = [dict(name='Stock', rows=[['sku', 'name', 'on_hand', 'reserved', 'Warehouse'],
                  ['A', 'Alpha', '10', '100', 'East'], ['A', 'Alpha', '100', '0', 'West']])]
        report = smart.understand_workbook(sheets)
        review = meaning.review_input_meaning(sheets, report, dict(stock_includes_reserved=True), '2026-11-20')
        self.assertIn('Oversold:', ' '.join(review['warnings']))
        self.assertEqual(values(smart.understand_workbook(review['sheets']))['on_hand'], '10')


if __name__ == '__main__':
    unittest.main()
