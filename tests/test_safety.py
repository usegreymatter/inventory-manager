"""Safety opt-ins: incoming inventory, large purchases and stale sales data."""
import csv
from datetime import date
import json
from pathlib import Path
import sys
import types

import pytest
from policy_assertions import FORECAST_POLICY_FIELDS, assert_guidance_dates

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)
from stock_runway import engine, sources, tools, commands

MONTHS = ["2026-08", "2026-09", "2026-10"]
AS_OF = "2026-10-31"
ALIASES = ["on order", "qty on order", "quantity on order", "on po", "open po qty",
           "incoming", "incoming qty", "ordered qty", "expected", "in transit"]


def item(**changes):
    return {"sku": "A", "name": "Test item", "unit": "ea", "on_hand": 30,
            "supplier_days": 10, "monthly_sales": [30, 30, 30], "receipts": {}, **changes}


def test_incoming_requires_ascii_number_syntax(tmp_path):
    headers = ['sku', 'name', 'unit', 'on_hand', 'supplier_days', 'on_order', *MONTHS]
    path = write_csv(tmp_path, headers, ['A', 'Test', 'ea', '30', '10', '١٢', '30', '30', '30'])
    with pytest.raises(sources.SourceError, match='on_order must be a number'):
        sources.load_csv(path)


def write_csv(tmp_path, headers, row):
    path = tmp_path / "stock.csv"
    with path.open("w", newline="") as handle:
        csv.writer(handle).writerows([headers, row])
    return str(path)


@pytest.mark.parametrize("category", [False, True])
def test_canonical_csv_optional_incoming(tmp_path, category):
    headers = ["sku", "name", "unit", "on_hand", "supplier_days"]
    row = ["A", "Test", "ea", "30", "10"]
    if category:
        headers += ["category"]
        row += ["Parts"]
    data = sources.load_csv(write_csv(tmp_path, headers + ["on_order"] + MONTHS,
                                     row + ["12.5", "30", "30", "30"]))
    assert data["items"][0]["on_order"] == 12.5
    assert data["months"] == MONTHS


@pytest.mark.parametrize("alias", ALIASES)
def test_erp_incoming_aliases_normalize_after_category(alias, tmp_path):
    headers = [alias, "Category", "Item Code", "Item Name", "Qty On Hand", *MONTHS]
    row = ["1,234.5", "Parts", "A", "Test", "30", "30", "30", "30"]
    normalized = sources.normalize_erp_rows([headers, row])
    assert normalized[0] == ["sku", "name", "unit", "on_hand", "supplier_days", "category", "on_order", *MONTHS]
    assert sources.load_csv(write_csv(tmp_path, headers, row))["items"][0]["on_order"] == 1234.5


@pytest.mark.parametrize("bad,reason", [("-1", "non-negative"),
    ("NaN", "number"), ("1e309", "non-negative"), ("1000000000001", "no greater")])
def test_csv_invalid_incoming_rejected(tmp_path, bad, reason):
    path = write_csv(tmp_path, ["sku", "name", "unit", "on_hand", "supplier_days", "on_order", *MONTHS],
                     ["A", "Test", "ea", "30", "10", bad, "30", "30", "30"])
    with pytest.raises(sources.SourceError, match=reason):
        sources.load_csv(path)


def test_csv_duplicate_incoming_rejected(tmp_path):
    path = write_csv(tmp_path, ["sku", "name", "unit", "on_hand", "supplier_days", "on_order", "on_order", *MONTHS],
                     ["A", "Test", "ea", "30", "10", "2", "3", "30", "30", "30"])
    with pytest.raises(sources.SourceError, match="On order column must be unique"):
        sources.load_csv(path)


def test_missing_incoming_column_stays_absent(tmp_path):
    data = sources.load_csv(write_csv(tmp_path, ["sku", "name", "unit", "on_hand", "supplier_days", *MONTHS],
                                     ["A", "Test", "ea", "30", "10", "30", "30", "30"]))
    assert "on_order" not in data["items"][0]


