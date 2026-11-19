import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)

import pytest

from stock_runway import tools
from stock_runway.tools import make_handler


def test_tool_returns_json_compact_lines_and_disclosure():
    handler = make_handler(sample_path=Path(__file__).parents[1] / "data" / "sample.json")
    payload = json.loads(handler({"source": "sample", "skus": ["SEAL-CLR-300"]}))
    assert payload["disclosure"] == "No receipts recorded; assumes nothing is on order."
    assert payload["items"][0]["sku"] == "SEAL-CLR-300"
    assert payload["summary"] == ["SEAL-CLR-300: runs out Mar 2027; Usable for planning; Sales pattern: Steady, Safety stock — extra kept for delays or surprise demand: 16, Reorder point — order when stock drops to 67"]


def test_tool_rejects_invalid_horizon():
    result = json.loads(make_handler()({"horizon": 0}))
    assert result["error"].startswith("Horizon")


@pytest.mark.parametrize("horizon", [1.0, 6.0, 12.0])
def test_tool_accepts_integral_float_horizon_as_integer(horizon):
    payload = json.loads(make_handler()({"horizon": horizon}))
    assert "error" not in payload
    assert payload["horizon"] == int(horizon)
    assert type(payload["horizon"]) is int
    assert all(len(item["projection"]) == int(horizon) for item in payload["items"])


@pytest.mark.parametrize("horizon", [True, False, 1.5, 0, 13, 0.0, 13.0, "6", None, float("nan"), float("inf")])
def test_tool_rejects_non_whole_or_out_of_range_horizons(horizon):
    assert json.loads(make_handler()({"horizon": horizon})) == {
        "error": "Horizon must be a whole number from 1 to 12.",
    }


def _source_data(items):
    return {"as_of": "2026-10-31", "months": ["2026-08", "2026-09", "2026-10"], "items": items}


def _item(sku="FAKE", **changes):
    return {"sku": sku, "name": "Synthetic item", "unit": "ea", "on_hand": 20,
            "supplier_days": None, "monthly_sales": [10] * 3, "receipts": {}, **changes}


@pytest.mark.parametrize("receipts, expected", [
    ({}, "No receipts recorded; assumes nothing is on order."),
    ({"2026-11": 0}, "No receipts recorded; assumes nothing is on order."),
    ({"2026-10": 5, "2027-01": 5}, "No receipts recorded; assumes nothing is on order."),
    ({"2026-11": 5}, "Includes recorded receipts; assumes nothing else is on order."),
    ({"2026-12": 5}, "Includes recorded receipts; assumes nothing else is on order."),
])
def test_disclosure_counts_only_positive_receipts_within_selected_horizon(monkeypatch, receipts, expected):
    monkeypatch.setattr(tools, "load_sample", lambda _: _source_data([_item(receipts=receipts)]))
    payload = json.loads(make_handler()({"horizon": 2}))
    assert payload["disclosure"] == expected


@pytest.mark.parametrize("changes", [
    {"receipts": None}, {"receipts": []}, {"receipts": "invalid"},
    {"receipts": {"2026-11": "invalid"}},
    {"on_hand": -1, "receipts": {"2026-11": 5}},
    {"hold_reason": "Some moves use a unit that cannot be converted.", "receipts": {"2026-11": 5}},
])
def test_held_items_do_not_break_or_claim_included_receipts(monkeypatch, changes):
    monkeypatch.setattr(tools, "load_sample", lambda _: _source_data([_item(**changes)]))
    payload = json.loads(make_handler()({"horizon": 2}))
    assert "error" not in payload
    assert payload["items"][0]["held"] is True
    assert payload["disclosure"] == "No receipts recorded; assumes nothing is on order."
    assert payload["summary"][0].startswith("FAKE: held — ")


def test_disclosure_ignores_unselected_skus(monkeypatch):
    monkeypatch.setattr(tools, "load_sample", lambda _: _source_data([
        _item("SELECTED"), _item("OTHER", receipts={"2026-11": 5}),
    ]))
    payload = json.loads(make_handler()({"skus": ["SELECTED"]}))
    assert payload["disclosure"] == "No receipts recorded; assumes nothing is on order."


def test_unfiltered_large_result_returns_50_soonest_runouts_with_matching_summary(monkeypatch):
    items = [_item(f"SKU-{i:03d}", on_hand=i) for i in range(60, 0, -1)]
    items.insert(0, _item("NO-RUNOUT", on_hand=10000))
    items.insert(0, _item("HELD", on_hand=-1))
    monkeypatch.setattr(tools, "load_sample", lambda _: _source_data(items))
    payload = json.loads(make_handler()({}))
    assert payload["truncated"] is True
    assert payload["total_count"] == 62
    assert [item["sku"] for item in payload["items"]] == [f"SKU-{i:03d}" for i in range(1, 51)]
    assert [line.split(":", 1)[0] for line in payload["summary"]] == [item["sku"] for item in payload["items"]]
    assert len(payload["summary"]) == 50


def test_truncation_prefers_valid_no_runout_items_over_held_items(monkeypatch):
    items = [_item("HELD-FIRST", on_hand=-1)]
    items.extend(_item(f"VALID-{i:02d}", on_hand=10000) for i in range(50))
    monkeypatch.setattr(tools, "load_sample", lambda _: _source_data(items))
    payload = json.loads(make_handler()({}))
    assert payload["total_count"] == 51
    assert payload["truncated"] is True
    assert [item["sku"] for item in payload["items"]] == [f"VALID-{i:02d}" for i in range(50)]
    assert all(not item["held"] for item in payload["items"])


def test_50_or_fewer_unfiltered_results_keep_source_order(monkeypatch):
    items = [_item(f"SKU-{i:03d}", on_hand=i) for i in range(50, 0, -1)]
    monkeypatch.setattr(tools, "load_sample", lambda _: _source_data(items))
    payload = json.loads(make_handler()({}))
    assert payload.get("truncated", False) is False
    assert [item["sku"] for item in payload["items"]] == [item["sku"] for item in items]


def test_readme_and_skill_document_current_contract():
    readme = (ROOT / "docs" / "GUIDE.md").read_text()
    skill = (ROOT / "skills" / "stock-runway" / "SKILL.md").read_text()
    assert "`default_horizon` applies to the Desktop page" in readme
    assert "UTC month bucketing" in readme
    assert "Odoo 16 or older" in readme and "`product_uom_qty`" in readme
    assert "rollback assumes moves complete" in readme
    assert "Only `search_read`" in readme and "authentication" in readme
    expected_fields = {
        "stock.location": "id, usage",
        "stock.move": "product_id, product_uom_qty, product_uom, quantity, date, state, location_id, location_dest_id",
        "stock.quant": "product_id, quantity, location_id",
        "product.product": "id, name, default_code, uom_id, product_tmpl_id, categ_id",
        "product.supplierinfo": "product_tmpl_id, product_id, delay",
        "uom.uom": "id, factor, category_id, parent_path",
    }
    for model, fields in expected_fields.items():
        assert f"| `{model}` | {fields} |" in readme
    assert "Repeat the tool's disclosure line." in skill
    assert "State that no receipts were recorded" not in skill
    assert "No recent sales to check" in skill
