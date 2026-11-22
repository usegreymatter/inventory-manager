"""Optional sale-price import contracts; stdlib + Node, synthetic inputs only.

Desktop preflight is exercised after generating its pending synchronization IN
MEMORY: this lane must not edit desktop/plugin.js. Integration runs the sync.
"""
import csv
import importlib.util
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
package = types.ModuleType('stock_runway')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', package)
from stock_runway.csv_import import preflight_csv, PRODUCT_TYPE_ALIASES
from stock_runway.smart_import import understand_workbook, read_workbook
from stock_runway.sources import ERP_ALIASES, SourceError

ALIASES = ['sale_price', 'price', 'selling price', 'retail price', 'sales price', 'list price']
MONTHS = ['2026-01', '2026-02', '2026-03']


def csv_text(headers, rows, delimiter=','):
    output = io.StringIO()
    csv.writer(output, delimiter=delimiter, lineterminator='\n').writerows([headers, *rows])
    return output.getvalue()


def sync_module():
    spec = importlib.util.spec_from_file_location('sale_price_sync', ROOT / 'scripts/sync_smart_import.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SalePriceImportTests(unittest.TestCase):
    def smart_parity(self, sheets, overrides=None):
        vocabulary = json.loads((ROOT / 'smart-import-vocabulary.json').read_text())
        aliases = {field: [*labels, *vocabulary.get(field, [])] for field, labels in ERP_ALIASES.items()}
        script = """import fs from 'node:fs';
const code=fs.readFileSync('desktop/smart-import.js','utf8');
const core=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const p=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(core.understandWorkbook(p.sheets,null,p.overrides,p.aliases,p.types)));
"""
        run = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                             input=json.dumps(dict(sheets=sheets, aliases=aliases,
                                                   overrides=overrides, types=PRODUCT_TYPE_ALIASES)),
                             text=True, capture_output=True, check=True)
        actual = understand_workbook(sheets, overrides=overrides)
        self.assertEqual(actual, json.loads(run.stdout))
        return actual

    def test_all_price_aliases_import_in_csv_and_smart_workbooks(self):
        for alias in ALIASES:
            with self.subTest(alias=alias):
                headers = ['SKU', 'Name', 'On hand', alias, *MONTHS]
                rows = [['A', 'Widget', '10', '$ 12.50', '1', '2', '3']]
                actual = preflight_csv(csv_text(headers, rows))
                self.assertEqual(actual['items'][0].get('sale_price'), 12.5)
                self.assertIn(dict(source=alias, field='sale_price'), actual['import_report']['matched'])
                report = self.smart_parity([dict(name='Stock', rows=[headers, *rows], delimiter=',')])
                values = dict(zip(*report['canonical_rows'][:2]))
                self.assertEqual(float(values['sale_price']), 12.5)
                self.assertEqual(preflight_csv(csv_text(report['canonical_rows'][0], report['canonical_rows'][1:]))['items'][0]['sale_price'], 12.5)

    def test_price_is_absent_when_column_or_cell_is_missing_but_zero_is_valid(self):
        base = ['SKU', 'Name', 'On hand', 'Unit cost', *MONTHS]
        plain = preflight_csv(csv_text(base, [['A', 'Widget', '10', '2', '1', '2', '3']]))
        self.assertNotIn('sale_price', plain['items'][0])
        headers = [*base, 'sale_price']
        rows = [['A', 'Widget', '10', '2', '1', '2', '3', ''],
                ['B', 'Free sample', '10', '2', '1', '2', '3', '0']]
        data = preflight_csv(csv_text(headers, rows))
        self.assertEqual(data['items'][0], plain['items'][0])
        self.assertEqual(data['items'][1].get('sale_price'), 0)
        report = self.smart_parity([dict(name='Stock', rows=[headers, *rows], delimiter=',')])
        imported = preflight_csv(csv_text(report['canonical_rows'][0], report['canonical_rows'][1:]))
        self.assertNotIn('sale_price', imported['items'][0])
        self.assertEqual(imported['items'][1].get('sale_price'), 0)
        report = self.smart_parity([dict(name='Stock', rows=[base, rows[0][:-1]], delimiter=',')])
        self.assertNotIn('sale_price', report['canonical_rows'][0])

    def test_sale_price_uses_unit_cost_currency_and_locale_rules(self):
        for delimiter, raw, expected in [(',', '$1,234.50', 1234.5),
                (';', '€ 1.234,50', 1234.5), (';', '€ 2,50', 2.5),
                (';', '€ 1\u202f234,50', 1234.5), ('\t', '£ 1,234.50', 1234.5)]:
            with self.subTest(delimiter=delimiter, raw=raw):
                headers = ['SKU', 'Name', 'On hand', 'Unit cost', 'Selling Price', *MONTHS]
                rows = [['A', 'Widget', '10', raw, raw, '1', '2', '3']]
                data = preflight_csv(csv_text(headers, rows, delimiter))
                self.assertEqual(data['items'][0].get('sale_price'), expected)
                self.assertEqual(data['items'][0]['unit_cost'], expected)
                report = self.smart_parity([dict(name='Stock', rows=[headers, *rows], delimiter=delimiter)])
                values = dict(zip(*report['canonical_rows'][:2]))
                self.assertEqual(values.get('sale_price'), values['unit_cost'])
                self.assertEqual(float(values['sale_price']), expected)

    def test_price_alone_participates_in_semicolon_number_style_detection(self):
        headers = ['SKU', 'Name', 'On hand', 'Retail price', *MONTHS]
        rows = [['A', 'Widget', '10', '€ 2,50', '1', '2', '3']]
        data = preflight_csv(csv_text(headers, rows, ';'))
        self.assertEqual(data['items'][0].get('sale_price'), 2.5)
        self.assertIn('Number format: decimal-comma (comma decimal; dot thousands)', data['import_report']['warnings'])
        report = self.smart_parity([dict(name='Stock', rows=[headers, *rows], delimiter=';')])
        self.assertEqual(dict(zip(*report['canonical_rows'][:2])).get('sale_price'), '2.50')

    def test_invalid_prices_are_not_silently_dropped_or_guessed(self):
        for raw, delimiter in [('-1', ','), ('NaN', ','), ('Infinity', ','),
                ('1e309', ','), ('1000000000001', ','), ('no price', ','),
                ('€ 1,234', ';'), ('1.234', ';')]:
            with self.subTest(raw=raw):
                headers = ['SKU', 'Name', 'On hand', 'sale_price', *MONTHS]
                rows = [['A', 'Bad', '10', raw, '1', '2', '3'],
                        ['B', 'Good', '10', '', '1', '2', '3']]
                actual = preflight_csv(csv_text(headers, rows, delimiter))
                control = preflight_csv(csv_text([h.replace('sale_price', 'unit_cost') for h in headers], rows, delimiter))
                self.assertEqual([i['sku'] for i in actual['items']], ['B'])
                reason = actual['import_report']['rows_set_aside'][0]['reason']
                self.assertEqual(reason.replace('sale_price', 'unit_cost'), control['import_report']['rows_set_aside'][0]['reason'])
        headers = ['SKU', 'Name', 'On hand', 'Unit cost', 'Price', *MONTHS]
        report = self.smart_parity([dict(name='Stock', rows=[headers,
            ['A', 'Widget', '10', '2,50', '2,50', '1', '2', '3']])])
        values = dict(zip(*report['canonical_rows'][:2]))
        self.assertEqual(values.get('sale_price'), values['unit_cost'])
        self.assertEqual(values['sale_price'], 'ambiguous number format')
        with self.assertRaises(SourceError):
            preflight_csv(csv_text(report['canonical_rows'][0], report['canonical_rows'][1:]))

    def test_canonical_price_wins_aliases(self):
        headers = ['SKU', 'Name', 'On hand', 'price', 'sale_price', 'list price', *MONTHS]
        rows = [['A', 'Widget', '10', '1', '2', '3', '1', '2', '3']]
        self.assertEqual(preflight_csv(csv_text(headers, rows))['items'][0].get('sale_price'), 2)
        report = self.smart_parity([dict(name='Stock', rows=[headers, *rows], delimiter=',')])
        self.assertEqual(dict(zip(*report['canonical_rows'][:2])).get('sale_price'), '2')

    def test_real_xlsx_numeric_price_and_blank_cell_survive_import(self):
        headers = ['SKU', 'Name', 'On hand', 'Sales Price', *MONTHS]
        rows = [headers, ['A', 'Widget', '10', '12.5', '1', '2', '3'],
                ['B', 'Unpriced', '10', '', '1', '2', '3']]
        xml_rows = []
        for number, row in enumerate(rows, 1):
            cells = []
            for col, value in enumerate(row):
                ref = f'{chr(65 + col)}{number}'
                cells.append(f'<c r="{ref}"><v>{value}</v></c>' if number > 1 and col >= 2 else
                             f'<c r="{ref}" t="inlineStr"><is><t>{value}</t></is></c>')
            xml_rows.append(f'<row r="{number}">{"".join(cells)}</row>')
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch') as directory:
            path = Path(directory) / 'prices.xlsx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('xl/workbook.xml', '<workbook xmlns:r="urn:relationships"><sheets><sheet name="Stock" r:id="r1"/></sheets></workbook>')
                archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
                archive.writestr('xl/worksheets/sheet1.xml', '<worksheet><sheetData>' + ''.join(xml_rows) + '</sheetData></worksheet>')
            report = self.smart_parity(read_workbook(path))
            data = preflight_csv(csv_text(report['canonical_rows'][0], report['canonical_rows'][1:]))
        self.assertEqual(data['items'][0].get('sale_price'), 12.5)
        self.assertNotIn('sale_price', data['items'][1])

    def test_pending_desktop_sync_produces_exact_preflight_parity_without_writing_plugin(self):
        source = (ROOT / 'desktop/plugin.js').read_text()
        generated = sync_module().synchronized_source(source)
        self.assertEqual(sync_module().synchronized_source(generated), generated)
        self.assertEqual((ROOT / 'desktop/plugin.js').read_text(), source)
        texts = []
        for alias in ALIASES:
            for delimiter, raw in [(',', '$ 1,234.50'), (';', '€ 2,50'), (';', '€ 1,234')]:
                headers = ['SKU', 'Name', 'On hand', alias, *MONTHS]
                texts.append(csv_text(headers, [['A', 'Widget', '10', raw, '1', '2', '3'],
                    ['B', 'Unpriced', '10', '', '1', '2', '3']], delimiter))
        script = """const fs=require('node:fs'),vm=require('node:vm'),p=JSON.parse(fs.readFileSync(0,'utf8'));
const c=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa});
vm.runInContext(p.source.slice(p.source.indexOf('const SAMPLE ='),p.source.indexOf('const pageStyle =')).replaceAll('export ','')+'\\nglobalThis.parse=parseCsv',c);
console.log(JSON.stringify(p.texts.map(text=>c.parse(text))));"""
        run = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(dict(source=generated, texts=texts)),
                             text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(run.stdout), [preflight_csv(text) for text in texts])


if __name__ == '__main__':
    unittest.main()
