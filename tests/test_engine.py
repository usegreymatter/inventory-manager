from pathlib import Path
from fractions import Fraction
import calendar
import math
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)

import pytest

from stock_runway.engine import backtest, forecast, validate_item
from stock_runway.sources import load_sample


def test_sample_oracle_independently_recomputed():
    data = load_sample(Path(__file__).parents[1] / "data" / "sample.json")
    expected = {
        "SEAL-CLR-300": (340, 866 / 12, "2027-03", 13),
        "UL-FOAM-GRN": (7, 17 / 6, "2026-12", 101),
        "GRT-GRY-5": (90, 639 / 12, "2026-12", 100),
        "TRM-ALU-25": (42, 23 / 3, "2027-06", 67),
        "SEAL-WHT-300": (5, 0, None, None),
    }
    for item in data["items"]:
        row = item["monthly_sales"]
        month = "2026-10"
        stock = int(item["on_hand"])
        # The synthetic sample deliberately spans steady and legacy seasonal
        # paths. Recompute the clamped calendar model with exact fractions,
        # independently of demand_model/month_demand.
        from stock_runway.forecast_lab import demand_class
        steady = item['sku'] in ('SEAL-CLR-300', 'GRT-GRY-5')
        assert demand_class(row)['class'] == {
            'SEAL-CLR-300': 'smooth', 'UL-FOAM-GRN': 'intermittent',
            'GRT-GRY-5': 'smooth', 'TRM-ALU-25': 'intermittent',
            'SEAL-WHT-300': 'intermittent'}[item['sku']]
        average = Fraction(sum(row[-12:]), 12)
        if steady:
            demands = [average] * 12
        else:
            factors = [max(Fraction(1, 2), min(Fraction(2), v / average)) for v in row]
            level = sum(Fraction(v) / f for v, f in zip(row[-3:], factors[-3:])) / 3
            demands = [level * factor for factor in factors]
        demand = float(demands[0])
        balance = Fraction(stock)
        runout = None
        runout_day = None
        projection = []
        for offset in range(1, 13):
            year, mon = map(int, month.split("-"))
            mon += offset
            year += (mon - 1) // 12
            mon = (mon - 1) % 12 + 1
            future_month = f"{year:04d}-{mon:02d}"
            receipt = item['receipts'].get(future_month, 0)
            opening = balance + receipt  # Engine-consumed receipts arrive at month start.
            balance = opening - demands[offset - 1]
            projection.append((future_month, float(demands[offset - 1]), receipt, float(balance)))
            if balance <= 0 and runout is None:
                runout = future_month
                days = calendar.monthrange(year, mon)[1]
                elapsed = math.ceil(max(0, opening) / demands[offset - 1] * days)
                runout_day = f"{future_month}-{max(1, min(days, elapsed)):02d}"
        forecasted = [sum(row[i - 3:i]) / 3 for i in range(len(row) - 4, len(row))]
        actual = row[-4:]
        error = (int(sum(abs(f - a) for f, a in zip(forecasted, actual)) / sum(actual) * 100 + 0.5)
                 if sum(actual) else None)
        result = forecast(item, data["months"], data["as_of"], 12)
        assert result["monthly_demand"] == expected[item["sku"]][1]
        assert result["monthly_demand"] == demand
        assert demand == expected[item["sku"]][1]
        assert (result["stock"], result["runout_month"], result["error_percent"]) == (stock, runout, error)
        assert (stock, runout, error) == (expected[item["sku"]][0], expected[item["sku"]][2], expected[item["sku"]][3])
        assert result['runout_day'] == runout_day
        assert len(result['projection']) == len(projection) == 12
        for actual_month, (month, demand, receipt, balance) in zip(result['projection'], projection):
            assert (actual_month['month'], actual_month['demand'], actual_month['receipts']) == (month, demand, receipt)
            assert actual_month['stock'] == pytest.approx(balance, rel=0, abs=1e-12)


def test_backtest_thresholds_and_minimum():
    assert backtest([2] * 6)["grade"] == "Not enough history to check"
    assert backtest([10] * 7) == {"error_percent": 0, "grade": "Usable for planning"}


def test_invalid_values_hold_and_horizon_is_bounded():
    data = load_sample()
    bad = {**data["items"][0], "on_hand": -1}
    assert forecast(bad, data["months"], data["as_of"])["held"]
    import pytest
    with pytest.raises(ValueError):
        forecast(data["items"][0], data["months"], data["as_of"], 13)


def test_linear_runout_day_minus_supplier_days_and_zero_unknown():
    item = dict(sku='FAKE', name='Fake', unit='ea', on_hand=5, supplier_days=3,
                monthly_sales=[10] * 7, receipts={})
    months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    result = forecast(item, months, '2026-10-31')
    assert result['runout_day'] == '2026-11-15'
    assert result['order_by'] == '2026-11-12'
    assert forecast({**item, 'supplier_days': 0}, months, '2026-10-31')['order_by'] == '2026-11-15'
    assert forecast({**item, 'receipts': []}, months, '2026-10-31')['held']


