"""Phase 3: production champion, never the lab flat benchmark by proxy."""
import json
import subprocess
import types
import pytest
from baseline import read_baseline
from policy_assertions import assert_forecast_frozen
import engine


def item(sales):
    return dict(sku='F', name='Synthetic forecast', unit='box', on_hand=120,
                supplier_days=14, monthly_sales=sales, receipts={})


def test_selection_compares_actual_production_champion():
    r = engine.forecast_selection(item([10]*36), '2026-10')
    assert r['method'] == 'champion'
    assert not r['adopted']
    assert r['tested_months'] == 12
    assert r['errors'] == [0]*12


def test_sustained_trend_can_win_but_must_pass_margin_and_bias():
    r = engine.forecast_selection(item(list(range(10,46))), '2026-10')
    assert r['adopted']
    c = r['candidates'][r['method']]
    assert c['mae'] <= .9*c['champion_mae']
    assert abs(c['bias']) <= abs(c['champion_bias'])+1e-12
    assert c['origins'] >= 4
    assert len(r['forecast']) == 12


@pytest.mark.parametrize('n', [3,6,12,17,18,24,36])
def test_constant_and_short_histories_whole_output_unchanged(n):
    old = types.ModuleType('phase2')
    source = read_baseline('55284fe:engine.py', text=True)
    # Owner-approved Phase 4 method label accompanies the model substitution.
    source = source.replace('SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON', 'model.get("method_name") or (SEASONAL_COPY if model["seasonal"] else SEASONAL_REASON)')
    exec(compile(source,'55284fe:engine.py','exec'),old.__dict__)
    old.demand_model = engine.demand_model  # Owner-approved Phase 4 model seam.
    raw=item([30]*n)
    months=[engine.month_after('2026-10',i-n+1) for i in range(n)]
    for settings in [{}, {'include_backup_in_orders':True,'big_order_months':6}]:
        assert_forecast_frozen(engine.forecast(raw,months,'2026-10-31',settings=settings),
                                   old.forecast(raw,months,'2026-10-31',settings=settings),
                                   engine, raw, '2026-10-31', settings=settings)


def test_selected_curve_drives_projection_guidance_and_safety_order():
    raw=item(list(range(10,46)))
    months=[engine.month_after('2026-10',i-35) for i in range(36)]
    p=engine.forecast(raw,months,'2026-10-31',settings={'big_order_months':6})
    selection=engine.forecast_selection(raw,'2026-10')
    assert [r['demand'] for r in p['projection']] == selection['forecast'][:6]
    g=engine.order_guidance({**raw,**p,'as_of':'2026-10-31','on_hand':raw['on_hand'],'monthly_sales':raw['monthly_sales']},'2026-10-31',{'big_order_months':6})
    assert p['suggested_order']==g['quantity']
    assert sum(r['qty'] for r in engine.why_breakdown({**raw,**p,'as_of':'2026-10-31'},'2026-10-31'))==g['quantity']


def test_intermittent_adoption_is_not_labelled_no_sales():
    raw=item([40 if i%6==0 else 0 for i in range(48)])
    months=[engine.month_after('2026-10',i-47) for i in range(48)]
    p=engine.forecast(raw,months,'2026-10-31')
    assert engine.forecast_selection(raw,'2026-10')['adopted']
    assert engine.order_bucket({**raw,**p,'as_of':'2026-10-31'},'2026-11-01')!='no-sales'


def test_empirical_order_scenarios_keep_recommended_and_do_not_stack_safety():
    raw=item([20,25,30,20,28,24]*6);raw['on_hand']=0
    months=[engine.month_after('2026-10',i-35) for i in range(36)]
    settings={'include_backup_in_orders':True,'product_overrides':{'F':{'pack_size':4}}}
    p=engine.forecast(raw,months,'2026-10-31',settings=settings)
    enriched={**raw,**p,'as_of':'2026-10-31'}
    g=engine.order_guidance(enriched,'2026-11-01',settings)
    r=engine.forecast_details(enriched,g,settings,peers=[{**raw, "sku":"P"+str(i)} for i in range(3)])
    assert r['scenarios']['recommended']==g['quantity']
    assert r['scenarios']['lean']<=g['quantity']<=r['scenarios']['stock_up']
    assert r['scenarios']['p50']<=r['scenarios']['p80']<=r['scenarios']['p95']
    assert r['scenarios']['samples']>=4
    assert r['scenarios']['lean']%4==0 and r['scenarios']['stock_up']%4==0
    assert engine.forecast_details(item([10]*3),{'quantity':20})['scenarios'] is None


def test_excluded_or_censored_months_cannot_unlock_smart_forecast():
    raw=item(list(range(10,46)))
    months=[engine.month_after('2026-10',i-35) for i in range(36)]
    raw['planning_facts']={'version':'1.0','sales_history':[dict(sku='F',month=m,quantity=v,project=i==0) for i,(m,v) in enumerate(zip(months,raw['monthly_sales']))]}
    r=engine.forecast_selection(raw,'2026-10')
    assert r['state']=='locked' and not r['adopted']
