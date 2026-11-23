"""Synthetic v1.2.2 safety regressions; warning-only checks keep demand intact."""
import importlib.util
from pathlib import Path
import io
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('v122_cli', ROOT/'stock_runway.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
engine, sources = cli._load_modules()
MONTHS = [f'2025-{i:02d}' for i in range(1,13)]

def item(sales, stock=0):
    return dict(sku='S',name='Synthetic',unit='units',on_hand=stock,supplier_days=14,monthly_sales=sales,receipts={})

@pytest.mark.parametrize('value',[.1,.2,.3,.7,1.1,1.15,.35,2.3,4.6,9.95,12.7,33.3,.001,7,100])
def test_fractional_constant_has_no_made_up_backup(value):
    raw=item([value]*12)
    result=engine.forecast(raw,MONTHS,'2025-12-31',today='2026-01-01')
    assert not result['held']
    assert result['safety_stock']==0
    if value==.1:
        assert engine.order_guidance({**raw,**result,'as_of':'2025-12-31'},'2026-01-01',as_of='2025-12-31')['quantity']==1

def test_warning_thresholds_and_dates():
    assert engine.demand_safety_warnings(item([100,100,100,400]),MONTHS[:4],1)==[]
    assert '2025-03' in engine.demand_safety_warnings(item([100,100,1000,100]),MONTHS[:4],1)[0]
    assert engine.demand_safety_warnings(item([1,1,100]),MONTHS[:3],1)==[]
    assert engine.demand_safety_warnings(item([0,0,0],3),MONTHS[:3],0)==[]
    warnings=engine.demand_safety_warnings(item([100]*6+[0]*6),MONTHS,246)
    assert any('No sales for 6 months' in w for w in warnings)
    assert any('Out of stock with no recent sales' in w for w in warnings)

def test_name_generated_codes_are_stable_unique_and_strict_stock_survives():
    from importlib import import_module
    csv = import_module(engine.__package__+'.csv_import')
    text='name,on_hand,2025-01,2025-02,2025-03\nWidget,0,1,1,1\nاسم,0,1,1,1\nTotal,0,3,3,3\n'
    data=csv.preflight_csv(text)
    assert [i['sku'] for i in data['items']]==['widget-c07f0119e3154625','product-1c13a1c124309b97']
    assert data==csv.preflight_csv(text)
    reordered=csv.preflight_csv('name,on_hand,2025-01,2025-02,2025-03\nاسم,0,1,1,1\nNew,0,1,1,1\nWidget,0,1,1,1\n')
    assert {i['name']:i['sku'] for i in data['items']} == {i['name']:i['sku'] for i in reordered['items'] if i['name']!='New'}
    assert 'No product code column found — codes were made from product names.' in data['import_report']['warnings']
    with pytest.raises(sources.SourceError):
        csv.preflight_csv(text.replace('on_hand','unmapped'))


def test_export_incoming_note_only_when_unknown():
    raw=item([100]*12)
    data=dict(items=[raw],months=MONTHS,as_of='2025-12-31')
    rows=cli._export_rows(data,engine,'2026-01-01',{},True)
    handle=io.StringIO();cli._write_csv(handle,rows)
    assert 'Orders already on the way were not included — subtract them before ordering.' in handle.getvalue()
    raw['on_order']=0
    rows=cli._export_rows(data,engine,'2026-01-01',{},True)
    handle=io.StringIO();cli._write_csv(handle,rows)
    assert 'Orders already on the way were not included' not in handle.getvalue()

@pytest.mark.parametrize('header',['Ref','Article No','Prodcut Code','Code produit','Odd field'])
def test_unknown_code_column_blocks_names(header):
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    smart=import_module(engine.__package__+'.smart_import')
    text=f'{header},Name,On Hand,Warehouse,2025-01,2025-02,2025-03\nA-1,Widget,5,East,1,1,1\nA-2,Widget,5,West,1,1,1\n'
    with pytest.raises(sources.SourceError,match=f"Is '{header}' your product code"):
        csv.preflight_csv(text)
    rows=list(__import__('csv').reader(io.StringIO(text)))
    report=smart.understand_workbook([dict(name='CSV',rows=rows)])
    assert 'Product code (SKU)' in report['missing']
    assert any(f"Is '{header}' your product code" in w for w in report['warnings'])

@pytest.mark.parametrize('first,second',[('Widget','Widget'),('Widget',' WIDGET '),('Café','Cafe\u0301'),('Straße','STRASSE'),('Σ','ς'),('Ꭰ','ꭰ')])
def test_generated_duplicate_names_hard_error_across_warehouses(first,second):
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    smart=import_module(engine.__package__+'.smart_import')
    rows=[['Name','On Hand','Warehouse','2025-01','2025-02','2025-03'],[first,'5','East','1','1','1'],[second,'5','West','1','1','1']]
    text='\n'.join(','.join(row) for row in rows)
    for load in [lambda:csv.preflight_csv(text),lambda:smart.understand_workbook([dict(name='CSV',rows=rows)])]:
        with pytest.raises(ValueError,match='Two rows share the name') as error:
            load()
        assert f'"{first}"' in str(error.value)
    assert csv.generated_product_code(first)==csv.generated_product_code(second)

def test_generated_collisions_hard_error_in_csv_and_workbook(monkeypatch):
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    smart=import_module(engine.__package__+'.smart_import')
    monkeypatch.setattr(csv,'generated_product_code',lambda name:'forced')
    rows=[['Name','On Hand','2025-01','2025-02','2025-03'],['One','5','1','1','1'],['Two','5','1','1','1']]
    for load in [lambda:csv.preflight_csv('\n'.join(','.join(row) for row in rows)),lambda:smart.understand_workbook([dict(name='CSV',rows=rows)])]:
        with pytest.raises(ValueError,match='codes collide'):
            load()

def test_blank_generated_name_and_multiple_unusual_months():
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    text='Name,On Hand,2025-01,2025-02,2025-03\n,5,1,1,1\nOther,5,1,1,1'
    assert csv.preflight_csv(text)['import_report']['rows_set_aside'][0]['reason']=='product name is blank'
    assert engine.demand_safety_warnings(item([1,1,1,1,100,200],5),MONTHS[:6],1)==["Months (2025-05, 2025-06) are much higher than usual. Check it isn't a one-off before ordering."]

@pytest.mark.parametrize('count',[1,3,4,500])
def test_duplicate_name_error_is_bounded_by_names_and_unicode_codepoints(count):
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    smart=import_module(engine.__package__+'.smart_import')
    names=['A'*126+'😀 first product','ب'*127+' second product','𐐀'*128+' third product'][:count]
    names += [f'Product {i}' for i in range(3,count)]
    rows=[['Name','On Hand','Warehouse','2025-01','2025-02','2025-03']]
    rows += [[name,'5',f'Warehouse {i}','1','1','1'] for name in names for i in range(12)]
    labels=['A'*126+'😀…','ب'*127+'…','𐐀'*127+'…'][:min(count,3)]
    expected=' '.join(f'Two rows share the name "{name}" and there is no product code column — add a code column so they aren\'t mixed up.' for name in labels)
    if count>3:
        expected+=f' …and {count-3} more repeated names.'
    assert len(expected)<800
    for load in [lambda:csv.preflight_csv('\n'.join(','.join(row) for row in rows)),lambda:smart.understand_workbook([dict(name='CSV',rows=rows)])]:
        with pytest.raises(ValueError) as error:
            load()
        assert str(error.value)==expected

@pytest.mark.parametrize('header',['Article No','Ref'])
def test_numeric_reference_under_unknown_code_hint_requires_mapping(header):
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    smart=import_module(engine.__package__+'.smart_import')
    rows=[[header,'Name','On Hand','2025-01','2025-02','2025-03'],['1001','Widget','5','1','1','1'],['1002','Gadget','5','1','1','1']]
    expected=f"Could not find a product code column. Is '{header}' your product code? Rename it to 'sku' (or 'Item Code')."
    with pytest.raises(sources.SourceError) as error:
        csv.preflight_csv('\n'.join(','.join(row) for row in rows))
    assert str(error.value)==expected
    result=smart.understand_workbook([dict(name='CSV',rows=rows)])
    assert 'Product code (SKU)' in result['missing']
    assert expected in result['warnings']


def test_unknown_numeric_quantity_and_no_alone_allow_unique_names():
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    smart=import_module(engine.__package__+'.smart_import')
    for header in ['Unmapped quantity','Mystery No']:
        rows=[[header,'Name','On Hand','2025-01','2025-02','2025-03'],['1001','Widget','5','1','1','1'],['1002','Gadget','5','1','1','1']]
        result=csv.preflight_csv('\n'.join(','.join(row) for row in rows))
        assert [i['name'] for i in result['items']]==['Widget','Gadget']
        assert header in result['import_report']['ignored']
        assert smart.understand_workbook([dict(name='CSV',rows=rows)])['missing']==[]


def test_numeric_code_hint_tokens_are_bounded_and_respect_candidate_gates():
    from importlib import import_module
    csv=import_module(engine.__package__+'.csv_import')
    hints=['Ref','Reference','Article No','Item No','Part No','Material No','Product Code','Prodcut Code','Code produit','Code','ID','SKU','ARTICLE-NO','ref.',' '*200+'Ref']
    for header in hints:
        assert csv.code_column_candidates([header],[['1001'],['1002']],set())==[header]
        assert csv.code_column_candidates([header],[['1001'],['1002']],{0})==[]
        assert csv.code_column_candidates([header],[['1001'],['1001']],set())==[]
        assert csv.code_column_candidates([header,'Name'],[['1001','Widget'],['','Gadget']],{1})==[]
    for header in ['No','Unmapped quantity','November','x'*129+' ref']:
        assert csv.code_column_candidates([header],[['1001'],['1002']],set())==[]
