"""Synthetic contract tests for the unconnected forecast laboratory."""
import copy
import math
import pytest
import forecast_lab as lab


def test_cleaning_order_and_no_mutation():
    rows = [dict(sku='A', month='2024-01', demand=100, in_stock_days=15,
                 days_in_month=30, project_qty=20),
            dict(sku='B', month='2024-01', demand=10)]
    original = copy.deepcopy(rows)
    out = lab.clean_demand(rows, manual_pct={'B': 10}, supersessions={'A': 'B'},
                           transfers=[dict(from_sku='B', to_sku='C', month='2024-01', quantity=30)])
    assert rows == original
    assert {(r['sku'], r['demand']) for r in out['rows']} == {('A', 0), ('B', 176), ('C', 30)}
    assert list(dict.fromkeys(t['step'] for t in out['trace'])) == [
        'stockout_correction', 'project_exclusion', 'supersession', 'substitute_transfer', 'manual_change']
    assert all(set(t) == {'step', 'sku', 'month', 'before', 'after'} for t in out['trace'])


def test_stockout_floor_backorders_and_weak_evidence():
    rows = [dict(sku='A', month='2024-01', demand=10, in_stock_fraction=.01),
            dict(sku='B', month='2024-01', demand=10, in_stock_fraction=.5, backorder=True),
            dict(sku='C', month='2024-01', demand=10, month_end_stock=0),
            dict(sku='D', month='2024-01', demand=10, daily_stock=[0, 2, 0, 2])]
    out = lab.clean_demand(rows)
    assert [r['demand'] for r in out['rows']] == [40, 10, 10, 20]
    assert any(f['code'] == 'possible_stockout' and f['sku'] == 'C' for f in out['flags'])


def test_outliers_suggest_only_and_oneoffs_explicit():
    rows = [dict(sku='A', month=f'2024-{i+1:02}', demand=x) for i, x in enumerate([10]*6+[100])]
    out = lab.clean_demand(rows, suggest_outliers=True)
    assert out['rows'][-1]['demand'] == 100
    assert any(f['code'] == 'outlier_suggestion' for f in out['flags'])
    rows[-1]['one_off'] = True
    assert lab.clean_demand(rows)['rows'][-1]['demand'] == 0


def test_links_are_conservative_and_cyclic_supersession_rejected():
    rows = [dict(sku='A', month='2024-01', demand=10)]
    out = lab.clean_demand(rows, transfers=[dict(from_sku='A', to_sku='B', month='2024-01', quantity=7)])
    assert sum(r['demand'] for r in out['rows']) == 10
    with pytest.raises(ValueError):
        lab.clean_demand(rows, transfers=[dict(from_sku='A', to_sku='B', month='2024-01', quantity=11)])
    with pytest.raises(ValueError):
        lab.clean_demand(rows, supersessions={'A':'B','B':'A'})
    out = lab.clean_demand(rows, supersessions={'A':'B','B':'C'})
    assert next(r['demand'] for r in out['rows'] if r['sku']=='C') == 10


@pytest.mark.parametrize('values', [[10]*36, list(range(1,49)), [10,20,50,100]*12, [0,0,0,20]*12])
def test_methods_finite_nonnegative_and_gate_selection(values):
    result = lab.analyze(values, horizon=4)
    assert len(result['forecast']) == 4
    assert all(math.isfinite(x) and x >= 0 for x in result['forecast'])
    accuracy = result['accuracy']
    if result['method'] != 'baseline':
        assert accuracy['selected']['mae'] < accuracy['baseline']['mae']
        assert accuracy['selected']['wape'] < accuracy['baseline']['wape']
    else:
        assert result['badge'] == 'basic'