@pytest.mark.parametrize("incoming", [-1, True, None, "3", float("nan"), float("inf"), 1000000000001])
def test_direct_invalid_incoming_holds_item(incoming):
    result = engine.forecast(item(on_order=incoming), MONTHS, AS_OF)
    assert result["held"] is True
    assert "On order" in result["reason"]


def test_purchase_rounding_subtracts_incoming_before_backup_moq_and_packs():
    assert engine.suggested_order_quantity(100, 20, [10], {"pack_size": 24}, on_order=40) == 48
    assert engine.suggested_order_quantity(100, 20, [10], {"pack_size": 24}, on_order=40,
        safety_stock=30, include_backup_in_orders=True) == 72
    assert engine.suggested_order_quantity(100, 20, [], {"minimum_order": 100}, on_order=80) == 0
    assert engine.suggested_order_quantity(.3, .1, [], {"pack_size": .1}, on_order=.1) == .1


@pytest.mark.parametrize("bad", [-1, 0, True, "6", float("inf"), 121, 10**400])
def test_invalid_big_order_setting_uses_six_month_default(bad):
    assert engine.normalize_order_settings({"big_order_months": bad})["big_order_months"] == 6


def test_big_order_setting_accepts_fractional_positive_months():
    assert engine.normalize_order_settings({})["big_order_months"] == 6
    assert engine.normalize_order_settings({"big_order_months": .5})["big_order_months"] == .5


def test_incoming_changes_only_optional_purchase_plan_not_physical_forecast():
    legacy = engine.forecast(item(), MONTHS, AS_OF)
    result = engine.forecast(item(on_order=20), MONTHS, AS_OF)
    assert all(result[key] == value for key, value in legacy.items() if key not in FORECAST_POLICY_FIELDS)
    assert_guidance_dates(engine,item(on_order=20),result,AS_OF)
    assert result["inventory_position"] == 50
    assert result["on_order"] == 20
    # Physical runout Nov 30 -> order Nov 20 -> cover through Jan 29.
    assert result["suggested_order"] == 61
    assert result["covered_by_on_order"] is True
    assert result["big_order"] is False


@pytest.mark.parametrize("lead,covered", [(0, True), (10, True), (30, True), (30.1, False), (31, False)])
def test_incoming_only_covers_runout_when_arriving_by_physical_runout(lead, covered):
    result = engine.forecast(item(on_order=100, supplier_days=lead), MONTHS, AS_OF)
    assert result["suggested_order"] == 60  # Incoming defers BOTH timing and cover window.
    assert result["covered_by_on_order"] is covered
    assert result["runout_day"] == "2026-11-30"


def test_unknown_delivery_cannot_claim_incoming_coverage():
    result = engine.forecast(item(on_order=100, supplier_days=None), MONTHS, AS_OF,
                             settings={"default_delivery_days": None})
    assert result["held"] is False
    assert result["suggested_order"] is None
    assert result["covered_by_on_order"] is False
    assert result["big_order"] is False


def test_incoming_coverage_uses_runout_beyond_displayed_horizon():
    result = engine.forecast(item(on_hand=1000, on_order=100), MONTHS, AS_OF)
    assert result["runout_day"] == '2029-08-11'
    assert result["runout_day"][:7] > result["projection"][-1]["month"]
    assert result["covered_by_on_order"] is True


@pytest.mark.parametrize("minimum,big", [(180, False), (181, True)])
def test_big_order_compares_final_purchase_strictly_above_months_of_forecast(minimum, big):
    result = engine.forecast(item(on_hand=0), MONTHS, AS_OF, settings={
        "big_order_months": 6, "product_overrides": {"A": {"minimum_order": minimum}}})
    assert result["suggested_order"] == minimum
    assert result["big_order"] is big


def test_large_order_threshold_setting_is_used_independently_of_overstock():
    result = engine.forecast(item(on_hand=0), MONTHS, AS_OF,
                             settings={"big_order_months": .5, "overstock_months": 120})
    assert result["suggested_order"] == 69
    assert result["big_order"] is True


