"""Plain-language planning: independent formula oracles and default regression."""
import calendar
import json
import math
from pathlib import Path
import sys
import types

import pytest
from policy_assertions import without_policy, assert_guidance_dates
from test_legacy_unchanged import legacy_engine

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)
from stock_runway import engine
from stock_runway.sources import load_sample
from stock_runway.tools import make_handler
from stock_runway.commands import make_command

MONTHS = ["2026-08", "2026-09", "2026-10"]
AS_OF = "2026-10-31"
FIELDS = ("demand_swing", "safety_stock", "reorder_point", "eoq", "why")


def item(**extra):
    return dict(sku="TEST", name="Test item", unit="units", on_hand=100,
                monthly_sales=[60, 90, 120], supplier_days=14, **extra)


def test_sample_swing_backup_and_prorated_reorder():
    row = engine.forecast(item(), MONTHS, AS_OF)
    sigma = 30  # Sample SD: sqrt((900 + 0 + 900) / (3 - 1)).
    assert row["demand_swing"] == sigma
    assert row["safety_stock"] == math.ceil(1.6449 * sigma * math.sqrt(44 / 30))
    assert row["reorder_point"] == math.ceil(90 * 14 / 30 + row["safety_stock"])
    assert row["eoq"] is None
    assert "sales are up and down" in row["why"]
    assert "Best order size" not in row["why"]


@pytest.mark.parametrize("service,z", [(0.90, 1.2816), (0.95, 1.6449), (0.99, 2.3263)])
def test_service_level_review_and_source_lead(service, z):
    source = item()
    source["supplier_days"] = 7.5
    row = engine.forecast(source, MONTHS, AS_OF, settings={"service_level": service, "review_days": 7})
    assert row["safety_stock"] == math.ceil(z * 30 * math.sqrt(14.5 / 30))
    assert row["reorder_point"] == math.ceil(90 * math.ceil(7.5) / 30 + row["safety_stock"])


def test_eoq_annual_demand_minimum_and_fractional_pack():
    settings = {"order_cost": 15, "holding_pct": 20,
                "product_overrides": {"TEST": {"unit_cost": 1.2, "minimum_order": 1000, "pack_size": 24}}}
    row = engine.forecast(item(), MONTHS, AS_OF, settings=settings)
    raw = math.sqrt(2 * (90 * 12) * 15 / (1.2 * 0.2))
    assert raw < 1000
    assert row["eoq"] == 1008
    assert "EOQ 1,008" in row["why"]
    settings["product_overrides"]["TEST"].update(minimum_order=0.1, pack_size=0.25)
    assert engine.forecast(item(), MONTHS, AS_OF, settings=settings)["eoq"] == math.ceil(raw / 0.25) * 0.25


def test_last_twelve_only_and_seasonal_calendar_demand():
    data = load_sample(ROOT / "data/sample.json")
    source = data["items"][0]
    source = {**source, "supplier_days": 45, "unit_cost": 1.2}
    settings = {"order_cost": 15}
    row = engine.forecast(source, data["months"], data["as_of"], settings=settings)
    sales = source["monthly_sales"][-12:]
    avg = sum(sales) / len(sales)
    assert row["demand_swing"] == math.sqrt(sum((x - avg) ** 2 for x in sales) / (len(sales) - 1))
    model = engine.demand_model(sales, "2026-10")
    demand = engine.month_demand(model, "2026-11") + engine.month_demand(model, "2026-12") * 15 / 31
    assert row["reorder_point"] == math.ceil(demand + row["safety_stock"])
    annual = sum(engine.month_demand(model, engine.month_after("2026-10", i)) for i in range(1, 13))
    need = math.ceil(math.sqrt(2 * annual * 15 / (1.2 * .2)))
    assert row["eoq"] == math.ceil(max(need, source['minimum_order']) / source['pack_size']) * source['pack_size']
    longer = {**source, "monthly_sales": [999999] + sales}
    result = engine.inventory_planning(longer, "2026-10", settings)
    assert result["demand_swing"] == row["demand_swing"]


