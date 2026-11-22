"""IMPORT-01/04/06 regressions: local stdlib tests and exact Desktop parity."""
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('stock_runway')
pkg.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', pkg)
from stock_runway.csv_import import preflight_csv
from stock_runway.sources import SourceError, _parse_canonical_csv, load_csv

HEADERS = ['sku', 'name', 'unit', 'on_hand', 'supplier_days', '2026-08', '2026-09', '2026-10']
BASE = ['A', 'Widget', 'units', '100', '7', '150', '150', '150']


def text(headers, rows, delimiter=','):
    buffer = io.StringIO(newline='')
    csv.writer(buffer, delimiter=delimiter).writerows([headers, *rows])
    return buffer.getvalue()


class ImportSafetyCsvTests(unittest.TestCase):
    def test_34_historical_import_fingerprints_are_unchanged(self):
        import hashlib
        manifest=json.loads((ROOT/'tests/fixtures/import-safety-historical-fingerprints.json').read_text())
        self.assertEqual(manifest['baseline'],'1a7d3df')
        self.assertEqual(manifest['fixture_count'],34)
        self.assertEqual(len(manifest['unchanged']),34)
        for fixture in manifest['unchanged']:
            with self.subTest(file=fixture['file']):
                try:
                    data=load_csv(str(ROOT/fixture['file']))
                    facts=dict(months=data['months'],as_of=data['as_of'],items=data['items'])
                except SourceError as error:
                    facts=dict(error=str(error))
                digest=hashlib.sha256(json.dumps(facts,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                self.assertEqual(digest,fixture['sha256'])

    def parity(self, source, strict=False):
        script = """const fs=require('node:fs'),vm=require('node:vm'),p=JSON.parse(fs.readFileSync(0,'utf8'));
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa});
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\\nglobalThis.parse=parseCsv',ctx);
try{console.log(JSON.stringify({data:ctx.parse(p.text,{strict:p.strict})}))}catch(e){console.log(JSON.stringify({error:e.message,import_report:e.import_report}))}
"""
        run = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(dict(text=source, strict=strict)), text=True, capture_output=True, check=True)
        js = json.loads(run.stdout)
        try:
            data = preflight_csv(source, strict=strict)
        except SourceError as error:
            actual = dict(error=str(error))
            if hasattr(error, 'import_report'):
                actual['import_report'] = error.import_report
            self.assertEqual(actual, js)
            raise
        self.assertEqual(dict(data=data), js)
        return data

    def test_blank_lot_quantity_is_unknown_not_stock_in_both_row_orders(self):
        for quantities in [('25', ''), ('', '25'), ('', '')]:
            with self.subTest(quantities=quantities):
                rows = [[*BASE, lot, '2027-02-28', qty] for lot, qty in zip(['L', 'M'], quantities)]
                data = self.parity(text([*HEADERS, 'lot', 'expiry', 'lot_qty'], rows))
                item = data['items'][0]
                self.assertEqual(item['on_hand'], 100)
                self.assertEqual(item['monthly_sales'], [150, 150, 150])
                self.assertEqual(item.get('lots', []), [dict(lot=lot, expiry='2027-02-28', qty=25) for lot, qty in zip(['L', 'M'], quantities) if qty])
                self.assertEqual(data['import_report']['rows_imported'], 2)
                self.assertIn('lot stock unknown', ' '.join(item['expiry_warnings']))
                self.assertIn('lot stock unknown', ' '.join(data['import_report']['warnings']))

    def test_zero_lot_quantity_is_explicit_and_not_unknown(self):
        rows = [[*BASE, 'L', '2027-02-28', '25'], [*BASE, 'M', '2027-02-28', '0']]
        item = self.parity(text([*HEADERS, 'lot', 'expiry', 'lot_qty'], rows))['items'][0]
        self.assertEqual(item['on_hand'], 100)
        self.assertEqual([lot['qty'] for lot in item['lots']], [25, 0])
        self.assertNotIn('unknown', ' '.join(item['expiry_warnings']))

    def test_missing_lot_quantity_column_preserves_implicit_lot_stock(self):
        rows = [[*BASE, 'L', '2027-02-28'], [*BASE, 'M', '2027-02-28']]
        item = self.parity(text([*HEADERS, 'lot', 'expiry'], rows))['items'][0]
        self.assertEqual(item['on_hand'], 200)
        self.assertEqual([lot['qty'] for lot in item['lots']], [100, 100])
        self.assertEqual(item['monthly_sales'], [150, 150, 150])

    def test_unknown_lot_rows_keep_one_snapshot_per_warehouse(self):
        rows = [[*BASE, location, lot, '2027-02-28', qty] for location in ['North', 'South'] for lot, qty in [('L', ''), ('M', '25')]]
        item = self.parity(text([*HEADERS, 'Warehouse', 'lot', 'expiry', 'lot_qty'], rows))['items'][0]
        self.assertEqual(item['on_hand'], 200)
        self.assertEqual(item['monthly_sales'], [300, 300, 300])
        self.assertEqual(item['lots'], [dict(lot='M', expiry='2027-02-28', qty=50)])

    def test_quoted_embedded_cr_roundtrips_canonical_parser_and_csv_file(self):
        for value in ['Widget\rSpecial', 'Widget\r\nSpecial', 'Widget\nSpecial', 'Widget\r"Special"']:
            with self.subTest(value=value):
                row = [*BASE]
                row[1] = value
                source = text(HEADERS, [row])
                self.assertEqual(_parse_canonical_csv([HEADERS, row])['items'][0]['name'], value)
                for strict in [False, True]:
                    self.assertEqual(self.parity(source, strict=strict)['items'][0]['name'], value)
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / 'quoted.csv'
                    path.write_bytes(source.encode())
                    self.assertEqual(load_csv(str(path))['items'][0]['name'], value)

    def test_embedded_cr_in_all_text_fields_preserves_records_and_line_numbers(self):
        headers = [*HEADERS, 'category', 'supplier']
        row = ['A\r1', 'Widget\rSpecial', 'u\rnits', *BASE[3:], 'C\r1', 'S\r1']
        bad = ['B', 'Bad', 'units', 'bad', *BASE[4:], '', '']
        data = self.parity(text(headers, [row, bad]))
        self.assertEqual([data['items'][0][field] for field in ['sku', 'name', 'unit', 'category', 'supplier']], [row[0], row[1], row[2], row[-2], row[-1]])
        self.assertEqual(data['import_report']['rows_set_aside'][0]['row'], 8)

    def test_sale_price_cannot_resolve_ambiguous_quantities(self):
        for field in ['on_hand', 'supplier_days', '2026-08', 'on_order', 'unit_cost', 'lot_qty']:
            with self.subTest(field=field):
                headers = [*HEADERS]
                row = [*BASE]
                if field not in headers:
                    headers.append(field)
                    row.append('1.234')
                    if field == 'lot_qty':
                        headers += ['lot', 'expiry']
                        row += ['L', '2027-02-28']
                else:
                    row[headers.index(field)] = '1.234'
                for price in [None, '', '2,50']:
                    h, r = (headers, row) if price is None else ([*headers, 'sale_price'], [*row, price])
                    with self.assertRaisesRegex(SourceError, 'ambiguous number format'):
                        self.parity(text(h, [r], ';'))

    def test_sale_price_cannot_invalidate_or_change_legacy_dot_decimals(self):
        headers = [*HEADERS, 'unit_cost', 'on_order']
        row = [*BASE, '1.25', '0.5']
        row[3] = '1.5'
        control = self.parity(text(headers, [row], ';'))['items'][0]
        for price, expected in [('2,50', 2.5), ('', None)]:
            actual = self.parity(text([*headers, 'sale_price'], [[*row, price]], ';'))['items'][0]
            self.assertEqual(actual.pop('sale_price', None), expected)
            self.assertEqual(actual, control)

    def test_legacy_decimal_comma_evidence_still_resolves_grouped_stock(self):
        headers = [*HEADERS, 'unit_cost']
        row = [*BASE, '2,50']
        row[3] = '1.234'
        control = self.parity(text(headers, [row], ';'))['items'][0]
        self.assertEqual(control['on_hand'], 1234)
        actual = self.parity(text([*headers, 'sale_price'], [[*row, '3,50']], ';'))['items'][0]
        self.assertEqual(actual.pop('sale_price'), 3.5)
        self.assertEqual(actual, control)

    def test_price_only_decimal_comma_is_still_supported(self):
        data = self.parity(text([*HEADERS, 'sale_price'], [[*BASE, '€ 2,50']], ';'))
        self.assertEqual(data['items'][0]['sale_price'], 2.5)
        self.assertEqual(data['items'][0]['on_hand'], 100)


if __name__ == '__main__':
    unittest.main()
