"""A9 synthetic limits and runtime containment, independent of Git/history."""
import json
import sys
import types
from pathlib import Path
from datetime import date
import pytest
ROOT = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('stock_runway'); pkg.__path__ = [str(ROOT)]
sys.modules.setdefault('stock_runway', pkg)
from stock_runway import engine, sources, tools
from test_odoo import FakeProxyFactory, adapter, movement
FIX = ROOT / 'tests/fixtures'
MONTHS = ['2026-08', '2026-09', '2026-10']
ITEM = dict(sku='A', name='Synthetic', unit='m', on_hand=5, supplier_days=None, monthly_sales=[10]*3, receipts={})

@pytest.mark.parametrize('file,message', [('mixed_overflow.csv',r'Row 3: supplier_days.*3650'), ('date_boundary.csv','1000-01.*9998-12'), ('finite_sales_overflow.csv','1000000000000')])
def test_source_stress_rejected(file, message):
    with pytest.raises(sources.SourceError, match=message): sources.load_csv(str(FIX/file), strict=True)

@pytest.mark.parametrize('months,as_of', [([], '2026-10-31'), (['bad']*3,'2026-10-31'), (['2026-06','2026-08','2026-10'],'2026-10-31'), (['9999-10','9999-11','9999-12'],'9999-12-31'), (MONTHS,''), (MONTHS,None), (MONTHS,'2026-10-30')])
def test_direct_labels_and_dates_hold(months, as_of):
    assert engine.forecast(ITEM, months, as_of)['held']

def test_valid_date_edges_and_long_history():
    for last in ['1000-03','9998-12']:
        months = [engine.month_after(last, i) for i in [-2,-1,0]]
        item = {**ITEM, 'supplier_days':3650}
        assert not engine.forecast(item, months, sources._month_end(last),12)['held']
    months = [engine.month_after('1000-01', i) for i in range(65000)]
    assert not engine.forecast({**ITEM,'monthly_sales':[1]*65000},months,sources._month_end(months[-1]))['held']

@pytest.mark.parametrize('patch', [{'supplier_days':9999999},{'monthly_sales':[1e308]*3},{'on_hand':1e308},{'receipts':{'2026-11':1e308}}])
def test_direct_limits_hold(patch):
    assert engine.forecast({**ITEM,**patch}, MONTHS,'2026-10-31')['held']

def test_tool_unexpected_item_failure_is_safe_and_local(monkeypatch):
    monkeypatch.setattr(tools,'load_sample',lambda _:dict(months=MONTHS,as_of='2026-10-31',items=[ITEM,{**ITEM,'sku':'B'}]))
    original = tools.forecast
    def failing(item,*args):
        if item['sku']=='B': raise RuntimeError('PRIVATE password=do-not-show')
        return original(item,*args)
    monkeypatch.setattr(tools,'forecast',failing)
    raw = tools.make_handler()({})
    data=json.loads(raw)
    assert not data['items'][0]['held']
    assert data['items'][1]['reason'].startswith("Couldn't calculate: ")
    assert 'PRIVATE' not in raw and 'password' not in raw

@pytest.mark.parametrize('mode', ['sales','converted','quants','quant_sum','net_sales','history','history_sum','rollback'])
def test_fake_odoo_limits_never_publish_infinity(mode):
    f=FakeProxyFactory()
    f.data['stock.location'].append({'id':70,'usage':'supplier'})
    if mode=='sales': f.data['stock.move']=[movement(1e308,41,90,f'2026-{m:02d}-15') for m in [8,9,10]]
    if mode=='converted': f.data['stock.move']=[movement(1e12,41,90,product_uom=[2,'Dozens'])]
    if mode=='quants': f.data['stock.quant'][0]['quantity']=1e308
    if mode=='quant_sum': f.data['stock.quant']=[{**f.data['stock.quant'][0],'quantity':6e11}]*2
    if mode=='net_sales': f.data['stock.move']=[movement(6e11,41,90)]*2
    if mode=='history': f.data['stock.move']=[movement(1e308,70,41)]
    if mode=='history_sum': f.data['stock.move']=[movement(6e11,70,41)]*2
    if mode=='rollback': f.data['stock.move']=[movement(1e12,41,90,'2026-11-02')]*2
    data=adapter(f).load(['FAKE-A'],today=date(2026,11,8))
    json.dumps(data,allow_nan=False)
    item=data['items'][0]
    if mode.startswith('history'):
        assert 'historical_receipts' not in item
        assert not engine.forecast(item,data['months'],data['as_of'])['held']
    else: assert engine.forecast(item,data['months'],data['as_of'])['held']