def test_null_inputs_zero_sales_and_unknown_lead():
    short = item()
    short["monthly_sales"] = [10, 20]
    assert engine.inventory_planning(short, "2026-10")["demand_swing"] is None
    source = item()
    source["supplier_days"] = None
    row = engine.forecast(source, MONTHS, AS_OF, settings={"default_delivery_days": None})
    assert row["safety_stock"] is None and row["reorder_point"] is None
    assert row["eoq"] is None and row["why"] == ""
    fallback = engine.forecast(source, MONTHS, AS_OF)
    assert fallback["safety_stock"] == engine.forecast(item(), MONTHS, AS_OF)["safety_stock"]
    zero = {**source, "supplier_days": 0, "monthly_sales": [0, 0, 0], "unit_cost": 1}
    row = engine.forecast(zero, MONTHS, AS_OF, settings={"order_cost": 15})
    assert [row[k] for k in FIELDS[:-1]] == [0, 0, 0, 0]


@pytest.mark.parametrize("settings", [{}, {"order_cost": 0}, {"order_cost": -1}, {"order_cost": float("inf")}, {"order_cost": 15, "product_overrides": {"TEST": {"unit_cost": 0}}}])
def test_missing_costs_suppress_best_size(settings):
    assert engine.forecast(item(), MONTHS, AS_OF, settings=settings)["eoq"] is None


def test_planning_uses_explicit_summation_without_changing_legacy_model(monkeypatch):
    source = {**item(), "unit_cost": 1.2}
    settings = {"order_cost": 15}
    expected = engine.inventory_planning(source, "2026-10", settings)
    legacy = engine.demand_model(source["monthly_sales"], "2026-10")
    # Model the builtin-sum algorithm changing between Python runtimes. Only
    # the optional planning path must be independent of that runtime choice.
    ordinary_sum = sum
    monkeypatch.setattr(engine, "sum", lambda values: ordinary_sum(values) + 1000, raising=False)
    assert engine.inventory_planning(source, "2026-10", settings) == expected
    assert engine.demand_model(source["monthly_sales"], "2026-10") == legacy


def test_corrupt_huge_settings_cannot_hold_valid_forecast():
    huge = 10 ** 400
    row = engine.forecast(item(), MONTHS, AS_OF, settings={"review_days": huge, "order_cost": huge,
        "service_level": huge, "product_overrides": {"TEST": {"unit_cost": huge}}})
    assert row["held"] is False
    assert row["runout_month"] == engine.forecast(item(), MONTHS, AS_OF)["runout_month"]


@pytest.mark.parametrize("bad", ["x", None, [], 5])
def test_corrupt_product_override_falls_back_to_source_cost(bad):
    row = engine.forecast({**item(), "unit_cost": 2}, MONTHS, AS_OF,
        settings={"order_cost": 50, "product_overrides": {"TEST": bad}})
    assert row["eoq"] == math.ceil(math.sqrt(2 * (90 * 12) * 50 / (2 * .2)))


def test_summary_preserves_large_integer_planning_values():
    from stock_runway.tools import _line
    source = {**item(), "monthly_sales": [1234567, 2345678, 1999999, 3000001], "supplier_days": 30}
    row = engine.forecast(source, ["2026-07"] + MONTHS, AS_OF)
    line = _line(row, 6)
    assert f"Safety stock — extra kept for delays or surprise demand: {row['safety_stock']:,}" in line
    assert f"Reorder point — order when stock drops to {row['reorder_point']:,}" in line


def test_why_keeps_large_order_sizes_and_small_delivery_times_in_plain_numbers():
    source = {**item(), "supplier_days": .000001, "unit_cost": .00000001}
    row = engine.forecast(source, MONTHS, AS_OF, settings={"order_cost": 15})
    assert "lead time is 0.000001 days" in row["why"]
    assert f"EOQ {int(row['eoq']):,}" in row["why"]