@pytest.mark.parametrize("sales", [[0] * 7, [10, 20, 30, 0, 0, 0, 0]])
def test_zero_recent_actual_sales_has_a_distinct_backtest_grade(sales):
    assert backtest(sales) == {"error_percent": None, "grade": "No recent sales to check"}


@pytest.mark.parametrize("supplier_days, expected", [(16, True), (15, True), (14, False), (0, False), (None, False)])
def test_order_overdue_is_true_only_before_as_of(supplier_days, expected):
    data = load_sample()
    item = {**data["items"][0], "on_hand": 5, "monthly_sales": [10] * len(data["months"]),
            "supplier_days": supplier_days, "receipts": {}}
    result = forecast(item, data["months"], data["as_of"])
    assert result["order_overdue"] is expected


def test_order_overdue_is_false_without_runout():
    data = load_sample()
    item = {**data["items"][0], "on_hand": 1000000}
    result = forecast(item, data["months"], data["as_of"])
    assert result["order_by"] == '3181-06-28'
    assert result["runout_day"] > result["projection"][-1]["month"] + '-31'
    assert result["order_overdue"] is False


@pytest.mark.parametrize("receipts", [None, [], "invalid", 3])
def test_non_object_receipts_hold_preserves_item_name(receipts):
    data = load_sample()
    item = {**data["items"][0], "receipts": receipts}
    assert forecast(item, data["months"], data["as_of"]) == {
        "sku": item["sku"], "name": item["name"], "held": True,
        "reason": "Receipts must be an object keyed by month.",
    }


def test_source_unit_conversion_hold_reason_prevents_forecasting():
    data = load_sample()
    reason = "Some moves use a unit that cannot be converted."
    item = {**data["items"][0], "hold_reason": reason}
    assert validate_item(item) == reason
    assert forecast(item, data["months"], data["as_of"]) == {
        "sku": item["sku"], "name": item["name"], "held": True, "reason": reason,
    }

# Seasonal-only packet, narrowed by owner: historical backtest is unchanged.
@pytest.mark.parametrize('sales,seasonal,first,second,level', [
    ([50, 150] + [100] * 10, True, 50, 150, 100),
    ([0, 1000] + [10] * 10, True, 10, 40, 20),
    ([0] * 12, True, 0, 0, 0),
    ([0.1] * 12, True, 0.1, 0.1, 0.1),
    ([10] * 11, False, 10, 10, 10),
    ([1.0000000000000002] * 3, False, 1.0000000000000002, 1.0000000000000002, 1.0000000000000002),
])
def test_seasonal_factors_clamp_zero_fraction_fallback(sales, seasonal, first, second, level):
    from stock_runway.engine import legacy_demand_model as demand_model, month_demand
    model = demand_model(sales, '2026-12')
    assert model['seasonal'] is seasonal
    assert model['level'] == pytest.approx(level)
    assert all(0.5 <= f <= 2 for f in model['factors'])
    assert month_demand(model, '2027-01') == first
    assert month_demand(model, '2027-02') == second
    if sales == [50, 150] + [100] * 10:
        assert model['factors'] == [0.5, 1.5] + [1] * 10
    if not any(sales):
        assert model['factors'] == [1] * 12


@pytest.mark.parametrize('sales,stock,runout', [
    ([150, 50] + [100] * 10, 75, '2027-01-24'),
    ([50, 150] + [100] * 10, 75, '2027-01-24'),
])
def test_seasonal_runout_interpolates_using_crossing_month(sales, stock, runout):
    from stock_runway.engine import month_after
    months = [month_after('2026-01', i) for i in range(12)]
    item = dict(sku='SYN', name='Synthetic', unit='m', on_hand=stock, supplier_days=0,
                monthly_sales=sales, receipts={})
    result = forecast(item, months, '2026-12-31', 6)
    assert result['seasonal'] is False
    assert result['runout_day'] == runout
    assert result['monthly_demand'] == 100


def test_seasonal_sample_oracle_and_fallback_explanation():
    data = load_sample()
    result = forecast(data['items'][0], data['months'], data['as_of'])
    assert [r['demand'] for r in result['projection']] == [866 / 12] * 6
    assert result['runout_day'] == '2027-03-23'
    item = {**data['items'][0], 'monthly_sales': [10, 20, 30]}
    short = forecast(item, data['months'][-3:], data['as_of'])
    assert short['seasonal'] is False
    assert short['forecast_explanation'] == 'Steady: 12-month average'
    assert [r['demand'] for r in short['projection']] == [20] * 6