def test_zero_sales_never_flags_big_order_without_positive_purchase():
    result = engine.forecast(item(on_hand=0, on_order=0, monthly_sales=[0, 0, 0]), MONTHS, AS_OF,
                             settings={"product_overrides": {"A": {"minimum_order": 999}}})
    assert result["suggested_order"] == 0
    assert result["big_order"] is False


@pytest.mark.parametrize("settings", [None, {}, {"order_cost": 15}, {"months_of_cover": 3}])
def test_no_safety_opt_in_keeps_existing_forecast_bytes(settings):
    source = item()
    expected = engine._forecast(source, MONTHS, AS_OF, 6)
    expected.update(engine.inventory_planning(source, MONTHS[-1], settings))
    result = engine.forecast(source, MONTHS, AS_OF, settings=settings)
    assert json.dumps(result, separators=(",", ":")) == json.dumps(expected, separators=(",", ":"))
    assert not {"suggested_order", "covered_by_on_order", "big_order", "inventory_position"} & result.keys()


def test_invalid_pack_keeps_physical_forecast_and_suppresses_optional_purchase():
    result = engine.forecast(item(on_order=1), MONTHS, AS_OF,
                             settings={"product_overrides": {"A": {"pack_size": -2}}})
    assert result["held"] is False
    assert result["suggested_order"] is None
    assert result["covered_by_on_order"] is False
    assert result["big_order"] is False


def test_optional_purchase_includes_only_receipts_due_inside_the_cover_window():
    source = item(on_hand=.1, on_order=.1, monthly_sales=[3, 3, 3], supplier_days=0,
                  receipts={"2026-11": .1, "2026-12": .1, "2027-01": 100})
    settings = {"months_of_cover": 1, "product_overrides": {"A": {"pack_size": .1}}}
    result = engine.forecast(source, MONTHS, AS_OF, settings=settings)
    # Endpoint Dec3: demand 3+9/31 less .1 stock, .1 undated, and
    # Nov/Dec receipts .1 each => 2.8903..., rounded to a .1 pack = 2.9.
    assert result["suggested_order"] == 2.9
    without_january = {**source, "receipts": {"2026-11": .1, "2026-12": .1}}
    assert engine.forecast(without_january, MONTHS, AS_OF, settings=settings)["suggested_order"] == 2.9
    inside_window = {**source, "receipts": {"2026-11": .1, "2026-12": 100}}
    # Large December receipt leaves the prefix just before Dec1 binding:
    # 3+3/31-.3 = 2.79677..., rounded to a .1 pack = 2.8.
    assert engine.forecast(inside_window, MONTHS, AS_OF, settings=settings)["suggested_order"] == 2.8


def source_data(**changes):
    return {"months": MONTHS, "as_of": AS_OF, "items": [item()], **changes}


@pytest.mark.parametrize("today,age,warn", [(date(2026, 12, 15), 45, False),
    (date(2026, 12, 16), 46, True), (date(2026, 11, 1), 1, False),
    (date(2026, 10, 1), 0, False)])
def test_tool_age_and_slash_warning_use_injected_today(monkeypatch, today, age, warn):
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data())
    handler = tools.make_handler(today=today)
    payload = json.loads(handler({}))
    assert payload["data_age_days"] == age
    rendered = commands.make_command(handler)()
    warning = f"Your sales data ends Oct 2026 ({age} days ago). Numbers may be out of date — load a newer file."
    assert (warning in rendered) is warn
    if warn:
        assert "Warning: sales data is" not in rendered


def test_age_uses_latest_sales_month_end_not_snapshot_date(monkeypatch):
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(as_of="2026-11-30"))
    result = json.loads(tools.make_handler(today=date(2026, 12, 16))({}))
    assert result["data_age_days"] == 46
    assert "Your sales data ends Oct 2026 (46 days ago)." in commands.format_result(result)