def test_ulp_correction_does_not_add_an_extra_unit():
    assert engine.planning_ceil(24.000000000000004) == 24
    assert engine.planning_ceil(24.000001) == 25


@pytest.mark.parametrize("include,expected", [(False, 48), (True, 96)])
def test_backup_opt_in_is_added_before_purchase_rounding(include, expected):
    assert engine.suggested_order_quantity(42, 0, [], {"pack_size": 24}, safety_stock=49,
                                           include_backup_in_orders=include) == expected
    assert engine.suggested_order_quantity(42, 0, [], {"minimum_order": 100, "pack_size": 24},
                                           safety_stock=49, include_backup_in_orders=include) == 120


def test_purchase_rounding_keeps_exact_positive_need_and_ignores_moq_at_zero():
    assert engine.suggested_order_quantity(24.000000000000004, 0, [], {}) == 24  # binary64 dust must not add a unit
    assert engine.suggested_order_quantity(24.000001, 0, [], {}) == 25
    assert engine.suggested_order_quantity(.3, .1, [.1], {"pack_size": .1}) == .1
    assert engine.suggested_order_quantity(0, 100, [], {"minimum_order": 100}) == 0


def test_settings_validation_matches_existing_fallback_convention():
    normalized = engine.normalize_order_settings({"service_level": .5, "review_days": -1, "order_cost": "15", "holding_pct": 0, "include_backup_in_orders": "true"})
    assert normalized["service_level"] == .95
    assert normalized["review_days"] == 30
    assert normalized["order_cost"] is None
    assert normalized["holding_pct"] == 20
    assert normalized["include_backup_in_orders"] is True


def test_default_forecasts_are_byte_identical_except_added_fields(legacy_engine):
    # Execute the vendored historical engine on the same synthetic inputs;
    # no output-only retired sample fixture is retained in the public tree.
    data = load_sample(ROOT / "data/sample.json")
    before = [legacy_engine.forecast(i, data['months'], data['as_of']) for i in data['items']]
    rows = [engine.forecast(i, data["months"], data["as_of"]) for i in data["items"]]
    strip = lambda row: without_policy({k: v for k, v in row.items() if k not in FIELDS})
    assert [strip(row) for row in rows] == [strip(row) for row in before]
    for raw,row in zip(data['items'],rows):
        assert_guidance_dates(engine,raw,row,data['as_of'])


def test_tool_settings_and_slash_short_planning_summary():
    handler = make_handler(sample_path=ROOT / "data/sample.json")
    data = load_sample(ROOT / "data/sample.json")
    settings = {"order_cost": 15, "product_overrides": {i["sku"]: {"unit_cost": 1.2} for i in data["items"]}}
    payload = json.loads(handler({"settings": settings}))
    assert all(set(FIELDS) <= row.keys() and row["eoq"] is not None for row in payload["items"])
    summary = make_command(handler)()
    assert "Safety stock — " in summary and "Reorder point — " in summary
    assert "Sales pattern: " in summary

@pytest.mark.parametrize("sigma,mean,expected", [
    (None, 100, None), (0, 0, "Steady"), (24.9, 100, "Steady"),
    (25, 100, "Up and down"), (59.9, 100, "Up and down"),
    (60, 100, "Very uneven"), (100, 0, "Very uneven"),
])
def test_sales_pattern_display_boundaries(sigma, mean, expected):
    assert engine.sales_pattern(sigma, mean) == expected


def test_why_standard_terms_group_values_and_omit_unknown_parts():
    row = engine.inventory_planning({**item(), "unit_cost": 1.2}, "2026-10", {"order_cost": 15})
    assert row["why"] == "Safety stock 60 because sales are up and down and lead time is 14 days. Reorder point 102. EOQ 368."
    assert engine.inventory_planning({**item(), "supplier_days": None}, "2026-10", {"default_delivery_days": None})["why"] == ""
    assert engine.planning_display_number(1234567890123) == "1,234,567,890,123"
    assert engine.planning_display_number(.000001) == "0.000001"
