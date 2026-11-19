"""Synthetic settings precedence, strict portability and input-only changes."""
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('settings_engine', Path(__file__).parents[1] / 'engine.py')
assert spec is not None and spec.loader is not None
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)


def test_precedence_and_provenance():
    item = dict(sku='A', supplier='North', supplier_days=30, minimum_order=5, unit_cost=2, service_level=.9, review_days=9)
    settings = dict(default_delivery_days=14, supplier_overrides={'North': dict(supplier_days=21, minimum_order=100, pack_size=25, review_days=7, service_level=.99)}, product_overrides={'A': dict(supplier_days=10, service_level=.95)})
    r = e.resolve_order_settings(item, settings)
    assert r['values']['supplier_days'] == 10
    assert r['sources']['supplier_days'] == 'product setting'
    assert r['values']['minimum_order'] == 100
    assert r['sources']['minimum_order'] == 'supplier setting'
    assert r['sources']['unit_cost'] == 'from file'
    assert e.resolve_order_settings(dict(sku='B'), settings)['sources']['supplier_days'] == 'default'
    assert e.resolve_order_settings(item, {})['values']['supplier_days'] == 30


@pytest.mark.parametrize('field,bad', [('supplier_days',-1),('supplier_days',3651),('service_level',.96),('review_days',1.5),('pack_size',0),('pack_size',.0000001),('minimum_order',-1),('unit_cost',-1)])
def test_strict_override_validation(field, bad):
    raw = {'product_overrides': {'A': {field: bad}}}
    with pytest.raises(ValueError):
        e.validate_order_settings(raw)


@pytest.mark.parametrize('field,low,high', [('default_delivery_days',1,3650),('months_of_cover',0,36),('buffer_days',0,365),('urgent_days',0,3650),('running_low_days',0,3650),('review_days',0,3650),('overstock_months',.1,120),('big_order_months',.1,120),('order_cost',0,1e12),('holding_pct',.01,100)])
def test_global_ranges(field, low, high):
    assert e.validate_order_settings({field:low})[field] == low
    assert e.validate_order_settings({field:high})[field] == high
    with pytest.raises(ValueError): e.validate_order_settings({field:high+1})
    with pytest.raises(ValueError): e.validate_order_settings({field:low-1})


def test_import_rejects_lossy_values_and_unknown_keys():
    for raw in [[], None, {'surprise':1}, {'include_backup_in_orders':'true'}, {'supplier_overrides': {'North': {'unit_cost':4}}}]:
        with pytest.raises(ValueError): e.validate_order_settings(raw)
    good = {'supplier_overrides': {'North': {'supplier_days':0, 'minimum_order':.000001, 'review_days':0, 'service_level':.9}}, 'product_overrides': {'A': {'unit_cost':0}}}
    assert e.validate_order_settings(good) == e.normalize_order_settings(good)


@pytest.mark.parametrize('field,file_value,supplier_value,product_value', [
    ('supplier_days',30,21,10), ('minimum_order',5,100,150),
    ('pack_size',2,25,30), ('review_days',30,7,14), ('service_level',.9,.99,.95),
])
def test_each_field_resolves_independently(field, file_value, supplier_value, product_value):
    item = {'sku':'A', 'supplier':'North', field:file_value}
    s = {'supplier_overrides': {'North': {field:supplier_value}}, 'product_overrides': {'A': {field:product_value}}}
    assert e.resolve_order_settings(item,s)['values'][field] == product_value
    del s['product_overrides']['A'][field]
    assert e.resolve_order_settings(item,s)['values'][field] == supplier_value
    del s['supplier_overrides']['North'][field]
    assert e.resolve_order_settings(item,s)['values'][field] == file_value
    del item[field]
    assert e.resolve_order_settings(item,s)['sources'][field] == 'default'


def test_documented_sample_before_after():
    """Pin the published example to real engine outputs, not hand-entered copy."""
    import json
    data = json.loads((Path(__file__).parents[1] / 'data/sample.json').read_text())
    # Use the active smooth SKU: the dying SKU correctly suggests no purchase,
    # which would no longer exercise MOQ/pack precedence in this example.
    raw = next(item for item in data['items'] if item['sku'] == 'SEAL-CLR-300')
    global_settings = dict(include_backup_in_orders=True, review_days=60, service_level=.99)
    supplier = {**global_settings, 'supplier_overrides': {
        raw['supplier']: dict(supplier_days=21, minimum_order=3000, pack_size=250,
                              review_days=7, service_level=.95)}}
    product = {**supplier, 'product_overrides': {
        raw['sku']: dict(supplier_days=10, minimum_order=5000, pack_size=500,
                         review_days=7, service_level=.9, unit_cost=4)}}
    for settings, expected in [({}, (21, 144, 16)),
                               (global_settings, (21, 156, 28)),
                               (supplier, (21, 3000, 12)),
                               (product, (10, 5000, 7))]:
        forecast = e.forecast(raw, data['months'], data['as_of'],
                              settings=settings, today='2026-11-01')
        item = {**raw, **forecast, 'monthly_sales': raw['monthly_sales'],
                'on_hand': raw['on_hand'], 'as_of': data['as_of']}
        guidance = e.order_guidance(item, '2026-11-01', settings, data['as_of'])
        assert (guidance['lead_days'], guidance['quantity'], guidance['safety_stock']) == expected


def test_cli_same_json_and_explicit_flag_precedence(tmp_path):
    import csv
    import io
    import json
    import subprocess
    import sys
    root = Path(__file__).parents[1]
    source = tmp_path / 'synthetic.csv'
    source.write_text('sku,name,unit,on_hand,supplier_days,supplier,2026-08,2026-09,2026-10\nA,Alpha,box,25,,North,20,45,30\n')
    settings = tmp_path / 'settings.json'
    def run(*args):
        return subprocess.run([sys.executable,str(root/'stock_runway.py'),str(source),'--all','--today','2026-11-01','--settings',str(settings),*args],capture_output=True,text=True)
    settings.write_text(json.dumps({'default_delivery_days':60, 'product_overrides': {'A': {'minimum_order':100, 'pack_size':25}}}))
    result = run()
    assert result.returncode == 0, result.stderr
    row, = csv.DictReader(io.StringIO(result.stdout))
    assert float(row['order_qty']) >= 100 and float(row['order_qty']) % 25 == 0
    result = run('--delivery-days','10')
    assert result.returncode == 0, result.stderr
    row2, = csv.DictReader(io.StringIO(result.stdout))
    assert row2['order_by'] != row['order_by'] or row2['arrives_by'] != row['arrives_by']
    for bad in ['{', '{"service_level":0.96}', '{"product_overrides":{"A":{"pack_size":0}}}', '[]']:
        settings.write_text(bad)
        result = run()
        assert result.returncode == 2
        assert 'Traceback' not in result.stderr
