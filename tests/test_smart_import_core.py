"""Dependency-free synthetic smart-import contract and cross-runtime tests.
Run: TMPDIR=$PWD/.scratch /usr/bin/python3 -m unittest discover -s tests -p test_smart_import_core.py
"""
import importlib
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


class SmartImportCoreTests(unittest.TestCase):
    def setUp(self):
        self.core = importlib.import_module('stock_runway.smart_import')

    def parity(self, sheets, sheet=None, overrides=None):
        from stock_runway.sources import ERP_ALIASES
        from stock_runway.csv_import import PRODUCT_TYPE_ALIASES
        vocabulary=json.loads((ROOT/'smart-import-vocabulary.json').read_text())
        aliases={field:[*labels,*vocabulary.get(field,[])] for field,labels in ERP_ALIASES.items()}
        payload = dict(sheets=sheets, sheet=sheet, overrides=overrides,
                       aliases=aliases, productTypeAliases=PRODUCT_TYPE_ALIASES)
        script = """import fs from 'node:fs';
const code = fs.readFileSync('desktop/smart-import.js','utf8');
const core = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const p = JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(core.understandWorkbook(p.sheets,p.sheet,p.overrides,p.aliases,p.productTypeAliases)));
"""
        run = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(payload),
                             text=True, capture_output=True, cwd=ROOT, check=True)
        actual = self.core.understand_workbook(sheets, sheet, overrides)
        self.assertEqual(actual, json.loads(run.stdout))
        return actual

    def test_duplicate_rows_only_combine_distinct_locations_in_same_unit(self):
        header=['SKU','Name','Unit','On hand','2026-01','Warehouse']
        for suffix, stock, sales, warning in [
            (['A','Widget','pcs','7','3',''], '17','5','Unspecified'),
            (['A','Widget','pcs','7','3','north'], '10','2','same warehouse/location'),
            (['A','Widget','boxes','7','3','South'], '10','2','conflicting stock units'),
            (['A','Widget','pcs','7','3','South'], '17','5','combined')]:
            with self.subTest(suffix=suffix):
                first=['A','Widget','pcs','10','2','North' if suffix[-1] else '']
                report=self.parity([dict(name='Stock',rows=[header,first,suffix])])
                self.assertEqual(report['canonical_rows'][1][3],stock)
                self.assertEqual(report['canonical_rows'][1][-1],sales)
                self.assertIn(warning,' '.join(report['warnings']))
                if warning not in ('combined','Unspecified'):self.assertIn('row omitted',' '.join(report['warnings']))

    def test_inactive_and_summary_rows_omitted_before_aggregation(self):
        for field, values in [('Active',['false','0','no']),('Inactive',['true','1','yes'])]:
            rows=[['SKU','Name','On hand',field],['A','Total Cleaner','5','']]
            rows += [['A','Widget','99',v] for v in values]
            rows += [['Cat A Total','','100',''],['B','Category Subtotal','100','']]
            report=self.parity([dict(name='Stock',rows=rows)])
            self.assertEqual(report['canonical_rows'][1][:4],['A','Total Cleaner','units','5'])
            self.assertEqual(len(report['canonical_rows']),2)
            self.assertIn('inactive',' '.join(report['warnings']))

    def test_warehouse_identity_matches_existing_casefold_safety(self):
        for first,repeat in [('North',' north '),('Straße','STRASSE'),('ΟΣ','ος')]:
            report=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','Warehouse'],
                ['A','Widget','5',first],['A','Widget','9',repeat]])])
            self.assertEqual(report['canonical_rows'][1][3],'5')
            self.assertIn('same warehouse/location',' '.join(report['warnings']))
        report=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand'],
            ['A','Widget','5'],['A','Widget','9']])])
        self.assertEqual(report['canonical_rows'][1][3],'5')
        self.assertIn('without warehouse/location',' '.join(report['warnings']))

    def test_warehouse_aggregation_does_not_hide_negative_counts_or_returns(self):
        report=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','On order','2026-01','Warehouse'],
            ['A','Widget','10','0','3','North'],['A','Widget','-2','0','8','Bad count'],
            ['A','Widget','5','-1','9','Bad incoming'],['A','Widget','7','2','-2','South']])])
        self.assertEqual(report['canonical_rows'][1][3:7],['17','','2','3'])
        self.assertIn('negative on_hand',' '.join(report['warnings']))
        self.assertIn('negative on_order',' '.join(report['warnings']))
        self.assertIn('before warehouse aggregation',' '.join(report['warnings']))

    def test_warehouse_missing_count_is_not_silently_zero(self):
        report=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','Warehouse'],
            ['A','Widget','','North'],['A','Widget','5','South']])])
        self.assertIn('On-hand stock',report['missing'])
        self.assertEqual(report['canonical_rows'][1][3],'')
        self.assertIn('missing on-hand stock for warehouse row',' '.join(report['warnings']))

    def test_sheet_number_conventions_and_ambiguous_xlsx_text(self):
        for delimiter, stock, quantity, expected in [(';','1,234','2,5',('1.234','2.5')),
                (';','1.234,50','2,5',('1234.50','2.5')),(',', '1,234','2.5',('1234','2.5')),
                (None,'1,234','2',('ambiguous number format','2'))]:
            report=self.parity([dict(name='Stock',delimiter=delimiter,rows=[
                ['SKU','Name','On hand','2026-01'],['A','Widget',stock,quantity]])])
            self.assertEqual(tuple(report['canonical_rows'][1][i] for i in (3,5)),expected)
        report=self.parity([dict(name='Stock',delimiter=';',rows=[
            ['SKU','Name','On hand','Lead time','Unit cost','MOQ','Pack size','2026-01'],
            ['A','Widget','1.234,50','2 weeks','€ 2,50','4,5','1,5','(2,5)']])])
        values=dict(zip(report['canonical_rows'][0],report['canonical_rows'][1]))
        self.assertEqual({f:float(values[f]) for f in ('supplier_days','unit_cost','minimum_order','pack_size')},
                         dict(supplier_days=14,unit_cost=2.5,minimum_order=4.5,pack_size=1.5))
        self.assertEqual(values['2026-01'],'0')  # Existing preflight returns policy.

    def test_unknown_excel_locale_never_reinterprets_typed_dot_values(self):
        report=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','2026-01'],
            ['A','Widget','1.234','2,5'],['B','Widget','1,234','2']])])
        self.assertEqual(report['canonical_rows'][1][3],'1.234')
        self.assertEqual(report['canonical_rows'][1][-1],'ambiguous number format')
        self.assertEqual(report['canonical_rows'][2][3],'ambiguous number format')

    def test_numeric_locale_currency_grouping_and_mixed_style_parity(self):
        for delimiter,stock,sales,expected_stock,expected_sales in [
            (';','1,234','2.5','ambiguous number format','ambiguous number format'),
            (';','1.234','2','ambiguous number format','2'),
            (';','€ 1\u202f234,50','2,5','1234.50','2.5'),
            (',','12,34,567','2','1234567','2'),
            (',','1,234.50','2','1234.50','2')]:
            with self.subTest(stock=stock,sales=sales):
                report=self.parity([dict(name='Stock',delimiter=delimiter,rows=[
                    ['SKU','Name','On hand','2026-01'],['A','Widget',stock,sales]])])
                self.assertEqual(report['canonical_rows'][1][3],expected_stock)
                self.assertEqual(report['canonical_rows'][1][-1],expected_sales)

    def test_csv_delimiter_metadata_reaches_number_understanding(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'decimal.csv'
            path.write_text('SKU;Name;On hand;2026-01\n001;Widget;1,234;2,5\n')
            sheets=self.core.read_workbook(path)
            self.assertEqual(sheets,self.js_read(path))
            self.assertEqual(sheets[0]['delimiter'],';')
            report=self.parity(sheets)
            self.assertEqual(report['canonical_rows'][1][3:6],['1.234','','2.5'])

    def test_equivalent_or_extreme_ledger_balances_are_bounded(self):
        for left,right,expected in [('20','20.0','20'),('-0','0.0','-0'),
                ('1e'+'9'*100,'1','differing on-hand balances; use stock snapshot')]:
            report=self.parity([dict(name='Ledger',rows=[['SKU','Name','Date','Quantity','On hand'],
                ['A','Widget','2026-01-01','1',left],['A','Widget','2026-01-02','2',right]])])
            self.assertEqual(report['canonical_rows'][1][3],expected)

    def test_mixed_numeric_style_includes_lead_time_units(self):
        report=self.parity([dict(name='Stock',delimiter=';',rows=[['SKU','Name','On hand','Lead time'],
            ['A','Widget','1,234','2.5 weeks']])])
        self.assertEqual(report['canonical_rows'][1][3],'ambiguous number format')

    def test_auxiliary_unit_conflict_does_not_mix_sales(self):
        report=self.parity([
            dict(name='Stock',rows=[['SKU','Name','Unit','On hand'],['A','Widget','pcs','10']]),
            dict(name='Sales',rows=[['SKU','Unit','Date','Quantity'],['A','box','2026-01-01','20']])])
        self.assertIn('Sales history for 1 products (exact SKU match required)',report['missing'])
        self.assertEqual(report['canonical_rows'][1][:4],['A','Widget','pcs','10'])
        self.assertIn('auxiliary row omitted',' '.join(report['warnings']))

    def test_partial_sales_join_blocks_missing_history_and_required_values(self):
        sheets=[dict(name='Stock',rows=[['SKU','Name','On hand'],['00042','Widget','5'],['B','','']]),
                dict(name='Sales',rows=[['SKU','Date','Quantity','Name','On hand'],
                    ['42','2026-01-01','4','Unrelated','99'],['B','2026-01-01','2','','']])]
        report=self.parity(sheets,sheet='Stock')
        self.assertIn('Product name',report['missing'])
        self.assertIn('On-hand stock',report['missing'])
        self.assertIn('Sales history for 1 products (exact SKU match required)',report['missing'])
        self.assertEqual(len(report['canonical_rows']),3)
        self.assertIn('not imported',' '.join(report['warnings']))
        self.assertEqual(report['canonical_rows'][1][-1],'')

    def test_differing_running_balance_is_not_a_stock_snapshot(self):
        report=self.parity([dict(name='Ledger',rows=[['SKU','Name','Date','Quantity','Balance'],
            ['A','Widget','2026-01-01','2','20'],['A','Widget','2026-01-02','3','18']])])
        self.assertEqual(report['canonical_rows'][1][3],'differing on-hand balances; use stock snapshot')
        self.assertIn('On-hand stock',report['missing'])

    def test_optional_cost_order_fields_and_duplicate_month_warning(self):
        report=self.parity([dict(name='Stock',rows=[
            ['SKU','Name','On hand','Unit cost','MOQ','Pack size','Expected','Jan 2026','2026-01'],
            ['A','Widget','4','2.5','3','6','2026-02-01','2','3']])])
        values=dict(zip(report['canonical_rows'][0],report['canonical_rows'][1]))
        self.assertEqual({f:values[f] for f in ('unit_cost','minimum_order','pack_size')},
                         dict(unit_cost='2.5',minimum_order='3',pack_size='6'))
        self.assertNotIn('on_order',values)
        self.assertEqual(values['2026-01'],'5')
        self.assertIn('duplicate month',' '.join(report['warnings']))
        self.assertIn('no incoming stock counted',' '.join(report['warnings']))

    def test_messy_wide_headers_and_totals(self):
        report = self.parity([dict(name='Stock', rows=[['Inventory export'], [],
            ['Item Code','Item Name','Stock on hand (pcs)','Jan 2026','Feb 2026','Mar 2026'],
            ['001','Widget','12','2','3','4'],['Total','','12','2','3','4']])])
        self.assertEqual(report['header_row'], 3)
        self.assertEqual(report['layout'], 'wide')
        self.assertEqual(report['missing'], [])
        self.assertEqual(report['canonical_rows'][1], ['001','Widget','units','12','','2','3','4'])

    def test_join_long_sales_to_stock_without_repeating_stock(self):
        sheets = [dict(name='Sales', rows=[['SKU','Date','Quantity'],
            ['A','2026-01-04','2'],['A','2026-01-07','3'],['A','2026-02-07','4'],['Z','2026-02-07','9']]),
            dict(name='Stock',rows=[['SKU','Name','On hand'],['A','Widget','20']])]
        report = self.parity(sheets)
        self.assertEqual(report['sheet_used'], 'Stock')
        self.assertEqual(report['canonical_rows'][1], ['A','Widget','units','20','','5','4'])
        self.assertEqual(report['match_report'], {'matched':1,'unmatched':1})
        self.assertTrue(report['warnings'])

    def test_overrides_and_yearless_months_are_deterministic(self):
        sheets = [dict(name='عربي',rows=[['Code X','Name','On hand','Jan','Feb','Mar'],['A','Thing','4','1','2','3']])]
        report = self.parity(sheets, overrides={'عربي:0':'sku'})
        self.assertEqual(report['canonical_rows'][0][-3:], ['2000-01','2000-02','2000-03'])
        self.assertIn('2000', ' '.join(report['warnings']))
        ignored = self.parity(sheets, overrides={'عربي:0':''})
        self.assertIn('Product code (SKU)', ignored['missing'])

    def test_numeric_identifiers_are_not_dates_and_missing_facts_not_fabricated(self):
        report = self.parity([dict(name='Products',rows=[['Barcode','Description','2026-01'],['001234','Widget','2']])])
        self.assertEqual(report['layout'], 'wide')
        self.assertIn('On-hand stock', report['missing'])
        self.assertEqual(report['canonical_rows'][1][3], '')

    def test_xlsx_reader_sparse_inline_shared_dates_and_csv(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path = Path(directory)/'sample.xlsx'
            make_xlsx(path)
            sheets = self.core.read_workbook(path)
            self.assertEqual(sheets, [dict(name='Stock & Sales',rows=[['SKU','','Date','Name'],['00012','','2026-01-01','Widget & part']])])
            self.assertEqual(sheets, self.js_read(path))
            csv_path = Path(directory)/'sample.csv'
            csv_path.write_text('\ufeffSKU;Name;On hand\n001;"Part; one";12\n', encoding='utf-8')
            self.assertEqual(self.core.read_workbook(csv_path),self.js_read(csv_path))

    def js_read(self, path):
        script = """import fs from 'node:fs';
const core = await import('data:text/javascript;base64,'+fs.readFileSync('desktop/smart-import.js').toString('base64'));
console.log(JSON.stringify(await core.readWorkbook(fs.readFileSync(process.argv[1]),process.argv[1])));
"""
        run = subprocess.run(['node','--input-type=module','-e',script,str(path)], text=True,
                             capture_output=True, cwd=ROOT, check=True)
        return json.loads(run.stdout)

    def test_month_only_custom_date_style_is_not_a_quantity(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'month-style.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
            parts['xl/styles.xml']=parts['xl/styles.xml'].replace(b'<xf numFmtId="14"/>',b'<xf numFmtId="165"/>').replace(b'</numFmts>',b'<numFmt numFmtId="165" formatCode="mmm"/></numFmts>')
            with zipfile.ZipFile(path,'w') as z:
                for name,value in parts.items():z.writestr(name,value)
            sheets=self.core.read_workbook(path)
            self.assertEqual(sheets,self.js_read(path))
            self.assertEqual(sheets[0]['rows'][1][2],'2026-01-01')

    def test_excel_percent_styles_scale_only_demand_change(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'percent.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
            for fmt_id in ('9','10'):
                for field in ('demand_change_pct','2026-01'):
                    with self.subTest(fmt_id=fmt_id,field=field):
                        styles=b'<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="'+fmt_id.encode()+b'"/></cellXfs></styleSheet>'
                        sheet=('<worksheet><sheetData><row>'+''.join('<c t="inlineStr"><is><t>'+h+'</t></is></c>' for h in ['SKU','Name','On hand',field])+ '</row><row><c t="inlineStr"><is><t>A</t></is></c><c t="inlineStr"><is><t>Widget</t></is></c><c><v>10</v></c><c s="1"><v>0.125</v></c></row></sheetData></worksheet>').encode()
                        with zipfile.ZipFile(path,'w') as z:
                            for name,original in parts.items():z.writestr(name,styles if name=='xl/styles.xml' else sheet if name=='xl/worksheets/sheet1.xml' else original)
                        sheets=self.core.read_workbook(path)
                        self.assertEqual(sheets,self.js_read(path))
                        self.assertEqual(sheets[0]['percent_cells'],[[1,3]])
                        report=self.parity(sheets)
                        self.assertEqual(report['canonical_rows'][1][-1], '12.5' if field=='demand_change_pct' else 'percentage-formatted quantity; use stock units')

    def test_exact_decimal_aggregation_handles_negative_zero(self):
        report=self.parity([dict(name='Stock',rows=[['SKU','Name','On hand','2026-01','Warehouse'],
            ['A','Widget','-0','-0.0','North'],['A','Widget','-0','-0.00','South']])])
        self.assertEqual(report['canonical_rows'][1][3],'0')
        self.assertEqual(report['canonical_rows'][1][-1],'0')

    def test_xml_quoted_greater_than_and_custom_dates(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'custom.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
            parts['xl/styles.xml']=parts['xl/styles.xml'].replace(b'formatCode="00000"',b'formatCode="[>0]00000"')
            with zipfile.ZipFile(path,'w') as z:
                for name,value in parts.items():z.writestr(name,value)
            self.assertEqual(self.core.read_workbook(path),self.js_read(path))

    def test_fixture_reader_matrix_and_report_parity(self):
        root=ROOT/'tests/fixtures/smart-import'
        if not (root/'manifest.json').exists():self.skipTest('Synthetic fixture worker matrix not present')
        manifest=json.loads((root/'manifest.json').read_text())
        self.assertEqual(len(manifest['fixtures']),manifest['fixture_count'])
        for fixture in manifest['fixtures']:
            with self.subTest(fixture=fixture['filename']):
                path=root/fixture['filename'];sheets=self.core.read_workbook(path)
                self.assertEqual(sheets,self.js_read(path))
                report=self.parity(sheets)
                expected=json.loads((root/fixture['expected_file']).read_text())
                scenario=expected['expected_scenario']
                if scenario is None:
                    self.assertIn('Product code (SKU)',report['missing']);continue
                self.assertEqual(report['missing'],[])
                header=report['canonical_rows'][0]
                actual={r[0]:dict(zip(header,r)) for r in report['canonical_rows'][1:]}
                items=scenario['items']
                if fixture['filename']=='stored_mixed_cells.xlsx':
                    # Original reader fixture includes an explicit FALSE Active
                    # cell for B-002; the safety contract must exclude it.
                    self.assertNotIn('B-002',actual)
                    self.assertIn('inactive in ERP',' '.join(report['warnings']))
                self.assertEqual(len(actual),len(items))
                for item in items:
                    row=actual[item['sku']]
                    for field in ('name','unit','supplier'):
                        if field in item:self.assertEqual(row[field],item[field])
                    for field in ('on_hand','supplier_days'):
                        if field in item:self.assertEqual(float(row[field]),item[field])
                    self.assertEqual([float(row[m]) for m in scenario['months']],item['monthly_sales'])

    def test_zip_and_sparse_limits_are_enforced_in_both_readers(self):
        import struct
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            original=Path(directory)/'original.xlsx';make_xlsx(original)
            source=original.read_bytes();central=source.index(b'PK\x01\x02')
            for kind in ('expanded','encrypted','checksum','columns','cells'):
                path=Path(directory)/(kind+'.xlsx')
                if kind in ('expanded','encrypted','checksum'):
                    raw=bytearray(source)
                    if kind=='expanded':struct.pack_into('<I',raw,central+24,80*1024*1024+1)
                    elif kind=='encrypted':struct.pack_into('<H',raw,central+8,1)
                    else:struct.pack_into('<I',raw,central+16,123)
                    path.write_bytes(raw)
                else:
                    with zipfile.ZipFile(original) as z:parts={n:z.read(n) for n in z.namelist()}
                    col='XFE' if kind=='columns' else 'XFD'
                    count=1 if kind=='columns' else 123
                    parts['xl/worksheets/sheet1.xml']=('<worksheet><sheetData>'+''.join('<row r="'+str(i)+'"><c r="'+col+str(i)+'"><v>1</v></c></row>' for i in range(1,count+1))+'</sheetData></worksheet>').encode()
                    with zipfile.ZipFile(path,'w') as z:
                        for name,value in parts.items():z.writestr(name,value)
                with self.subTest(kind=kind):
                    with self.assertRaises(ValueError):self.core.read_workbook(path)
                    with self.assertRaises(subprocess.CalledProcessError):self.js_read(path)

    def test_acronym_from_existing_alias_is_a_reviewable_suggestion(self):
        report=self.parity([dict(name='Stock',rows=[['SKU','Name','QOH'],['A','Widget','12']])])
        self.assertEqual(report['missing'],[])
        self.assertEqual(report['mapping'][2]['confidence'],'low')
        self.assertEqual(report['canonical_rows'][1][3],'12')

    def test_location_codes_are_not_guessed_as_product_identifiers(self):
        report=self.parity([dict(name='Notes',rows=[['Warehouse','Bin','Qty On Hand'],['North','N1','12'],['South','S2','8']])])
        self.assertIn('Product code (SKU)',report['missing'])
        self.assertEqual(len(report['canonical_rows']),1)

    def test_metadata_is_not_normalized_as_quantity(self):
        report=self.parity([dict(name='Stock',delimiter=',',rows=[['SKU','Name','On hand'],['001','1,234','1,234']])])
        self.assertEqual(report['canonical_rows'][1][:4],['001','1,234','units','1234'])

    def test_netsuite_name_identifier_fallback(self):
        report=self.parity([dict(name='Stock',rows=[['Name','Display Name','On hand'],['A01','Widget','4']])])
        self.assertEqual(report['missing'],[])
        self.assertEqual(report['canonical_rows'][1][:2],['A01','Widget'])

    def test_sniffed_or_overridden_date_makes_quantity_transactional(self):
        for overrides in (None,{'Sales:1':'date'}):
            report=self.parity([dict(name='Sales',rows=[['SKU','When','Quantity'],['A','2026-01-01','0.1'],['A','2026-01-02','0.2']])],overrides=overrides)
            self.assertEqual(report['layout'],'long')
            self.assertEqual(report['canonical_rows'][1][-1],'0.3')
            self.assertIn('On-hand stock',report['missing'])

    def test_repeated_long_stock_and_decimal_aggregation(self):
        report=self.parity([dict(name='Sales',rows=[['SKU','Name','Date','Quantity','On hand'],
            ['A','Widget','2026-01-01','0.1','20'],['A','Widget','2026-01-02','0.2','20']])])
        self.assertEqual(report['canonical_rows'][1],['A','Widget','units','20','','0.3'])

    def test_utf16_and_store_xlsx_1904_reader_parity(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'store.xlsx';make_xlsx(path,zipfile.ZIP_STORED,True)
            self.assertEqual(self.core.read_workbook(path),self.js_read(path))
            self.assertEqual(self.core.read_workbook(path)[0]['rows'][1][2],'2026-01-01')
            path=Path(directory)/'unicode.csv';path.write_bytes('SKU,Name\n001,قطعة\n'.encode('utf-16'))
            self.assertEqual(self.core.read_workbook(path),self.js_read(path))

    def test_rejects_xml_entities_and_sparse_allocation_bombs(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            for attack in ('<!DOCTYPE workbook [<!ENTITY a "payload">]><workbook>&a;</workbook>',
                           '<worksheet><sheetData><row r="200001"/></sheetData></worksheet>'):
                path=Path(directory)/'attack.xlsx';make_xlsx(path)
                with zipfile.ZipFile(path) as z: parts={n:z.read(n) for n in z.namelist()}
                if attack.startswith('<!'): parts['xl/workbook.xml']=attack.encode('utf-16')
                else: parts['xl/worksheets/sheet1.xml']=attack.encode()
                with zipfile.ZipFile(path,'w') as z:
                    for name,value in parts.items():z.writestr(name,value)
                with self.assertRaises(ValueError):self.core.read_workbook(path)
                with self.assertRaises(subprocess.CalledProcessError):self.js_read(path)

    def test_rejects_legacy_workbooks_and_oversized_input(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'old.xls'; path.write_bytes(b'legacy')
            with self.assertRaisesRegex(ValueError,'Save as .xlsx or CSV'):
                self.core.read_workbook(path)
            path=Path(directory)/'huge.csv'
            with path.open('wb') as f: f.truncate(20*1024*1024+1)
            with self.assertRaisesRegex(ValueError,'20 MiB'):
                self.core.read_workbook(path)


    def assert_reader_error(self, path, message):
        with self.assertRaises(ValueError) as error:self.core.read_workbook(path)
        self.assertEqual(str(error.exception),message)
        script="""import fs from 'node:fs';
const core=await import('data:text/javascript;base64,'+fs.readFileSync('desktop/smart-import.js').toString('base64'));
try{await core.readWorkbook(fs.readFileSync(process.argv[1]),process.argv[1]);console.log(JSON.stringify({ok:true}));}
catch(e){console.log(JSON.stringify({error:e.message}));}
"""
        run=subprocess.run(['node','--input-type=module','-e',script,str(path)],text=True,capture_output=True,cwd=ROOT,check=True)
        self.assertEqual(json.loads(run.stdout),{'error':message})

    def test_xml_element_and_shared_string_bombs_fail_before_tree_allocation(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'bomb.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
            for label,part,value in [
                ('three-million-shared','xl/sharedStrings.xml',b'<sst>'+b'<si/>'*3000000+b'</sst>'),
                ('shared-limit','xl/sharedStrings.xml',b'<sst>'+b'<si/>'*200001+b'</sst>'),
                ('element-limit','xl/worksheets/sheet1.xml',b'<worksheet>'+b'<a/>'*500000+b'</worksheet>')]:
                with self.subTest(label=label):
                    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
                        for name,original in parts.items():z.writestr(name,value if name==part else original)
                    self.assert_reader_error(path,self.core.XML_BOUNDS_ERROR)

    def test_malformed_numeric_attributes_have_identical_friendly_errors(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'bad.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
            for part,old,new,message in [
                ('xl/worksheets/sheet1.xml',b'<row r="1">',b'<row r="oops">','Invalid numeric attribute in workbook.'),
                ('xl/worksheets/sheet1.xml',b's="2"',b's="oops"','Invalid numeric attribute in workbook.'),
                ('xl/styles.xml',b'numFmtId="164"',b'numFmtId="oops"','Invalid numeric attribute in workbook.'),
                ('xl/worksheets/sheet1.xml',b't="s"><v>0',b't="s"><v>oops','Invalid shared-string index in workbook.'),
                ('xl/worksheets/sheet1.xml',b'<v>46023</v>',b'<v>oops</v>','Invalid Excel date value.')]:
                with self.subTest(part=part,old=old):
                    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
                        for name,original in parts.items():z.writestr(name,original.replace(old,new) if name==part else original)
                    self.assert_reader_error(path,message)

    def test_xml_depth_counts_self_closing_nodes(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.scratch') as directory:
            path=Path(directory)/'depth.xlsx';make_xlsx(path)
            with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
            with zipfile.ZipFile(path,'w') as z:
                for name,value in parts.items():
                    z.writestr(name,b'<a>'*255+b'<b/>'+b'</a>'*255 if name=='xl/worksheets/sheet1.xml' else value)
            self.assert_reader_error(path,'Workbook XML nesting is too deep.')


def make_xlsx(path, compression=zipfile.ZIP_DEFLATED, date1904=False):
    ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    with zipfile.ZipFile(path,'w',compression=compression) as z:
        z.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="{rel}"><workbookPr date1904="{int(date1904)}"/><sheets><sheet name="Stock &amp; Sales" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+rel+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/sharedStrings.xml', f'<sst xmlns="{ns}"><si><r><t>Widget</t></r><r><t> &amp; part</t></r></si></sst>')
        z.writestr('xl/styles.xml',f'<styleSheet xmlns="{ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>')
        z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SKU</t></is></c><c r="C1" t="inlineStr"><is><t>Date</t></is></c><c r="D1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" s="2"><v>12</v></c><c r="C2" s="1"><v>{44561 if date1904 else 46023}</v></c><c r="D2" t="s"><v>0</v></c></row></sheetData></worksheet>')


if __name__ == '__main__':
    unittest.main()
