"""Purchase guidance contract, with fixed clocks and synthetic/local data only."""
import importlib.util
import json
from pathlib import Path
import sys
from datetime import date

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "guidance_test_package"
spec = importlib.util.spec_from_file_location(PACKAGE, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
package = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = package
spec.loader.exec_module(package)
engine = __import__(PACKAGE + ".engine", fromlist=["engine"])
sources = __import__(PACKAGE + ".sources", fromlist=["sources"])
tools = __import__(PACKAGE + ".tools", fromlist=["tools"])
commands = __import__(PACKAGE + ".commands", fromlist=["commands"])


def item(**changes):
    return {"sku": "A", "name": "Synthetic", "unit": "ea", "on_hand": 10,
            "monthly_sales": [30, 30, 30], "monthly_demand": 30, "seasonal": False,
            "as_of": "2026-10-31", "receipts": {}, **changes}


def test_sample_guidance_dates_buckets_and_unchanged_legacy():
    data = sources.load_sample()
    expected = {"SEAL-CLR-300": (144, "2027-02-23", "healthy"),
                "UL-FOAM-GRN": (38, "now", "order"),
                "GRT-GRY-5": (185, "now", "order"),
                "TRM-ALU-25": (16, "2027-02-16", "healthy"),
                "SEAL-WHT-300": (0, None, "no-sales")}
    for raw in data["items"]:
        row = engine.forecast(raw, data["months"], data["as_of"], today="2026-11-12")
        combined = {**raw, **row, "as_of": data["as_of"]}
        guidance = engine.order_guidance(combined, "2026-11-12")
        amount, due, bucket = expected[raw["sku"]]
        assert guidance["quantity"] == amount
        assert guidance["order_by"] == due
        assert engine.order_bucket(combined, "2026-11-12") == bucket
        assert "guidance" not in row  # Purchase DTO remains a separate boundary.
        # Public row timing must now be the exact guidance-derived timing.
        assert row["order_by"] == guidance["order_by"]
        assert row["runout_day"] == guidance["runout_date"]


@pytest.mark.parametrize("changes,settings,reason", [
    ({"held": True, "reason": "Check input"}, {}, "Check input"),
    ({"on_hand": -1}, {}, "Needs a valid stock date, stock and forecast."),
    ({}, {"default_delivery_days": None}, "No delivery time — set one in Advanced"),
    ({"receipts": {"2026-13": 2}}, {}, "Confirmed delivery data needs checking."),
    ({}, {"product_overrides": {"A": {"pack_size": .0000001}}},
     "Pack size must be from 0.000001 to 1000000000000, with at most six decimal places."),
])
def test_needs_data(changes, settings, reason):
    assert engine.order_guidance(item(**changes), "2026-11-12", settings) == {"status": "needs-data", "reason": reason}
    assert engine.order_bucket(item(**changes), "2026-11-12", settings) == "needs-data"


def test_receipt_preserves_first_gap_and_exact_sentences():
    source = item(on_hand=1, receipts={"2026-12": 200})
    guidance = engine.order_guidance(source, "2026-11-12")
    assert guidance["delivery_date"] == "2026-12-01"
    assert guidance["gap_date"] == "2026-11-01"
    assert guidance["out_of_stock"] is True
    assert engine.shortage_sentence(source, guidance) == "Short from 1 Nov 2026 until the Dec delivery of 200 ea."
    assert engine.no_order_sentence(source, guidance) == "Out of stock — No extra order needed for the selected cover period."


def test_skips_expire_and_new_snapshots_clear_them_without_changing_bucket():
    settings = {"skipped_items": {"A": {"reason": "Already ordered", "skipped_on": "2026-11-01", "as_of": "2026-10-31"}}}
    assert engine.active_skip(settings, "A", "2026-11-12", "2026-10-31") == settings["skipped_items"]["A"]
    assert engine.active_skip(settings, "A", "2026-11-15", "2026-10-31") is None
    assert engine.active_skip(settings, "A", "2026-11-12", "2026-11-30") is None
    assert engine.order_bucket(item(), "2026-11-12", settings) == "order"


def test_incoming_covers_everything_and_fractional_packs():
    source = item(on_hand=30, on_order=100)
    shifted = engine.order_guidance(source, "2026-11-01")
    # Undated supply moves the trigger and hence the purchase window; it no
    # longer forces quantity zero simply because it covers the old window.
    assert shifted['quantity'] == 60
    assert shifted['order_date'] == shifted['order_by']
    assert shifted['undated_on_order_assumed_within_lead'] is True
    assert shifted['runout_date'] == '2026-11-30'
    guidance = engine.order_guidance(source, "2026-11-01", {'months_of_cover': 0})
    assert guidance["quantity"] == 0
    assert engine.order_bucket(source, "2026-11-01", {'months_of_cover': 0}) == "healthy"
    assert engine.no_order_sentence(source, guidance) == "No extra order needed — incoming stock covers the order period."
    guidance = engine.order_guidance(item(on_hand=.2), "2026-11-12", {"product_overrides": {"A": {"pack_size": .125, "minimum_order": 1.375}}})
    assert guidance["quantity"] * 8 == int(guidance["quantity"] * 8)


def test_chat_additive_guidance_keeps_legacy_summary_and_card():
    payload = json.loads(tools.make_handler(today=date(2026, 11, 12))({}))
    by_sku = {row["sku"]: row for row in payload["items"]}
    assert by_sku["SEAL-CLR-300"]["guidance"]["order_by"] == "2027-02-23"
    assert "SEAL-CLR-300: Order 144 units by 23 Feb 2027; OK" in payload["purchase_summary"]
    assert any("Order 38 m now; Order now" in line for line in payload["purchase_summary"])
    assert payload["summary"][0].startswith("SEAL-CLR-300: runs out Mar 2027;")
    assert payload["card"].startswith('::stock-runway{data="')
    output = commands.format_result(payload)
    assert "Order 144 units by 23 Feb 2027; OK" in output
    assert "Purchase guidance (Desktop rules)" in output
    assert "Order 38 m now; Order now" in output


MALFORMED_SETTINGS = [None, "bad", "6", False, True, -1, [], [6]] + [
    {key: value}
    for key in ("big_order_months", "default_delivery_days", "months_of_cover",
                "overstock_months", "urgent_days", "running_low_days", "service_level",
                "review_days", "order_cost", "holding_pct", "include_backup_in_orders",
                "product_overrides")
    for value in ("bad", "6", False, -1, float("nan"), float("inf"), [], {})
    if not (key == 'include_backup_in_orders' and value is False)
] + [{key: None} for key in ("big_order_months", "months_of_cover", "overstock_months",
    "urgent_days", "running_low_days", "service_level", "review_days", "order_cost",
    "holding_pct", "include_backup_in_orders", "product_overrides")]


@pytest.mark.parametrize("settings", MALFORMED_SETTINGS)
def test_malformed_settings_tool_uses_defaults(settings):
    handler = tools.make_handler(today=date(2026, 11, 12))
    baseline = json.loads(handler({}))
    payload = json.loads(handler({"settings": settings}))
    assert "error" not in payload
    assert payload["purchase_summary"] == baseline["purchase_summary"]
    assert payload["card"] == baseline["card"]
    for row, default in zip(payload["items"], baseline["items"]):
        assert not row.get("held")
        assert row["order_bucket"] == default["order_bucket"]
        # Explicit big_order_months still opts into additive safety keys.
        assert {k: v for k, v in row["guidance"].items()
                if k not in ("inventory_position", "covered_by_on_order", "big_order")} == default["guidance"]
    text = commands.format_result(payload)
    assert "Order 144 units by 23 Feb 2027; OK" in text


@pytest.mark.parametrize("threshold", [None, "bad", "6", "", False, True, -1,
    float("nan"), float("inf"), -float("inf"), [], {}, [6]])
def test_malformed_threshold_preserves_large_order_warning(threshold):
    handler = tools.make_handler(today=date(2026, 11, 12))
    baseline = json.loads(handler({"settings": {"months_of_cover": 12}}))
    payload = json.loads(handler({"settings": {"months_of_cover": 12, "big_order_months": threshold}}))
    assert "error" not in payload
    assert any("Check this order:" in line for line in baseline["purchase_summary"])
    assert payload["purchase_summary"] == baseline["purchase_summary"]


def test_null_delivery_setting_is_intentionally_not_a_default():
    source = item()
    assert engine.order_guidance(source, "2026-11-12", {"default_delivery_days": None}) == {
        "status": "needs-data", "reason": "No delivery time — set one in Advanced"}


def test_september_guidance_date_is_locale_independent(monkeypatch):
    monkeypatch.setattr(engine.calendar, "month_abbr", ["wrong"] * 13)
    assert engine.format_guidance_date("2027-09-16") == "16 Sept 2027"
    # month_label is intentionally outside the en-GB date formatter's scope.


def test_tool_json_integral_numbers_stay_integers():
    payload = json.loads(tools.make_handler(today=date(2026, 11, 12))({}))
    assert type(payload["items"][0]["guidance"]["quantity"]) is int
    assert tools._json_safe({"int": 7860.0, "fraction": .000001,
                             "bad": float("inf"), "bool": True}) == {
        "int": 7860, "fraction": .000001, "bad": None, "bool": True}
    assert type(tools._json_safe(7860.0)) is int


@pytest.mark.parametrize("failing", ["order_guidance", "order_bucket"])
def test_guidance_failure_preserves_legacy_forecast(monkeypatch, failing):
    handler = tools.make_handler(today=date(2026, 11, 12))
    baseline = json.loads(handler({}))
    def fail(*args, **kwargs):
        raise RuntimeError("private exception must never be exposed")
    monkeypatch.setattr(tools, failing, fail)
    payload = json.loads(handler({}))
    assert "error" not in payload
    assert payload["summary"] == baseline["summary"]
    assert payload["card"] == baseline["card"]
    for row, original in zip(payload["items"], baseline["items"]):
        # This flag belongs to purchase guidance, not the physical forecast.
        # The intermittent sample now exercises a genuine large-order warning.
        assert row["big_order"] is (False if failing == "order_guidance" else original["big_order"])
        assert {k:v for k,v in row.items() if k not in ("guidance", "order_bucket", "big_order")} == {
            k:v for k,v in original.items() if k not in ("guidance", "order_bucket", "big_order")}
        assert row["guidance"] == {"status":"needs-data", "reason":"Couldn't calculate purchase guidance: check this item's data."}
        assert row["order_bucket"] == "needs-data"
    assert all("Not enough history" in line for line in payload["purchase_summary"])
    assert "private exception" not in json.dumps(payload)


def test_tool_computes_guidance_once_per_item(monkeypatch):
    calls = []
    original = tools.order_guidance
    def counted(*args, **kwargs):
        calls.append(args[0]["sku"])
        return original(*args, **kwargs)
    monkeypatch.setattr(tools, "order_guidance", counted)
    # forecast() now intentionally derives its row dates from engine guidance.
    # Track both boundaries: one engine call for row dates, one tools call for
    # the purchase DTO; order_bucket must not add a third calculation.
    internal_calls = []
    internal = engine.order_guidance
    def internal_counted(*args, **kwargs):
        internal_calls.append(args[0]['sku'])
        return internal(*args, **kwargs)
    monkeypatch.setattr(engine, 'order_guidance', internal_counted)
    payload = json.loads(tools.make_handler(today=date(2026, 11, 12))({}))
    assert len(calls) == len(internal_calls) == len(payload["items"])
    assert all(row["order_bucket"] != "needs-data" for row in payload["items"])
