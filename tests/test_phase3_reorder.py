"""Lead-time demand service quantiles, synthetic fixtures only."""
import math
import pytest
import engine
import forecast_lab as lab


def test_empirical_monthly_resampling_not_markov_jitter():
    # 18 zeros, 6 tens: one-month empirical P95=10, mean=2.5.
    ys=[0]*18+[10]*6
    r=lab.lead_demand_quantile(ys,30,.95)
    assert r['method'] == 'empirical'
    assert r['quantile'] == 10 and r['mean'] == 2.5
    assert r['buffer'] == 7.5
    assert lab.lead_demand_quantile(ys,0,.95)['quantile'] == 0
    assert lab.lead_demand_quantile(ys,15,.95)['quantile'] == 5
    assert lab.lead_demand_quantile(ys,60,.95)['quantile'] == 20
    assert lab.lead_demand_quantile(ys,60,.95) == lab.lead_demand_quantile(ys,60,.95)


@pytest.mark.parametrize('ys', [[8,12]*12, [1,30]*12])
def test_smooth_and_erratic_keep_analytic_buffer(ys):
    raw=dict(sku='S',monthly_sales=ys,supplier_days=30)
    a=engine.inventory_planning(raw,'2026-10',dict(include_backup_in_orders=True,review_days=90))
    b=engine.inventory_planning(raw,'2026-10',dict(review_days=90))
    assert a == b
    assert 'lead_demand' not in a


def test_smooth_normal_and_enough_history_gate():
    # Equal 8s/12s: mean10, population sd2. 30-day P95=10+1.6449*2.
    r=lab.lead_demand_quantile([8,12]*12,30,.95)
    assert r['method'] == 'normal'
    assert r['quantile'] == pytest.approx(10+1.6449*2)
    assert lab.lead_demand_quantile([8,12]*3,30,.95) is None
    assert lab.lead_demand_quantile([0]*24,30,.95) is None


def test_reorder_uses_sample_normal_policy_not_experimental_ltd_quantile():
    raw=dict(sku='L',name='Synthetic slow',unit='box',on_hand=0,supplier_days=30,monthly_sales=[0]*18+[10]*6,receipts={})
    enabled=dict(include_backup_in_orders=True,buffer_days=0,review_days=0)
    a=engine.inventory_planning(raw,'2026-10',enabled)
    b=engine.inventory_planning(raw,'2026-10',{**enabled,'buffer_days':30,'review_days':90})
    # Last 12: six zeros/six tens => mean5 and sample variance 300/11.
    sigma=math.sqrt(300/11)
    assert a['safety_stock'] == math.ceil(1.6449*sigma) == 9
    assert b['safety_stock'] == math.ceil(1.6449*sigma*math.sqrt(120/30))
    # Forecast model remains frozen (24-month mean2.5); ROP is calendar lead
    # demand plus the active normal safety stock, never an empirical quantile.
    assert a['reorder_point'] == math.ceil(2.5+a['safety_stock'])
    assert b['reorder_point'] == math.ceil(2.5+b['safety_stock'])
    assert 'lead_demand' not in a and 'lead_demand' not in b
    disabled=engine.inventory_planning(raw,'2026-10',{**enabled,'include_backup_in_orders':False})
    assert disabled['safety_stock'] == a['safety_stock']
    assert disabled['reorder_point'] == math.ceil(2.5)
    assert 'lead_demand' not in disabled
