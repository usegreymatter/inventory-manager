"""Supplier metadata is optional and cannot affect planning numbers. Fakes only."""
from baseline import read_baseline
import csv
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import types
from datetime import date
import pytest

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType('stock_runway')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', package)
from stock_runway.sources import ERP_ALIASES, SourceError, load_csv, load_sample
from stock_runway.engine import forecast
from test_odoo import FakeProxyFactory, adapter

ALIASES = ['supplier', 'vendor', 'supplier name', 'vendor name', 'partner', 'main supplier', 'preferred supplier', 'preferred vendor']

@pytest.mark.parametrize('alias', ALIASES)
@pytest.mark.parametrize('canonical', [True, False])
def test_supplier_aliases_optional_and_js_parity(tmp_path, alias, canonical):
    header = ['sku','name','unit','on_hand','supplier_days'] if canonical else ['Item Code','Item Name','UoM','Qty On Hand','Lead Time']
    rows = [header + [alias,'category','2026-08','2026-09','2026-10'], ['A','Synthetic','ea','25','14','  Demo Vendor  ','Tiles','10','20','30']]
    buffer=io.StringIO();csv.writer(buffer).writerows(rows)
    path=tmp_path/'supplier.csv';path.write_text(buffer.getvalue())
    got=load_csv(str(path));assert got['items'][0]['supplier']=='Demo Vendor'
    script = "const fs=require('node:fs'),vm=require('node:vm');const s=fs.readFileSync('desktop/plugin.js','utf8');const c=vm.createContext({TextEncoder,TextDecoder,atob,btoa});vm.runInContext(s.slice(s.indexOf('const SAMPLE ='),s.indexOf('const pageStyle =')).replaceAll('export ','')+';globalThis.load=parseCsv',c);console.log(JSON.stringify(c.load(fs.readFileSync(process.argv[1],'utf8'))));"
    js=json.loads(subprocess.run(['node','-e',script,str(path)],cwd=ROOT,capture_output=True,text=True,check=True).stdout)
    assert got==js
    before={k:v for k,v in got['items'][0].items() if k not in ('supplier','category')}
    assert forecast(got['items'][0],got['months'],got['as_of'])==forecast(before,got['months'],got['as_of'])


def test_supplier_duplicate_rejected(tmp_path):
    path=tmp_path/'duplicate.csv';path.write_text('sku,name,unit,on_hand,supplier_days,supplier,supplier,2026-08,2026-09,2026-10\nA,Demo,ea,1,14,X,Y,1,1,1\n')
    with pytest.raises(SourceError,match='Supplier column must be unique'):
        load_csv(str(path))


def test_odoo_lowest_sequence_supplier_metadata_preserves_conservative_lead():
    factory=FakeProxyFactory()
    factory.data['product.supplierinfo']=[
        dict(product_tmpl_id=[11,'Fake'],product_id=False,delay=20,sequence=20,partner_id=[7,'Later supplier']),
        dict(product_tmpl_id=[11,'Fake'],product_id=False,delay=6,sequence=1,partner_id=[8,'  First supplier  ']),
        dict(product_tmpl_id=[11,'Fake'],product_id=[99,'Other variant'],delay=999,sequence=0,partner_id=[9,'Not applicable']),
        dict(product_tmpl_id=[77,'Other template'],product_id=False,delay=999,sequence=0,partner_id=[10,'Not applicable'])]
    result=adapter(factory).load(['FAKE-A'],today=date(2026,11,8));item=result['items'][0]
    assert item['supplier']=='First supplier' and item['supplier_days']==20
    fields=next(kwargs['fields'] for model,_,_,kwargs in factory.calls if model=='product.supplierinfo')
    assert {'partner_id','sequence'}<=set(fields)
    del factory.data['product.supplierinfo'][1]['partner_id']
    assert adapter(factory).load(['FAKE-A'],today=date(2026,11,8))['items'][0]['supplier']==''


def test_odoo_equal_sequence_keeps_first_and_missing_supplier_is_optional():
    factory=FakeProxyFactory()
    factory.data['product.supplierinfo']=[dict(product_tmpl_id=[11,'Fake'],product_id=False,delay=6,partner_id=[7,name]) for name in ['First','Second']]
    assert adapter(factory).load(['FAKE-A'],today=date(2026,11,8))['items'][0]['supplier']=='First'
    factory.data['product.supplierinfo']=[]
    assert adapter(factory).load(['FAKE-A'],today=date(2026,11,8))['items'][0]['supplier']==''


def test_builtin_supplier_metadata_leaves_every_forecast_field_unchanged():
    old=json.loads(read_baseline('643107a:data/sample.json', text=True))
    new=load_sample();assert len(new['items'])==len(old['items'])==5
    for before,after in zip(old['items'],new['items']):
        without_supplier = {k:v for k,v in before.items() if k!='supplier'}
        assert {k:v for k,v in after.items() if k!='supplier'}==without_supplier
        assert forecast(without_supplier,old['months'],old['as_of'])==forecast(after,new['months'],new['as_of'])
    assert ERP_ALIASES['supplier']==ALIASES
