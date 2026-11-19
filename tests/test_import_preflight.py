"""Synthetic ERP probes, exact Python/JS report parity, and unchanged valid items."""
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import types
import pytest
ROOT=Path(__file__).resolve().parents[1]
pkg=types.ModuleType('stock_runway');pkg.__path__=[str(ROOT)];sys.modules.setdefault('stock_runway',pkg)
from stock_runway.sources import load_csv, SourceError
from stock_runway.csv_import import preflight_csv
FIX=ROOT/'tests/fixtures/import-probes'


def test_all_probes_have_identical_js_data_reports_and_errors():
    paths=sorted(FIX.glob('*.csv'))
    assert len(paths)==30
    js=json.loads(subprocess.run(['node','tests/import-parity.cjs',*[str(p) for p in paths]],cwd=ROOT,capture_output=True,text=True,check=True).stdout)
    for path in paths:
        try: actual={'data':load_csv(str(path))}
        except SourceError as e:
            actual={'error':str(e)}
            if hasattr(e,'import_report'):actual['import_report']=e.import_report
        assert actual==js[str(path)],path.name


def test_valid_examples_unchanged_items():
    for path in sorted((ROOT/'docs/erp-examples').glob('*.csv'))+[ROOT/'samples/synthetic/stock.csv']:
        old=load_csv(str(path),strict=True)
        new=load_csv(str(path))
        assert new['items']==old['items'],path.name
        assert new['months']==old['months']
        assert new['as_of']==old['as_of']


def test_messy_preflight_and_warehouse_sum():
    data=preflight_csv('SKU,Name,Warehouse,On Hand,On Order,Jan 2026,Feb 2026,Mar 2026,Unused\nA,One,W1,5,2,1,-3,,x\nA,One,W2,7,3,4,5,6,y\nB,Bad,W1,-1,0,1,2,3,z\nTotal,,W1,11,5,6,7,8,\n,Blank,W1,10,0,1,2,3,\n')
    assert data['items']==[dict(sku='A',name='One',unit='units',on_hand=12,supplier_days=None,monthly_sales=[5,5,6],receipts={},on_order=5)]
    r=data['import_report'];assert r['rows_imported']==2 and r['products_ready']==1
    assert len(r['rows_set_aside'])==3 and r['ignored']==['Unused']
    assert [x['row'] for x in r['rows_set_aside']]==[4,5,6]
    assert 'returns exceeded sales in 2026-02 (1 rows)' in r['warnings']
    assert '1 blank sales cells treated as 0' in r['warnings']


def test_duplicate_without_location_and_atomic_aggregate_limits():
    data=preflight_csv('SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,One,5,1,2,3\nA,One,6,4,5,6\n')
    assert data['items'][0]['on_hand']==5
    assert data['import_report']['rows_set_aside'][0]['reason']=='duplicate sku without warehouse/location — first row kept'
    data=preflight_csv('SKU,Name,Warehouse,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,One,W1,1000000000000,1,2,3\nA,One,W2,1,4,5,6\n')
    assert data['items'][0]['on_hand']==1000000000000
    assert len(data['import_report']['rows_set_aside'])==1


def test_cli_report_stderr_and_strict(tmp_path):
    p=tmp_path/'messy.csv';p.write_text('SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\nA,One,5,1,2,3\nB,Bad,-1,1,2,3\n')
    normal=subprocess.run([sys.executable,'stock_runway.py',str(p),'--all','--today','2026-04-01'],cwd=ROOT,text=True,capture_output=True)
    assert normal.returncode==0,normal.stderr
    assert 'Import check:' in normal.stderr
    report=json.loads(normal.stderr.split('Import check: ',1)[1].splitlines()[0]);assert report['products_ready']==1 and len(report['rows_set_aside'])==1
    strict=subprocess.run([sys.executable,'stock_runway.py',str(p),'--strict'],cwd=ROOT,text=True,capture_output=True)
    assert strict.returncode==2 and 'non-negative' in strict.stderr


@pytest.mark.parametrize('delimiter,stock,sales,want', [
    (';', '1,500', '0,250', [1.5, .25]),
    (';', '1.200,50', '2.500,25', [1200.5, 2500.25]),
    ('\t', '$1,200.00', '1,20,000', [1200,120000]),
])
def test_additional_numeric_and_delimiter_parity(tmp_path,delimiter,stock,sales,want):
    p=tmp_path/'numeric.csv'
    with p.open('w',newline='') as f:
        writer=csv.writer(f,delimiter=delimiter);writer.writerows([['SKU','Name','On Hand','Jan 2026','Feb 2026','Mar 2026'],['A','Widget',stock,sales,'2','3']])
    data=load_csv(str(p));assert [data['items'][0]['on_hand'],data['items'][0]['monthly_sales'][0]]==want
    js=json.loads(subprocess.run(['node','tests/import-parity.cjs',str(p)],cwd=ROOT,capture_output=True,text=True,check=True).stdout)
    assert js[str(p)]=={'data':data}


