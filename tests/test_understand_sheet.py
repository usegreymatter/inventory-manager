"""Offline CLI contract: /usr/bin/python3 -m unittest discover -s tests -p test_understand_sheet.py."""
from baseline import read_baseline
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
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/understand_sheet.py'
package = types.ModuleType('understand_sheet_test')
package.__path__ = [str(ROOT)]
sys.modules.setdefault(package.__name__, package)
core = importlib.import_module(package.__name__ + '.smart_import')
preflight = importlib.import_module(package.__name__ + '.csv_import').preflight_csv


class UnderstandSheetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.input = self.folder / 'stock.csv'
        self.input.write_text('SKU,Name,On hand,2026-01,2026-02,2026-03\n001,Widget,12,2,3,4\n', encoding='utf-8')

    def run_cli(self, *args, code=0):
        result = subprocess.run(['/usr/bin/python3', str(SCRIPT), *map(str, args)],
                                text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, code, result.stderr + result.stdout)
        self.assertNotIn('Traceback', result.stderr)
        return result

    def test_json_is_core_report_with_existing_preflight(self):
        result = self.run_cli(self.input, '--json')
        report = json.loads(result.stdout)
        expected = core.understand_workbook(core.read_workbook(self.input))
        for key, value in expected.items():
            self.assertEqual(report[key], value, key)
        text = io.StringIO(newline='')
        csv.writer(text, lineterminator='\n').writerows(expected['canonical_rows'])
        self.assertEqual(report['validation']['import_report'], preflight(text.getvalue())['import_report'])
        self.assertTrue(report['review_required'])
        self.assertTrue(report['validation']['ok'])
        self.assertEqual(result.stderr, '')

    def test_human_output_names_layout_confidence_warnings_and_review(self):
        self.input.write_text('SKU,Name,QOH,Jan,Feb,Mar\n001,Widget,12,2,3,4\n')
        out = self.run_cli(self.input).stdout
        for text in ('Layout: wide', 'Header row: 1', 'QOH', 'low', '2000', 'Review required', 'Validation:'):
            self.assertIn(text, out)

    def test_mapping_export_and_roundtrip(self):
        mapping = self.folder / 'mapping.json'
        target = self.folder / 'canonical.csv'
        report = json.loads(self.run_cli(self.input, '--json', '--mapping-out', mapping, '--to-csv', target).stdout)
        saved = json.loads(mapping.read_text())
        self.assertEqual(set(saved), {'mapping_version', 'connector', 'description', 'streams'})
        self.assertEqual(saved['mapping_version'], '1')
        self.assertEqual(saved['connector'], 'spreadsheet')
        self.assertEqual(saved['streams']['stock']['source'], 'stock')
        self.assertFalse(saved['streams']['stock']['verified'])
        self.assertEqual(saved['streams']['stock']['fields']['sku'], {'from': 'column:0'})
        rerun = json.loads(self.run_cli(self.input, '--mapping', mapping, '--json').stdout)
        self.assertEqual(report['canonical_rows'], rerun['canonical_rows'])
        self.assertEqual(list(csv.reader(io.StringIO(target.read_text(encoding='utf-8-sig')))), report['canonical_rows'])
        self.assertEqual(report['outputs'], {'mapping': str(mapping), 'csv': str(target)})

    def test_mapping_roundtrip_does_not_promote_data_row_to_header(self):
        self.input.write_text('SKU,Name,Unrecognized unit,On hand,2026-01,2026-02,2026-03\n001,Widget,units,12,2,3,4\n002,Other,units,8,1,2,3\n')
        mapping = self.folder / 'map.json'
        before = json.loads(self.run_cli(self.input, '--mapping-out', mapping, '--json').stdout)
        after = json.loads(self.run_cli(self.input, '--mapping', mapping, '--json').stdout)
        self.assertEqual(before['canonical_rows'], after['canonical_rows'])
        self.assertEqual(after['header_row'], 1)

    def test_real_override_keeps_header_and_missing_stock_fails_closed(self):
        self.input.write_text('SKU,Name,Unknown unit,On hand,2026-01,2026-02,2026-03\n001,Widget,units,12,2,3,4\n002,Other,units,8,1,2,3\n')
        mapping = self.folder / 'map.json'
        mapping.write_text(json.dumps({'stock:0': 'name', 'stock:1': 'sku', 'stock:3': 'on_order',
                                       'stock:4': '2027-01', 'stock:5': '2027-02', 'stock:6': '2027-03'}))
        result = json.loads(self.run_cli(self.input, '--mapping', mapping, '--json', code=2).stdout)
        self.assertEqual(result['header_row'], 1)
        self.assertEqual(len(result['canonical_rows']), 3)
        self.assertFalse(result['validation']['ok'])
        self.assertIn('On-hand stock', result['missing'])

    def test_raw_overrides_repair_unrecognized_column(self):
        self.input.write_text(self.input.read_text().replace('SKU,', 'Mystery,'))
        mapping = self.folder / 'manual.json'
        mapping.write_text(json.dumps({'stock:0': 'sku'}))
        report = json.loads(self.run_cli(self.input, '--mapping', mapping, '--json').stdout)
        self.assertEqual(report['missing'], [])
        self.assertEqual(report['mapping'][0]['reason'], 'Manual mapping')

    def test_unknown_override_is_rejected_not_silently_ignored(self):
        for payload in ({'stock:0': 'invented'}, {'absent:0': 'sku'}, {'stock:99': 'sku'}, {'stock:0': 5}):
            with self.subTest(payload=payload):
                mapping = self.folder / 'manual.json'
                mapping.write_text(json.dumps(payload))
                result = json.loads(self.run_cli(self.input, '--mapping', mapping, '--json', code=2).stdout)
                self.assertIn('mapping', result['error'].lower())

    def test_schema_mapping_accepts_unique_header_sources(self):
        mapping = self.folder / 'manual.json'
        mapping.write_text(json.dumps({'mapping_version': '1', 'connector': 'csv', 'streams': {
            'items': {'source': 'stock', 'fields': {'sku': 'SKU', 'name': {'from': 'Name'}}}}}))
        report = json.loads(self.run_cli(self.input, '--mapping', mapping, '--json').stdout)
        self.assertTrue(report['validation']['ok'])

    def test_unsupported_mapping_transforms_are_not_silently_executed(self):
        mapping = self.folder / 'manual.json'
        mapping.write_text(json.dumps({'mapping_version': '1', 'connector': 'csv', 'streams': {
            'items': {'source': 'stock', 'fields': {'on_hand': {'from': 'On hand', 'transform': 'negate'}}}}}))
        self.assertIn('mapping', json.loads(self.run_cli(self.input, '--mapping', mapping, '--json', code=2).stdout)['error'].lower())

    def test_selected_xlsx_sheet_name_and_join(self):
        path = self.folder / 'book.xlsx'
        sheets = [('Stock', [['SKU', 'Name', 'On hand'], ['001', 'Widget', '12']]),
                  ('Sales', [['SKU', 'Date', 'Quantity'], ['001', '2026-01-01', '2'],
                             ['001', '2026-02-01', '3'], ['001', '2026-03-01', '4']])]
        make_workbook(path, sheets)
        report = json.loads(self.run_cli(path, '--sheet', 'Stock', '--json').stdout)
        self.assertEqual(report['sheet_used'], 'Stock')
        self.assertEqual(report['match_report']['matched'], 1)
        self.assertEqual(report['canonical_rows'][1], ['001', 'Widget', 'units', '12', '', '2', '3', '4'])
        self.assertIn('worksheet', json.loads(self.run_cli(path, '--sheet', 'Missing', '--json', code=2).stdout)['error'])

    def test_validation_failure_preserves_report_and_does_not_export_csv(self):
        self.input.write_text('SKU,Name,On hand\n001,Widget,12\n')
        target = self.folder / 'canonical.csv'
        mapping = self.folder / 'mapping.json'
        report = json.loads(self.run_cli(self.input, '--json', '--to-csv', target, '--mapping-out', mapping, code=2).stdout)
        self.assertFalse(report['validation']['ok'])
        self.assertIn('error', report['validation'])
        self.assertIn('canonical_rows', report)
        self.assertFalse(target.exists())
        self.assertTrue(mapping.exists())

    def test_partial_preflight_is_visible_and_csv_export_is_blocked(self):
        with self.input.open('a') as handle:
            handle.write('002,Broken,-1,2,3,4\n')
        target = self.folder / 'canonical.csv'
        report = json.loads(self.run_cli(self.input, '--json', '--to-csv', target, code=2).stdout)
        self.assertEqual(report['validation']['import_report']['products_ready'], 1)
        self.assertTrue(any('negative on_hand' in warning and 'row omitted' in warning for warning in report['warnings']))
        self.assertIn('CSV export blocked', report['error'])
        self.assertFalse(target.exists())

    def test_friendly_errors_in_text_and_json(self):
        for name, content, message in [('old.xls', b'legacy', 'Save as .xlsx or CSV'),
                                       ('bad.xlsx', b'not a zip', 'Could not read workbook'),
                                       ('bad.csv', b'\xffoops', 'UTF-8')]:
            with self.subTest(name=name):
                path = self.folder / name
                path.write_bytes(content)
                self.assertIn(message, self.run_cli(path, code=2).stderr)
                self.assertIn(message, json.loads(self.run_cli(path, '--json', code=2).stdout)['error'])
        self.assertIn('Could not read', json.loads(self.run_cli(self.folder/'missing.csv', '--json', code=2).stdout)['error'])

    def test_input_and_output_size_caps(self):
        path = self.folder / 'large.csv'
        with path.open('wb') as handle:
            handle.truncate(20 * 1024 * 1024 + 1)
        self.assertIn('20 MiB', self.run_cli(path, code=2).stderr)
        mapping = self.folder / 'large.json'
        with mapping.open('wb') as handle:
            handle.truncate(2 * 1024 * 1024 + 1)
        self.assertIn('2 MiB', self.run_cli(self.input, '--mapping', mapping, code=2).stderr)

    def test_refuses_clobber_or_output_collisions_before_writing(self):
        before = self.input.read_bytes()
        target = self.folder / 'out.csv'
        target.write_text('keep')
        for args in [('--to-csv', self.input), ('--mapping-out', target),
                     ('--mapping-out', self.folder/'same', '--to-csv', self.folder/'same')]:
            self.run_cli(self.input, *args, code=2)
        self.assertEqual(self.input.read_bytes(), before)
        self.assertEqual(target.read_text(), 'keep')
        self.assertFalse((self.folder/'same').exists())

    def test_schema_caps_are_export_errors_not_inspection_errors(self):
        headers = ['SKU', 'Name', 'On hand'] + ['%04d-%02d' % (2020 + i // 12, i % 12 + 1) for i in range(42)]
        with self.input.open('w', newline='') as handle:
            csv.writer(handle).writerows([headers, ['001', 'Widget', '12'] + ['1']*42])
        self.run_cli(self.input, '--json')
        self.assertIn('40', self.run_cli(self.input, '--mapping-out', self.folder/'map.json', code=2).stderr)

    def test_duplicate_month_mapping_export_fails_instead_of_losing_columns(self):
        self.input.write_text('SKU,Name,On hand,2026-01,2026-01,2026-02,2026-03\n001,Widget,12,1,2,3,4\n')
        self.run_cli(self.input, '--json')
        self.assertIn('duplicate', self.run_cli(self.input, '--mapping-out', self.folder/'map.json', code=2).stderr.lower())

    def test_export_rejects_canonical_csv_above_existing_loader_byte_cap(self):
        self.input.write_text('SKU,Name,On hand,2026-01,2026-02,2026-03\n001,' + 'x'*(2*1024*1024) + ',12,2,3,4\n')
        target = self.folder / 'canonical.csv'
        self.assertIn('2 MiB', self.run_cli(self.input, '--to-csv', target, code=2).stderr)
        self.assertFalse(target.exists())

    def test_mapping_export_matches_referenced_schema_subset(self):
        schema = json.loads(read_baseline('342cd4a76d63dcd4b8d7abe12118287cc7b2314b:docs/architecture/schema/mapping.schema.json', text=True))
        mapping = self.folder / 'mapping.json'
        self.run_cli(self.input, '--mapping-out', mapping)
        document = json.loads(mapping.read_text())
        self.assertTrue(set(schema['required']) <= set(document))
        self.assertTrue(set(document) <= set(schema['properties']))
        self.assertEqual(document['mapping_version'], schema['properties']['mapping_version']['const'])
        self.assertRegex(document['connector'], schema['properties']['connector']['pattern'])
        self.assertLessEqual(len(document['description']), schema['properties']['description']['maxLength'])
        streams = schema['properties']['streams']
        self.assertLessEqual(len(document['streams']), streams['maxProperties'])
        stream_schema = streams['additionalProperties']
        for stream in document['streams'].values():
            self.assertTrue(set(stream_schema['required']) <= set(stream))
            self.assertTrue(set(stream) <= set(stream_schema['properties']))
            self.assertLessEqual(len(stream['source']), stream_schema['properties']['source']['maxLength'])
            self.assertIsInstance(stream['verified'], bool)
            fields = stream_schema['properties']['fields']
            self.assertLessEqual(len(stream['fields']), fields['maxProperties'])
            from_schema = fields['additionalProperties']['oneOf'][1]['properties']['from']
            for source in stream['fields'].values():
                self.assertEqual(set(source), {'from'})
                self.assertIsInstance(source['from'], str)
                self.assertLessEqual(len(source['from']), from_schema['maxLength'])

    def test_eight_existing_preflight_examples_are_byte_identical_to_core_commit(self):
        baseline = types.ModuleType('understand_sheet_baseline')
        baseline.__path__ = [str(ROOT)]
        sys.modules[baseline.__name__] = baseline
        for name in ('engine', 'sources', 'csv_import'):
            module = types.ModuleType(baseline.__name__ + '.' + name)
            module.__package__ = baseline.__name__
            module.__file__ = '6fca685:' + name + '.py'
            sys.modules[module.__name__] = module
            source = read_baseline(module.__file__)
            exec(compile(source, module.__file__, 'exec'), module.__dict__)
        paths = sorted((ROOT/'docs/erp-examples').glob('*.csv'))
        self.assertEqual(len(paths), 8)
        old = sys.modules[baseline.__name__ + '.csv_import']
        for path in paths:
            with self.subTest(path=path.name):
                text = path.read_text(encoding='utf-8-sig')
                self.assertEqual(json.dumps(preflight(text), ensure_ascii=False),
                                 json.dumps(old.preflight_csv(text), ensure_ascii=False))


def make_workbook(path, sheets):
    """Minimal local XLSX fixture; never reads a real workbook or live data."""
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('xl/workbook.xml', '<workbook xmlns:r="urn:rels"><sheets>' + ''.join(
            '<sheet name="%s" r:id="r%d"/>' % (escape(name), i) for i, (name, _) in enumerate(sheets)) + '</sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships>' + ''.join(
            '<Relationship Id="r%d" Target="worksheets/s%d.xml"/>' % (i, i) for i in range(len(sheets))) + '</Relationships>')
        for i, (_, rows) in enumerate(sheets):
            xml = '<worksheet><sheetData>' + ''.join('<row>' + ''.join(
                '<c t="inlineStr"><is><t>%s</t></is></c>' % escape(value) for value in row) + '</row>' for row in rows) + '</sheetData></worksheet>'
            archive.writestr('xl/worksheets/s%d.xml' % i, xml)


if __name__ == '__main__':
    unittest.main()
