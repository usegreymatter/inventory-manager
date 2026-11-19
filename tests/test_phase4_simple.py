"""Owner-fixed hybrid: no tuning, prefix-only classification and flat steady mean."""
from baseline import read_baseline
import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('p4_engine', ROOT / 'engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


@pytest.mark.parametrize('sales', [[10, 20, 30], [10]*8+[20]*3, [200]+[100]*12, [50,150]+[100]*10])
def test_steady_uses_available_up_to_twelve_months(sales):
    from forecast_lab import demand_class
    assert demand_class(sales)['class'] == 'smooth'
    model = engine.demand_model(sales, '2026-12')
    assert model == dict(seasonal=False, factors=[1.0]*12, level=sum(sales[-12:])/len(sales[-12:]), method_name='Steady: 12-month average')
    assert engine.forecast_method_values({}, 'champion', sales, '2026-12', 12) == [model['level']]*12


@pytest.mark.parametrize('sales', [[900]+[10]*12, [0,0,20]*4, [0,0,1,0,0,90]*2, [0]*12, [10,20]])
def test_irregular_inactive_and_too_short_keep_exact_legacy(sales):
    assert engine.demand_model(sales, '2026-12') == engine.legacy_demand_model(sales, '2026-12')


def test_details_show_steady_method_without_unlocking_short_history_intervals():
    item = dict(sku='S', monthly_sales=[10]*6+[20]*3, as_of='2026-12-31')
    details = engine.forecast_details(item, {'quantity': 0}, as_of=item['as_of'])
    assert details['method_name'] == 'Steady: 12-month average'
    assert details['tested_months'] == 0
    assert details['scenarios'] is None


def test_legacy_pattern_still_has_calendar_variation():
    sales = [0,1000]+[10]*10
    assert engine.demand_model(sales, '2026-12') == engine.legacy_demand_model(sales, '2026-12')
    assert engine.forecast_method_values({}, 'champion', sales, '2026-12', 2) == [10,40]


def test_classifier_cached_once_per_snapshot_and_invalidated_by_edits(monkeypatch):
    original = engine._demand_class
    calls = []
    def counted(sales, **kwargs):
        calls.append(tuple(sales))
        return original(sales, **kwargs)
    monkeypatch.setattr(engine, '_demand_class', counted)
    sales = [10]*12
    @engine.evaluation_pass
    def snapshot():
        before = len(calls)
        for _ in range(10):
            assert engine.demand_model(list(sales), '2026-12')['level'] == 10
        assert len(calls) == before + 1
        sales[0] = 900
        assert engine.demand_model(sales, '2026-12') == engine.legacy_demand_model(sales, '2026-12')
        assert len(calls) == before + 2
        sales[0] = 10
    snapshot()
    snapshot()
    assert len(calls) == 4
    assert engine._EVALUATION.get() is None


def test_shared_quantile_ordering_preserves_every_original_gate_metric():
    import random
    import subprocess
    import types
    import forecast_lab as lab
    original = types.ModuleType('phase4_original_score')
    code = read_baseline('4a2bbcb:forecast_lab/__init__.py', text=True)
    exec(compile(code, '4a2bbcb:forecast_lab/__init__.py', 'exec'), original.__dict__)
    rng = random.Random(4104)
    histories = [[0]*48, [10]*48, [.1]*48]
    histories += [[rng.randrange(100)/7 for _ in range(48)] for _ in range(20)]
    for sales in histories:
        scales = {}
        for method in lab.METHODS[:-1]:
            if lab.eligible(method, sales):
                assert lab.forecast(sales, 12, method) == original.forecast(sales, 12, method)
            folds = lab.backtest(sales, method=method)
            expected = original.score_folds(sales, folds)
            assert lab.score_folds(sales, folds) == expected
            assert lab.score_folds(sales, folds, _scales=scales) == expected