def test_default_age_reads_live_today_each_invocation(monkeypatch):
    class Clock(date):
        current = date(2026, 12, 15)

        @classmethod
        def today(cls):
            return cls.current

    monkeypatch.setattr(tools, "date", Clock)
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data())
    handler = tools.make_handler()
    assert json.loads(handler({}))["data_age_days"] == 45
    Clock.current = date(2026, 12, 16)
    assert json.loads(handler({}))["data_age_days"] == 46


def test_bad_sales_month_omits_age_without_breaking_held_results(monkeypatch):
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(months=["bad"]))
    result = json.loads(tools.make_handler(today=date(2026, 12, 16))({}))
    assert "data_age_days" not in result
    assert result["items"][0]["held"] is True


def test_tool_discloses_incoming_without_claiming_physical_receipt(monkeypatch):
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(items=[item(on_order=100)]))
    payload = json.loads(tools.make_handler(today=date(2026, 11, 1))({}))
    assert "assumes nothing is on order" not in payload["disclosure"]
    assert "purchase planning only" in payload["disclosure"]
    assert "physical run-out excludes undated incoming" in payload["disclosure"]
    assert "Suggested order 60" in payload["summary"][0]
    assert "On-order stock covers the risk of running out" in payload["summary"][0]


def test_tool_large_order_warning_is_visible_only_on_flagged_items(monkeypatch):
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(items=[item(on_hand=0)]))
    handler = tools.make_handler(today=date(2026, 11, 1))
    result = json.loads(handler({"settings": {"big_order_months": .5}}))
    assert "Check this order:" in result["summary"][0]
    assert "Check this order:" not in json.loads(handler({}))["summary"][0]


def test_tool_schema_exposes_purchase_safety_settings():
    settings = tools.TOOL_SCHEMA["parameters"]["properties"]["settings"]["properties"]
    assert settings["big_order_months"] == {"type": "number", "minimum": .1, "maximum": 120, "default": 6}
    assert settings["months_of_cover"]["default"] == 2


def test_no_sales_incoming_does_not_claim_to_cover_a_demand_runout():
    result = engine.forecast(item(on_hand=0, on_order=100, supplier_days=0,
                                  monthly_sales=[0, 0, 0]), MONTHS, AS_OF)
    assert result["covered_by_on_order"] is False


@pytest.mark.parametrize("canonical", [False, True])
@pytest.mark.parametrize("blank", ["", "   "])
def test_blank_incoming_is_absent_per_item(tmp_path, canonical, blank):
    headers = (["sku", "name", "unit", "on_hand", "supplier_days", "on_order", *MONTHS]
               if canonical else ["Item Code", "Item Name", "UoM", "Qty On Hand", "Lead Time", "Incoming", *MONTHS])
    first = ["A", "Test", "ea", "30", "10", blank, "30", "30", "30"]
    second = ["B", "Other", "ea", "30", "10", "12", "30", "30", "30"]
    path = tmp_path / "stock.csv"
    with path.open("w", newline="") as handle:
        csv.writer(handle).writerows([headers, first, second])
    rows = sources.load_csv(str(path))["items"]
    assert "on_order" not in rows[0]
    assert rows[1]["on_order"] == 12


@pytest.mark.parametrize("values", [["2026-11-01", "2026-12-01"], ["", "   "], ["unconfirmed", "unknown"]])
def test_fully_nonnumeric_erp_incoming_alias_is_ignored(tmp_path, values):
    headers = ["Item Code", "Item Name", "Qty On Hand", "Expected", *MONTHS]
    rows = [headers] + [[sku, "Test", "30", value, "30", "30", "30"]
                        for sku, value in zip(["A", "B"], values)]
    assert "on_order" not in sources.normalize_erp_rows(rows)[0]
    path = tmp_path / "stock.csv"
    with path.open("w", newline="") as handle:
        csv.writer(handle).writerows(rows)
    assert all("on_order" not in row for row in sources.load_csv(str(path))["items"])


