"""Failing-first import review regressions with complete Python/JS report parity."""
import importlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import test_smart_import_core as core_tests
ROOT = core_tests.ROOT


class ImportSafetyWorkbookTests(unittest.TestCase):
    parity = core_tests.SmartImportCoreTests.parity
    js_read = core_tests.SmartImportCoreTests.js_read

    def setUp(self):
        self.core = importlib.import_module('stock_runway.smart_import')
        (ROOT / '.scratch').mkdir(exist_ok=True)

    def test_ambiguous_transaction_dates_require_ack(self):
        for dates in [('01/02/2026','02/03/2026','03/04/2026'),
                      ('01.02.2026','02.03.2026','03.04.2026'),
                      ('01/02/2026','02.03.2026','03/04/2026'),
                      ('01/02.2026','02/03.2026','03/04.2026')]:
            with self.subTest(dates=dates):
                result=self.parity([dict(name='Sales',rows=[['SKU','Name','On hand','Date','Quantity'],
                    *[['A','Widget','100',d,'150'] for d in dates]])])
                self.assertTrue(result['review_report']['requires_ack'])
                self.assertIn('ambiguous transaction date',' '.join(result['review_report']['reasons']))

    def test_column_evidence_and_iso_dates_remain_unambiguous(self):
        for dates,months in [
            (['01/13/2026','02/03/2026','03/04/2026'],['2026-01','2026-02','2026-03']),
            (['13.01.2026','03.02.2026','04.03.2026'],['2026-01','2026-02','2026-03']),
            (['2026-01-02','2026-02-03','2026-03-04'],['2026-01','2026-02','2026-03']),
            (['2026-01','2026-02','2026-03'],['2026-01','2026-02','2026-03'])]:
            result=self.parity([dict(name='Sales',rows=[['SKU','Name','On hand','Date','Quantity'],
                *[['A','Widget','100',d,'150'] for d in dates]])])
            self.assertFalse(result['review_report']['requires_ack'])
            self.assertEqual(result['canonical_rows'][0][-3:],months)

    def test_explicit_blank_lot_quantity_not_stock(self):
        for quantities in [('25',''),('','25'),('','')]:
            result=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','Lot','Expiry','Lot qty','2026-01'],
                ['A','Widget','100','L','2027-02-28',quantities[0],'150'],
                ['A','Widget','100','M','2027-02-28',quantities[1],'150']])])
            row=dict(zip(*result['canonical_rows']))
            self.assertEqual(row['on_hand'],'100')
            self.assertTrue(result['review_report']['requires_ack'])
            lots=json.loads(row.get('lots','[]'))
            self.assertEqual(sum(lot['qty'] for lot in lots),25 if '25' in quantities else 0)
            self.assertIn('missing lot quantity',' '.join(result['review_report']['reasons']))

    def test_lot_total_mismatch_requires_ack(self):
        result=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','Lot','Expiry','Lot qty'],
            ['A','Widget','100','L','2027-02-28','25']])])
        self.assertTrue(result['review_report']['requires_ack'])
        self.assertIn('lot total',' '.join(result['review_report']['reasons']))

    def test_bad_lot_rows_set_aside_without_aborting_workbook(self):
        for qty,expiry in [('-1','2027-02-28'),('10','not-a-date'),('nan','2027-02-28')]:
            result=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','Lot','Expiry','Lot qty'],
                ['BAD','Bad','99','L',expiry,qty],['A','Widget','100','M','2027-02-28','100']])])
            self.assertEqual([r[0] for r in result['canonical_rows'][1:]],['A'])
            aside=result['sheets'][0]['rows_set_aside']
            self.assertEqual(aside[0]['row'],2)
            self.assertTrue(aside[0]['reason'])
            self.assertEqual(aside[0]['values'][0],'BAD')

    def test_price_cannot_change_inventory_numeric_style(self):
        base=[['SKU','Name','On hand','2026-01','2026-02','2026-03'],['A','Widget','1.234','2','3','4']]
        plain=self.parity([dict(name='Stock',delimiter=';',rows=base)])
        priced=self.parity([dict(name='Stock',delimiter=';',rows=[base[0]+['Sale price'],base[1]+['2,50']])])
        self.assertEqual(plain['canonical_rows'][1][3],priced['canonical_rows'][1][3])
        self.assertEqual(plain['canonical_rows'][1][-3:],priced['canonical_rows'][1][-3:])

    def test_1904_expiry_serial_without_style(self):
        import zipfile
        from test_smart_import_core import make_xlsx
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'epoch.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as archive: parts={n:archive.read(n) for n in archive.namelist()}
            parts['xl/workbook.xml']=b'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>'
            sheet=b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SKU</t></is></c><c r="B1" t="inlineStr"><is><t>Name</t></is></c><c r="C1" t="inlineStr"><is><t>On hand</t></is></c><c r="D1" t="inlineStr"><is><t>Expiry</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c><c r="B2" t="inlineStr"><is><t>Widget</t></is></c><c r="C2"><v>100</v></c><c r="D2"><v>46000</v></c></row></sheetData></worksheet>'
            target=next(n for n in parts if n.startswith('xl/worksheets/'))
            parts[target]=sheet
            with zipfile.ZipFile(path,'w') as archive:
                for n,v in parts.items():archive.writestr(n,v)
            sheets=self.core.read_workbook(path)
            self.assertEqual(sheets,self.js_read(path))
            self.assertEqual(sheets[0]['rows'][1][3],'2029-12-10')
            # Irrelevant notes and invalid lot rows must not abort the reader.
            # Leave out-of-range unstyled serials for row-level validation.
            for raw in [b'-3',b'2958466']:
                parts[target]=sheet.replace(b'<v>46000</v>',b'<v>'+raw+b'</v>')
                with zipfile.ZipFile(path,'w') as archive:
                    for n,v in parts.items():archive.writestr(n,v)
                invalid=self.core.read_workbook(path)
                self.assertEqual(invalid,self.js_read(path))
                self.assertEqual(invalid[0]['rows'][1][3],raw.decode())

    def test_direct_csv_lot_mismatch_requires_ack(self):
        from stock_runway.csv_import import preflight_csv
        from stock_runway.input_meaning import interpret_csv
        text='sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03,lot,expiry,lot_qty\nA,Widget,units,100,7,150,150,150,L,2027-02-28,25\n'
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'lot.csv';path.write_text(text)
            data=interpret_csv(path,preflight_csv(text),{},'2026-11-20')
        self.assertTrue(data['input_meaning']['requires_ack'])
        self.assertIn('lot total',' '.join(data['input_meaning']['reasons']))

    def test_cli_embedded_cr_roundtrip(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'cr.csv'
            path.write_bytes(b'sku,name,unit,on_hand,supplier_days,2026-01,2026-02,2026-03\r\nA,"Widget\rSpecial",units,100,7,150,150,150\r\n')
            run=subprocess.run(['/usr/bin/python3','stock_runway.py',str(path),'--today','2026-11-20','--all','--json'],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertIn('Widget\\rSpecial',run.stdout)
