"""Synthetic-only shelf/lot imports, exact Python/Desktop/smart mirror parity."""
import csv
import importlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('stock_runway')
pkg.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', pkg)
from stock_runway.csv_import import preflight_csv
import test_smart_import_core as smart_tests


class ShelfLotImportTests(unittest.TestCase):
    def text(self, extra, rows):
        out = io.StringIO(newline='')
        w = csv.writer(out)
        w.writerow(['SKU', 'Name', 'On hand', '2026-01', '2026-02', '2026-03', *extra])
        w.writerows([['A', 'Synthetic', *row] for row in rows])
        return out.getvalue()

    def parity(self, text):
        data = preflight_csv(text)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'synthetic.csv'
            p.write_text(text)
            run = subprocess.run(['node', 'tests/import-parity.cjs', str(p)], cwd=ROOT, text=True, capture_output=True, check=True)
            self.assertEqual(json.loads(run.stdout)[str(p)], {'data': data})
        return data

    def smart(self, extra, rows):
        text = self.text(extra, rows)
        harness = smart_tests.SmartImportCoreTests()
        harness.setUp()
        report = harness.parity([dict(name='Synthetic', delimiter=',', rows=list(csv.reader(io.StringIO(text))))])
        out = io.StringIO(newline='')
        csv.writer(out).writerows(report['canonical_rows'])
        return report, self.parity(out.getvalue())

    def test_lot_rows_never_duplicate_product_sales_or_incoming(self):
        rows=[['50','300','300','300','A','2026-12-01'],['50','300','300','300','B','2027-01-01']]
        data=self.parity(self.text(['Lot','Expiry date'],rows))
        self.assertEqual(data['items'][0]['monthly_sales'],[300,300,300])
        self.assertEqual(data['items'][0]['on_hand'],100)
        report,smart=self.smart(['Lot','Expiry date'],rows)
        self.assertEqual(smart['items'][0]['monthly_sales'],[300,300,300])
        self.assertFalse(report['review_report']['requires_ack'])
        rows=[['50','300','300','300','A','2026-12-01','20'],['60','300','300','300','B','2027-01-01','30']]
        data=self.parity(self.text(['Lot','Expiry date','Lot quantity'],rows))
        self.assertIn('conflicting stock snapshot',' '.join(data['import_report']['warnings']))

    def test_aliases_and_canonical_lot_shape(self):
        data = self.parity(self.text(['Shelf life (days)', 'Batch', 'Best before', 'Lot quantity'], [['10', '1', '2', '3', '30', 'B-1', '2026-12-01', '10']]))
        item = data['items'][0]
        self.assertEqual(item['shelf_life_days'], 30)
        self.assertEqual(item['lots'], [dict(lot='B-1', expiry='2026-12-01', qty=10)])
        self.assertNotIn('expiry_warnings', item)

    def test_repeated_lot_rows_sum_quantities_not_repeated_snapshots(self):
        rows = [['10', '1', '2', '3', 'B-1', '2026-12-01', '4'], ['10', '1', '2', '3', 'B-1', '2026-12-01', '2'], ['10', '1', '2', '3', 'B-2', '2027-01-01', '4']]
        data = self.parity(self.text(['Lot number', 'Use by', 'Lot quantity'], rows))
        self.assertEqual(data['import_report']['rows_imported'], 3)
        self.assertEqual(data['items'][0]['on_hand'], 10)
        self.assertEqual(data['items'][0]['monthly_sales'], [1, 2, 3])
        self.assertEqual(data['items'][0]['lots'], [dict(lot='B-1', expiry='2026-12-01', qty=6), dict(lot='B-2', expiry='2027-01-01', qty=4)])
        self.assertNotIn('duplicate export', ' '.join(data['import_report']['warnings']))

    def test_lot_stock_rows_without_separate_quantity_sum_stock(self):
        data = self.parity(self.text(['Lot', 'Lot expiry'], [['4', '1', '2', '3', 'B-1', '2026-12-01'], ['6', '4', '5', '6', 'B-2', '2027-01-01']]))
        self.assertEqual(data['items'][0]['on_hand'], 10)
        self.assertEqual([lot['qty'] for lot in data['items'][0]['lots']], [4, 6])

    def test_date_formats_flags_and_mismatch(self):
        for raw, expected, note, ack in [('2028-02', '2028-02-29', 'month-only', False), ('02/2028', '2028-02-29', 'month-only', False), ('Feb 2028', '2028-02-29', 'month-only', False), ('46000', '2025-12-09', 'Excel serial', False), ('03/04/2027', '2027-03-04', 'ambiguous expiry date', True), ('31/12/2027', '2027-12-31', '', False)]:
            with self.subTest(raw=raw):
                data = self.parity(self.text(['Lot', 'Expiry date', 'Lot quantity'], [['10', '1', '2', '3', 'B', raw, '8']]))
                item = data['items'][0]
                self.assertEqual(item['lots'][0]['expiry'], expected)
                self.assertEqual(item['lots'][0].get('expiry_acknowledged'), False if ack else None)
                warnings = ' '.join(data['import_report']['warnings'])
                if note: self.assertIn(note, warnings)
                self.assertIn('lot total', warnings)
                self.assertIn('on-hand', warnings)

    def test_invalid_shelf_life_and_lot_cells_are_set_aside(self):
        for extra, bad in [(['Shelf life (days)'], ['-1']), (['Shelf life (days)'], ['1.5']), (['Lot', 'Expiry date', 'Lot quantity'], ['B', '2027-02-30', '1']), (['Lot', 'Expiry date', 'Lot quantity'], ['B', '2027-01-01', '-1'])]:
            with self.subTest(bad=bad):
                data = self.parity(self.text(extra, [['10', '1', '2', '3', *([''] * len(extra))], ['10', '1', '2', '3', *bad]]))
                self.assertEqual(data['import_report']['rows_imported'], 1)
                self.assertEqual(len(data['import_report']['rows_set_aside']), 1)
                self.assertNotIn('duplicate', data['import_report']['rows_set_aside'][0]['reason'])

    def test_smart_lots_round_trip_and_ambiguous_review(self):
        report, data = self.smart(['Shelf life (days)', 'Batch', 'Best before', 'Lot quantity'], [['10', '1', '2', '3', '30', 'B', '03/04/2027', '4'], ['10', '1', '2', '3', '30', 'C', '2027-04', '6']])
        self.assertEqual(data['items'][0]['shelf_life_days'], 30)
        self.assertEqual(len(data['items'][0]['lots']), 2)
        self.assertEqual(data['items'][0]['on_hand'], 10)
        self.assertTrue(report['review_report']['requires_ack'])
        self.assertIn('ambiguous expiry date', ' '.join(report['review_report']['reasons']))
        self.assertIn('ambiguous expiry date', ' '.join(report['review_report']['input_warnings']['A']))
        self.assertNotIn('duplicate export', ' '.join(report['warnings']))

    def test_smart_identical_lot_rows_are_legitimate_contributors(self):
        report, data = self.smart(['Lot', 'Expiry date', 'Lot quantity'], [['10', '1', '2', '3', 'B', '2027-01-01', '5']] * 2)
        self.assertEqual(data['items'][0]['lots'], [dict(lot='B', expiry='2027-01-01', qty=10)])
        self.assertFalse(report['review_report']['requires_ack'])
        self.assertNotIn('duplicate export', ' '.join(report['warnings']))

    def test_json_lots_round_trip_does_not_acknowledge_ambiguity(self):
        lots = [dict(lot='B', expiry='2027-03-04', qty=10, expiry_acknowledged=False)]
        data = self.parity(self.text(['lots'], [['10', '1', '2', '3', json.dumps(lots)]]))
        self.assertEqual(data['items'][0]['lots'], lots)
        report, _ = self.smart(['lots'], [['10', '1', '2', '3', json.dumps(lots)]])
        self.assertTrue(report['review_report']['requires_ack'])


    def test_smart_fractional_lot_quantities_have_exact_string_parity(self):
        for qty in ['0.5', '1e-7']:
            with self.subTest(qty=qty):
                report, data = self.smart(['Lot', 'Expiry date', 'Lot quantity'], [['1', '1', '2', '3', 'B', '2027-01-01', qty]] * 2)
                self.assertEqual(data['items'][0]['lots'][0]['qty'], float(qty) * 2)

    def test_smart_separate_lot_sheet_joins_all_lots_without_summing_stock(self):
        harness = smart_tests.SmartImportCoreTests(); harness.setUp()
        result = harness.parity([
            dict(name='Stock', rows=[['SKU', 'Name', 'On hand', '2026-01', '2026-02', '2026-03'], ['A', 'Synthetic', '10', '1', '2', '3']]),
            dict(name='Lots', rows=[['SKU', 'Batch', 'Best before', 'Lot quantity'], ['A', 'B', '2027-01-01', '4'], ['A', 'C', '2027-02-01', '6']])])
        values = dict(zip(result['canonical_rows'][0], result['canonical_rows'][1]))
        self.assertEqual(values['on_hand'], '10')
        self.assertEqual([lot['lot'] for lot in json.loads(values['lots'])], ['B', 'C'])

    def test_smart_lot_snapshot_conflict_requires_review(self):
        report, data = self.smart(['Lot', 'Expiry date', 'Lot quantity'], [['10', '1', '2', '3', 'B', '2027-01-01', '4'], ['20', '1', '2', '3', 'C', '2027-01-01', '6']])
        self.assertEqual(data['items'][0]['on_hand'], 10)
        self.assertTrue(report['review_report']['requires_ack'])
        self.assertIn('conflicting on_hand', ' '.join(report['review_report']['reasons']))

    def test_conflicting_shelf_life_requires_review(self):
        report, data = self.smart(['Shelf life (days)', 'Lot', 'Expiry date', 'Lot quantity'], [['10', '1', '2', '3', '30', 'B', '2027-01-01', '4'], ['10', '1', '2', '3', '60', 'C', '2027-01-01', '6']])
        self.assertEqual(data['items'][0]['shelf_life_days'], 30)
        self.assertTrue(report['review_report']['requires_ack'])
        self.assertIn('conflicting shelf_life_days', ' '.join(report['review_report']['reasons']))

    def test_strict_import_keeps_new_fields_and_rejects_bad_rows(self):
        from stock_runway.sources import SourceError
        text = self.text(['Shelf life (days)', 'Lot', 'Expiry date'], [['10', '1', '2', '3', '30', 'B', '2027-01-01']])
        self.assertEqual(preflight_csv(text, strict=True)['items'], self.parity(text)['items'])
        with self.assertRaises(SourceError):
            preflight_csv(self.text(['Shelf life (days)'], [['10', '1', '2', '3', '-1']]), strict=True)

    def test_canonical_review_metadata_carries_ambiguous_date_gate(self):
        from stock_runway.smart_import import contributor_metadata
        report, _ = self.smart(['Lot', 'Expiry date'], [['10', '1', '2', '3', 'B', '03/04/2027']])
        metadata = contributor_metadata(report['review_sheets'][0], report['review_report']['sheets'][0])
        self.assertIn('ambiguous expiry date', ' '.join(metadata['reasons']))

    def test_xlsx_builtin_month_only_expiry_style(self):
        self.test_xlsx_month_only_expiry_style_retains_end_of_month_warning(builtin=True)

    def test_xlsx_month_only_expiry_style_retains_end_of_month_warning(self, builtin=False):
        harness = smart_tests.SmartImportCoreTests(); harness.setUp()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.xlsx'
            smart_tests.make_xlsx(path)
            with zipfile.ZipFile(path) as z:
                parts = {n: z.read(n) for n in z.namelist()}
            parts['xl/styles.xml'] = b'<styleSheet><numFmts><numFmt numFmtId="165" formatCode="mmm-yy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="165"/></cellXfs></styleSheet>'
            if builtin:
                parts['xl/styles.xml'] = b'<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="17"/></cellXfs></styleSheet>'
            parts['xl/worksheets/sheet1.xml'] = ('<worksheet><sheetData><row>'+''.join('<c t="inlineStr"><is><t>'+h+'</t></is></c>' for h in ['SKU','Name','On hand','Best before','Lot','2026-01','2026-02','2026-03'])+'</row><row><c t="inlineStr"><is><t>A</t></is></c><c t="inlineStr"><is><t>Synthetic</t></is></c><c><v>10</v></c><c s="1"><v>46000</v></c><c t="inlineStr"><is><t>B</t></is></c><c><v>1</v></c><c><v>2</v></c><c><v>3</v></c></row></sheetData></worksheet>').encode()
            with zipfile.ZipFile(path, 'w') as z:
                for name, value in parts.items(): z.writestr(name, value)
            sheets = harness.core.read_workbook(path)
            self.assertEqual(sheets, harness.js_read(path))
            report = harness.parity(sheets)
            values = dict(zip(report['canonical_rows'][0], report['canonical_rows'][1]))
            self.assertEqual(json.loads(values['lots'])[0]['expiry'], '2025-12-31')
            self.assertIn('month-only', ' '.join(report['warnings']))


if __name__ == '__main__':
    unittest.main()
