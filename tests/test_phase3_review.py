"""Regression contracts from the OWNER-APPROVED Phase 3 review."""
import engine
import pytest


@pytest.mark.parametrize('n', [18,24,27,28])
def test_smart_forecast_requires_four_origins(n):
    r=engine.forecast_selection(dict(monthly_sales=[10]*n), '2026-10')
    assert r['state'] == ('on' if n>=28 else 'locked')
    assert r['tested_months'] == (n-24 if n>=28 else 0)


@pytest.mark.parametrize('on_order', [0,20])
def test_order_guidance_selects_once_and_does_not_cache_across_calls(monkeypatch, on_order):
    raw = dict(sku='PERF', name='Synthetic', unit='box', on_hand=100,
               supplier_days=14, monthly_sales=list(range(10, 46)), receipts={})
    months = [engine.month_after('2026-10', i-35) for i in range(36)]
    item = dict(raw, **engine.forecast(raw, months, '2026-10-31'), as_of='2026-10-31', on_order=on_order)
    calls = []
    original = engine.forecast_method_values
    def counted(source, method, sales, last, horizon):
        if method == 'champion' and len(sales) == 12:
            calls.append(source['sku'])
        return original(source, method, sales, last, horizon)
    monkeypatch.setattr(engine, 'forecast_method_values', counted)
    engine.order_guidance(item, '2026-11-01')
    assert calls == ['PERF']
    engine.order_guidance(item, '2026-11-01')
    assert calls == ['PERF', 'PERF']


def test_pass_memo_invalidates_nested_diary_and_owner_correction_changes():
    item: dict = dict(monthly_sales=[100, 110]*24, _learning_context=dict(
        enabled=False, entries=[dict(month=f'2026-{m:02d}', prediction=100,
        actual=110, error=10, scale=10) for m in range(5, 11)]))

    @engine.evaluation_pass
    def exercise():
        def checked():
            selected = engine.forecast_selection(item, '2026-10')
            adopted = engine.adopted_history(item, '2026-10')
            assert selected == engine.forecast_selection.__wrapped__(item, '2026-10')
            assert adopted == engine.adopted_history.__wrapped__(item, '2026-10')
            assert engine.forecast_selection(item, '2026-10') is selected
            assert engine.adopted_history(item, '2026-10') is adopted
            return selected

        before = checked()
        item['_learning_context']['enabled'] = True
        enabled = checked()
        assert enabled is not before and 'learning' in enabled
        for row in item['_learning_context']['entries']:
            row.update(error=100, actual=200)
        proposed = checked()
        assert proposed is not enabled and proposed['learning']['state'] == 'proposal'
        item['_learning_context']['approved_bias'] = dict(proposed['learning'])
        approved = checked()
        assert approved is not proposed
        item['_learning_context']['enabled'] = False
        assert 'learning' not in checked()

    exercise()