def test_exact_methods_and_thin_data():
    assert lab.forecast([12]*12, 3) == [12]*3
    assert lab.forecast(list(range(1,25)), 2, 'seasonal_naive') == [13,14]
    assert lab.forecast([0]*30, 2, 'sba') == [0,0]
    assert lab.forecast([], 2, 'similar', similar=[10]*24, scale=1.5) == [15,15]
    thin = lab.analyze([], similar=[10]*24, scale=1.5)
    assert thin['method'] == 'baseline' and thin['pattern'] == 'new'
    assert thin['similar_proposal'] == [15]*3
    assert lab.analyze([10]*36)['method'] == 'baseline'
    assert not lab.eligible('seasonal', [10]*23)
    assert lab.eligible('seasonal', [10]*24)
    assert not lab.eligible('sba', [0,10]*12)
    assert lab.eligible('sba', [0,0,10]*12)


def test_backtests_are_prefix_only_and_horizon_aware():
    values = list(range(1,37))
    folds = lab.backtest(values, 'holt_damped', horizon=3)
    for fold in folds:
        assert fold['prediction'] == lab.forecast(values[:fold['origin']], len(fold['actual']), 'holt_damped')
        assert fold['actual'] == values[fold['origin']:fold['origin']+3]
    assert len(lab.analyze(values, horizon=3)['uncertainty']) == 3


def test_bands_coverage_is_prequential_not_in_sample():
    bands = lab.analyze([10,15,4,20,8]*10, horizon=3)['uncertainty']
    for band in bands:
        assert 0 <= band['lower'] <= band['lean'] <= band['recommended']
        assert band['stock_up'] is None  # <19 held-out errors cannot supply finite P95
        assert band['upper'] == band['stock_up']
        assert band['coverage']['samples'] < band['samples']
        assert band['coverage']['rate'] is None or 0 <= band['coverage']['rate'] <= 1


def test_safety_stock_units_receipt_gate_and_review_horizon():
    errors = [2,-2,2,-2]
    result = lab.safety_stock(errors, mean_monthly=30, lead_days=30, review_days=30, service_z=2)
    assert result['quantity'] == pytest.approx(2*math.sqrt(8))
    assert result['lead_time']['enabled'] is False
    receipts = [dict(ordered_date='2024-01-01', received_date=f'2024-01-{d:02}') for d in [11,21,31,21,21]]
    spread = lab.safety_stock(errors, 30, 30, 30, receipts, 2)
    assert spread['lead_time']['enabled'] is True
    assert spread['lead_time']['mean_days'] == 20
    assert spread['lead_time']['sd_days'] == pytest.approx(math.sqrt(50))
    assert spread['quantity'] == pytest.approx(2*math.sqrt(4*(50/30)+50))
    assert not lab.safety_stock(errors,30,30,30,receipts[:4])['lead_time']['enabled']
    assert lab.safety_stock([],30,30,30)['quantity'] is None


@pytest.mark.parametrize('bad', [[-1], [float('nan')], [True], [float('inf')]])
def test_invalid_values_fail_closed(bad):
    with pytest.raises(ValueError):
        lab.analyze(bad)


def test_per_sku_report_keeps_identity_and_series_results():
    result = lab.analyze_sku('SKU-001', [10]*36, horizon=2)
    assert result == {'sku':'SKU-001', **lab.analyze([10]*36, horizon=2)}
    assert result['pattern'] == 'smooth'
    assert result['method'] == 'baseline'
    assert set(result['accuracy']) >= {'baseline','selected'}
    with pytest.raises(ValueError):
        lab.analyze_sku(' ', [10]*36)


def test_zero_actual_wape_is_explicit_and_bad_options_reject():
    assert lab.analyze([0]*36)['accuracy']['baseline']['wape'] is None
    for kwargs in [dict(horizon=0),dict(horizon=True),dict(lead_days=-1),dict(scale=float('inf'))]:
        with pytest.raises(ValueError):
            lab.analyze([10]*36, **kwargs)
    with pytest.raises(ValueError):
        lab.clean_demand([dict(sku='A',month='2024-13',demand=1)])
    with pytest.raises(ValueError):
        lab.clean_demand([dict(sku='A',month='2024-01',demand=1)]*2)
