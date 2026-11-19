"""Synthetic calibration arithmetic; no ERP or network."""
import pytest
import engine
import forecast_lab as lab


def raw(sales, sku='F'):
    return dict(sku=sku, name='Synthetic', unit='box', on_hand=0, supplier_days=14, monthly_sales=sales, receipts={})


def test_finite_sample_one_sided_conformal():
    # n=19: ceil(20*.8)=16, ceil(20*.95)=19 (1-indexed).
    assert lab.conformal_quantile(list(range(1, 20)), .8) == 16
    assert lab.conformal_quantile(list(range(1, 20)), .95) == 19
    # The +infinity order statistic cannot honestly become the sample maximum.
    assert lab.conformal_quantile([1, 2, 3, 4], .95) is None
    assert lab.conformal_quantile([], .8) is None


def test_syntetos_boylan_pool_classes():
    assert lab.demand_class([10]*12)['class'] == 'smooth'
    assert lab.demand_class([10, 0]*6)['class'] == 'intermittent'
    assert lab.demand_class([1, 100]*6)['class'] == 'erratic'
    assert lab.demand_class([1, 0, 100, 0]*3)['class'] == 'lumpy'
    assert lab.demand_class([0]*12)['class'] == 'inactive'


def test_selection_is_frozen_before_calibration_tail():
    sales=list(range(10, 46))
    a=engine.forecast_selection(raw(sales), '2026-10')
    b=engine.forecast_selection(raw(sales[:-12]+[900]*12), '2026-10')
    assert a['method'] == b['method']
    assert a['calibration_start'] == 24
    assert all(r['origin']+len(r['errors']) <= 24 for r in a['folds'])


def test_hand_derived_pool_normalizes_scale_and_deduplicates():
    item, peer, other = raw([10]*36,'A'), raw([100]*36,'B'), raw([10,0]*18,'C')
    g=dict(quantity=20,endpoint='2026-11-30',incoming=0)
    assert engine.forecast_details(item,g,as_of='2026-10-31',peers=[other])['scenarios'] is None
    d=engine.forecast_details(item,g,as_of='2026-10-31',peers=[item,peer,peer,other])['scenarios']
    assert d['samples'] == 24 and d['own_samples'] == 12 and d['pooled']
    assert d['p50'] == d['p80'] == d['p95'] == 10
    assert d['lean'] == 10 and d['recommended'] == d['stock_up'] == 20


def test_pool_only_same_class_and_no_finite_p95_with_thin_calibration():
    item=raw([20,25,30,20,28,24]*6)
    g=dict(quantity=60, endpoint='2026-12-31', incoming=0)
    assert engine.forecast_details(item, g, as_of='2026-10-31')['scenarios'] is None
    peers=[raw([20,25,30,20,28,24]*6, 'P'+str(i)) for i in range(3)]
    d=engine.forecast_details(item, g, as_of='2026-10-31', peers=peers)['scenarios']
    assert d['samples'] >= 19 and d['pooled']
    assert 0 <= d['p50'] <= d['p80'] <= d['p95']
    other=[raw([10,0]*18, 'OTHER')]
    assert engine.forecast_details(item,g,as_of='2026-10-31',peers=other)['scenarios'] is None