@pytest.mark.parametrize('newline', ['\n','\r','\r\n'])
def test_physical_rows_and_invalid_ascii_numeric_parity(tmp_path,newline):
    p=tmp_path/'rows.csv';p.write_bytes(newline.join(['SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026','','A,Good,10,1,2,3','','B,Bad,٥,1,2,3','C,Good,20,1,2,3','']).encode())
    data=load_csv(str(p));assert data['import_report']['rows_set_aside'][0]['row']==5
    assert data['import_report']['rows_set_aside'][0]['reason']=='Row 5: on_hand must be a number.'
    js=json.loads(subprocess.run(['node','tests/import-parity.cjs',str(p)],cwd=ROOT,capture_output=True,text=True,check=True).stdout)
    assert js[str(p)]=={'data':data}


@pytest.mark.parametrize('alias', ['Product Category', 'Product Type', 'Type', 'Item Group',
                                  'Item Category', 'Product/Product Category', 'categ_id'])
@pytest.mark.parametrize('canonical_prefix', [False, True])
def test_product_type_aliases_preserve_metadata_and_strict_parity(tmp_path, alias, canonical_prefix):
    headers = ['sku', 'name', 'unit', 'on_hand', 'supplier_days'] if canonical_prefix else ['SKU', 'Product', 'UoM', 'On Hand', 'Lead Time']
    p = tmp_path / 'types.csv'
    with p.open('w', newline='') as handle:
        csv.writer(handle).writerows([headers + [alias, '2026-01', '2026-02', '2026-03'],
                                     ['A', 'Clear sealant', 'tubes', '12', '7', 'Sealants', '1', '2', '3']])
    data = load_csv(str(p))
    assert data['items'][0]['category'] == 'Sealants'
    assert data['items'][0]['name'] == 'Clear sealant'  # Product is still name, not type.
    assert {'source': alias, 'field': 'category'} in data['import_report']['matched']
    assert alias not in data['import_report']['ignored']
    assert load_csv(str(p), strict=True)['items'] == data['items']
    js = json.loads(subprocess.run(['node', 'tests/import-parity.cjs', str(p)], cwd=ROOT,
                                  capture_output=True, text=True, check=True).stdout)
    assert js[str(p)] == {'data': data}
    script = """const fs=require('node:fs'),vm=require('node:vm');const s=fs.readFileSync('desktop/plugin.js','utf8');
const c=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa});
vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll('export ','')+'\\nglobalThis.strict=text=>parseCsv(text,{strict:true})',c);
console.log(JSON.stringify(c.strict(fs.readFileSync(process.argv[1],'utf8'))));"""
    strict_js = json.loads(subprocess.run(['node', '-e', script, str(p)], cwd=ROOT,
                                         capture_output=True, text=True, check=True).stdout)
    assert strict_js['items'] == data['items']


def test_product_type_alias_precedence_and_missing_data(tmp_path):
    p = tmp_path / 'types.csv'
    p.write_text('SKU,Name,On Hand,Type,Product Type,category,Jan 2026,Feb 2026,Mar 2026\n'
                 'A,Sealant,12,Not chosen,Not chosen,Sealants,1,2,3\n'
                 'B,Unknown,12,,,,1,2,3\n')
    data = load_csv(str(p))
    assert [i['category'] for i in data['items']] == ['Sealants', '']
    assert data['import_report']['ignored'] == ['Type', 'Product Type']
    assert load_csv(str(p), strict=True)['items'] == data['items']
    js = json.loads(subprocess.run(['node', 'tests/import-parity.cjs', str(p)], cwd=ROOT,
                                  capture_output=True, text=True, check=True).stdout)
    assert js[str(p)] == {'data': data}


def test_returns_warning_count_is_bounded_by_month():
    header='SKU,Name,On Hand,Jan 2026,Feb 2026,Mar 2026\n'
    data=preflight_csv(header+''.join(f'A{i},Widget,10,-1,-2,-3\n' for i in range(2000)))
    assert data['import_report']['rows_imported']==2000
    warnings = data['import_report']['warnings']
    assert len(warnings)==4
    assert all('(2000 rows)' in w for w in warnings if not w.startswith('Number format:'))