def test_receipt_aggregation_cannot_bypass_cap(tmp_path):
    path=tmp_path/'receipts.csv'; path.write_text('sku,month,quantity\nA,2026-11,600000000000\nA,2026-11,600000000000\n')
    with pytest.raises(sources.SourceError,match='1000000000000'):
        sources.load_receipts(str(path),MONTHS,[{**ITEM,'receipts':{}}])

def test_fractional_error_never_rounds_nonzero_to_zero():
    data=sources.load_csv(str(FIX/'fractional.csv'))
    for item in data['items']:
        result=engine.forecast(item,data['months'],data['as_of'])
        assert result['monthly_demand']==sum(item['monthly_sales'][-12:]) / len(item['monthly_sales'][-12:])
        assert 0 < result['error_percent'] < .01
    assert engine.backtest([.04]*7)['error_percent']==0

def test_a10_fractional_on_hand_stays_exact_with_fractional_demand():
    data = sources.load_csv(str(FIX/'fractional.csv'))
    before = json.dumps(data)
    for item in data['items']:
        demand = sum(item['monthly_sales'][-12:]) / len(item['monthly_sales'][-12:])
        balance = 0
        expected_projection = []
        for month in ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']:
            balance -= demand
            expected_projection.append(dict(month=month, demand=demand, receipts=0, stock=balance))
        assert item['on_hand'] == 0.7
        result = engine.forecast(item, data['months'], data['as_of'], 6)
        assert result['stock'] == 0
        assert result['monthly_demand'] == demand
        assert result['projection'] == expected_projection
        assert result['runout_month'] == '2026-11'
        assert result['runout_day'] == '2026-11-01'
        integer_oracle = engine.forecast({**item, 'on_hand': 0}, data['months'], data['as_of'], 6)
        assert result == integer_oracle
    assert json.dumps(data) == before

@pytest.mark.parametrize('value', [.1, .2, .07])
def test_truly_constant_fractional_series_has_zero_error(value):
    assert engine.backtest([value]*7)['error_percent'] == 0

@pytest.mark.parametrize('column', ['on_hand','2026-08','rcv:2026-08'])
def test_csv_quantity_cap_in_every_quantity_column(tmp_path, column):
    headers=['sku','name','unit','on_hand','supplier_days',*MONTHS,*['rcv:'+m for m in MONTHS]]
    values=['A','Synthetic','m','5','3650','10','10','10','0','0','0']
    path=tmp_path/'cap.csv'
    for number, rejected in [(10**12,False),(10**12+1,True)]:
        values[headers.index(column)]=str(number)
        path.write_text(','.join(headers)+'\n'+','.join(values)+'\n')
        if rejected:
            with pytest.raises(sources.SourceError,match='Row 2:.*1000000000000'): sources.load_csv(str(path))
        else: assert sources.load_csv(str(path))['items'][0]['supplier_days']==3650

def test_source_accepts_long_representable_history(tmp_path):
    months=[engine.month_after('1000-01',i) for i in range(65000)]
    path=tmp_path/'long.csv'
    path.write_text('sku,name,unit,on_hand,supplier_days,'+','.join(months)+'\nA,Synthetic,m,5,,'+','.join(['1']*65000)+'\n')
    data=sources.load_csv(str(path))
    assert data['months']==months
    assert not engine.forecast(data['items'][0],months,data['as_of'])['held']

def test_huge_history_is_unknown_not_falsely_reconstructed():
    item={**ITEM,'historical_receipts':dict.fromkeys(MONTHS,1e308)}
    assert engine.inventory_history(item,MONTHS)['rows']==[]

def test_extreme_ratio_is_held_without_nonfinite_output():
    months=[engine.month_after('2026-04',i) for i in range(7)]
    item={**ITEM,'monthly_sales':[1e12]*3+[1e-300]*4}
    row=engine.forecast(item,months,'2026-10-31')
    assert row['held']
    json.dumps(row,allow_nan=False)
