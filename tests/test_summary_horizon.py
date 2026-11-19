"""Plain summaries respect the selected horizon and distinguish no demand."""
import base64
from datetime import date
import json
from pathlib import Path
import sys
import types

import pytest

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)

from stock_runway.tools import make_handler


def summary_result(tmp_path, *, horizon, stock=25, sales=10):
    sample = tmp_path / "summary.json"
    sample.write_text(json.dumps({
        "as_of": "2026-10-31",
        "months": ["2026-08", "2026-09", "2026-10"],
        "items": [{"sku": "SUMMARY", "name": "Summary regression", "unit": "ea",
                   "on_hand": stock, "supplier_days": None,
                   "monthly_sales": [sales] * 3, "receipts": {}}],
    }))
    payload = json.loads(make_handler(sample_path=sample, today=date(2026, 11, 1))({
        "horizon": horizon,
    }))
    assert "error" not in payload
    assert payload["items"][0]["held"] is False
    encoded = payload["card"].split('data="', 1)[1].split('"', 1)[0]
    card = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    return payload, card


@pytest.mark.parametrize("horizon", [1, 2])
def test_summary_does_not_advertise_runout_beyond_selected_horizon(tmp_path, horizon):
    payload, card = summary_result(tmp_path, horizon=horizon)
    # Purchase planning retains its longer forecast; display caps must not mutate it.
    assert payload["items"][0]["runout_month"] == "2027-01"
    assert card["rows"][0]["runout"] is None
    assert payload["summary"][0].startswith(
        f"SUMMARY: does not run out within {horizon} months;"
    )
    assert "Jan 2027" not in payload["summary"][0]


@pytest.mark.parametrize("horizon", [3, 6])
def test_summary_keeps_runout_at_or_within_horizon(tmp_path, horizon):
    payload, card = summary_result(tmp_path, horizon=horizon)
    assert card["rows"][0]["runout"] == "2027-01"
    assert payload["summary"][0].startswith("SUMMARY: runs out Jan 2027;")


def test_zero_stock_zero_demand_summary_does_not_forecast_runout(tmp_path):
    payload, _ = summary_result(tmp_path, horizon=2, stock=0, sales=0)
    assert payload["items"][0]["monthly_demand"] == 0
    assert payload["summary"][0].startswith(
        "SUMMARY: out of stock; no sales to forecast;"
    )
    assert "runs out" not in payload["summary"][0]
    assert "does not run out" not in payload["summary"][0]


def test_zero_stock_with_demand_still_reports_runout(tmp_path):
    payload, _ = summary_result(tmp_path, horizon=2, stock=0)
    assert payload["summary"][0].startswith(
        "SUMMARY: out of stock; runs out Nov 2026;"
    )