@pytest.mark.parametrize("header,values", [("Incoming", ["12", "unknown"]), ("on_order", ["unknown", "unknown"])])
def test_invalid_incoming_is_not_discarded_when_canonical_or_mixed(tmp_path, header, values):
    path = tmp_path / "stock.csv"
    with path.open("w", newline="") as handle:
        csv.writer(handle).writerows([["Item Code", "Item Name", "Qty On Hand", header, *MONTHS]] +
            [[sku, "Test", "30", value, "30", "30", "30"] for sku, value in zip(["A", "B"], values)])
    with pytest.raises(sources.SourceError, match="on_order must be a number"):
        sources.load_csv(str(path), strict=True)


def test_safety_quantity_uses_same_deferred_position_window_as_timing():
    for incoming, quantity in [(0, 59), (20, 61), (40, 62)]:
        row = engine.forecast(item(on_order=incoming), MONTHS, AS_OF)
        assert row["suggested_order"] == quantity


def test_today_moves_safety_quantity_window_without_changing_physical_forecast():
    source = item(on_order=20)
    snapshot = engine.forecast(source, MONTHS, AS_OF)
    later = engine.forecast(source, MONTHS, AS_OF, today="2026-12-16")
    assert later["suggested_order"] == 66
    assert later["covered_by_on_order"] is False
    for key in ("projection", "runout_day", "monthly_demand"):
        assert later[key] == snapshot[key]


def test_safety_runout_is_independent_of_display_horizon():
    source = item(on_hand=300, on_order=20)
    short = engine.forecast(source, MONTHS, AS_OF, 1)
    long = engine.forecast(source, MONTHS, AS_OF, 12)
    assert short["runout_day"] == long["runout_day"] == '2027-08-31'
    assert short["order_by"] == long["order_by"]
    assert len(short["projection"]) == 1 and len(long["projection"]) == 12
    assert short["suggested_order"] == long["suggested_order"] == 59
    assert short["covered_by_on_order"] is True


def test_safety_applies_backup_then_raw_minimum_and_pack_to_calendar_need():
    source = item(on_order=20, monthly_sales=[0, 30, 60])
    row = engine.forecast(source, MONTHS, AS_OF, settings={"include_backup_in_orders": True,
        "product_overrides": {"A": {"minimum_order": 100, "pack_size": 24}}})
    assert row["suggested_order"] == 120
    assert row["covered_by_on_order"] is True


def test_tool_passes_clock_to_safety_and_always_exposes_big_order(monkeypatch):
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(items=[item(on_order=20)]))
    row = json.loads(tools.make_handler(today=date(2026, 12, 16))({}))["items"][0]
    assert row["suggested_order"] == 66
    assert row["covered_by_on_order"] is False
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(items=[item(), item(sku="B", on_hand=-1)]))
    payload = json.loads(tools.make_handler(today=date(2026, 11, 1))({}))
    assert [row["big_order"] for row in payload["items"]] == [False, False]
    assert "suggested_order" not in payload["items"][0]
    assert payload["summary"][0] == tools._line(engine.forecast(item(), MONTHS, AS_OF), 6, item())


def test_tool_computes_default_big_order_without_exposing_other_safety_fields(monkeypatch):
    source = item(on_hand=0, supplier_days=365)
    monkeypatch.setattr(tools, "load_sample", lambda _: source_data(items=[source]))
    payload = json.loads(tools.make_handler(today=date(2026, 11, 1))({}))
    assert payload["items"][0]["big_order"] is True
    assert "suggested_order" not in payload["items"][0]
    assert payload["summary"][0] == tools._line(engine.forecast(source, MONTHS, AS_OF), 6, source)


def test_incoming_feature_cannot_hold_valid_forecast_at_calendar_boundary():
    result = engine.forecast(item(on_order=1, supplier_days=3650),
        ["9998-10", "9998-11", "9998-12"], "9998-12-31", 12)
    assert result["held"] is False
    assert result["suggested_order"] is None
    assert result["covered_by_on_order"] is False
