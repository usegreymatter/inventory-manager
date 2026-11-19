"""The chat card is a bounded DTO, independent of the full plain-text result."""
import base64
import calendar
from datetime import date
import json
import math
from pathlib import Path
import re
import sys
import types

import pytest

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("stock_runway")
package.__path__ = [str(ROOT)]
sys.modules.setdefault("stock_runway", package)

from stock_runway import tools

GRADES = {
    "Usable for planning", "Use with care", "Too far off to plan on",
    "Not enough history to check", "No recent sales to check", "Check item data",
}


def item(sku="SKU", **changes):
    return {"sku": sku, "name": "Synthetic item", "unit": "ea", "on_hand": 20,
            "supplier_days": None, "monthly_sales": [10] * 3, "receipts": {}, **changes}


def result(monkeypatch, items, **args):
    data = {"as_of": "2026-10-31", "months": ["2026-08", "2026-09", "2026-10"], "items": items}
    monkeypatch.setattr(tools, "load_sample", lambda _: data)
    return json.loads(tools.make_handler()(args))


def decode(payload):
    line = payload["card"]
    match = re.fullmatch(r'::stock-runway\{data="([A-Za-z0-9_-]+)"\}', line)
    assert match, "card must be exactly one unpadded base64url directive"
    assert len(line) <= 1900
    assert len(line.split("{", 1)[1][:-1]) <= 2048
    assert len(line) <= 4800
    encoded = match[1]
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    dto = json.loads(raw.decode("utf-8"))
    assert raw == json.dumps(dto, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    assert set(dto) == {"as_of", "horizon", "disclosure", "rows", "more"}
    latest = date.fromisoformat(dto["as_of"])
    assert latest.isoformat() == dto["as_of"]
    assert latest.day == calendar.monthrange(latest.year, latest.month)[1]
    assert type(dto["horizon"]) is int and 1 <= dto["horizon"] <= 12
    assert isinstance(dto["disclosure"], str) and len(dto["disclosure"]) <= 512
    assert len(dto["rows"]) <= 50
    assert type(dto["more"]) is int and dto["more"] >= 0
    assert len({row["sku"] for row in dto["rows"]}) == len(dto["rows"])
    for row in dto["rows"]:
        assert set(row) == {"sku", "name", "runout", "grade", "stock", "monthly", "held"}
        assert isinstance(row["sku"], str) and 1 <= len(row["sku"]) <= 120
        assert isinstance(row["name"], str) and 1 <= len(row["name"]) <= 240
        assert row["grade"] in GRADES
        assert type(row["held"]) is bool
        assert row["runout"] is None or re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", row["runout"])
        for key in ("stock", "monthly"):
            value = row[key]
            if value is None:
                assert row["held"]
            else:
                assert type(value) in (int, float) and math.isfinite(value) and value >= 0
    return dto, raw


def test_card_present_decodes_to_minimal_dto_and_preserves_summary():
    payload = json.loads(tools.make_handler()({"skus": ["SEAL-CLR-300"]}))
    dto, _ = decode(payload)
    assert payload["summary"] == ["SEAL-CLR-300: runs out Mar 2027; Usable for planning; Sales pattern: Steady, Safety stock — extra kept for delays or surprise demand: 16, Reorder point — order when stock drops to 67"]
    assert dto == {
        "as_of": payload["as_of"], "horizon": 6, "disclosure": payload["disclosure"], "more": 0,
        "rows": [{"sku": "SEAL-CLR-300", "name": payload["items"][0]["name"],
                  "runout": "2027-03", "grade": "Usable for planning",
                  "stock": payload["items"][0]["stock"],
                  "monthly": payload["items"][0]["monthly_demand"], "held": False}],
    }


def test_card_sorts_runouts_then_no_runout_then_held_without_reordering_summary(monkeypatch):
    payload = result(monkeypatch, [item("HELD", on_hand=-1), item("NONE", on_hand=10000),
                                  item("LATE", on_hand=30), item("EARLY", on_hand=1)])
    dto, _ = decode(payload)
    assert [row["sku"] for row in dto["rows"]] == ["EARLY", "LATE", "NONE", "HELD"]
    assert [row["sku"] for row in payload["items"]] == ["HELD", "NONE", "LATE", "EARLY"]
    assert payload["summary"][0].startswith("HELD: held — ")
    assert dto["rows"][-1] == {"sku": "HELD", "name": "Synthetic item", "runout": None,
                               "grade": "Check item data", "stock": None, "monthly": None, "held": True}


@pytest.mark.parametrize("filtered", [False, True])
def test_card_caps_rows_and_discloses_full_count(monkeypatch, filtered):
    items = [item(f"SKU-{i:03d}", on_hand=i) for i in range(70, 0, -1)]
    payload = result(monkeypatch, items, **({"skus": [row["sku"] for row in items]} if filtered else {}))
    dto, _ = decode(payload)
    count = len(dto["rows"])
    assert 0 < count < 50
    assert [row["sku"] for row in dto["rows"]] == [f"SKU-{i:03d}" for i in range(1, count + 1)]
    assert dto["more"] == 70 - count
    assert payload["disclosure"] in dto["disclosure"]


def test_card_roundtrips_unicode_without_ascii_escaping(monkeypatch):
    payload = result(monkeypatch, [item("مخزون-🧰", name="أنبوب 東京 🧰")])
    dto, raw = decode(payload)
    assert dto["rows"][0]["sku"] == "مخزون-🧰"
    assert dto["rows"][0]["name"] == "أنبوب 東京 🧰"
    assert "東京".encode() in raw
    assert b"\\u" not in raw


def test_card_bounds_pathological_sku_and_name_in_unicode_characters(monkeypatch):
    sku = "🧰" * 10000
    name = "管" * 10000
    payload = result(monkeypatch, [item(sku, name=name)])
    dto, _ = decode(payload)
    assert dto["rows"] == []  # Even one maximal UTF-8 row cannot fit the parser cap.
    assert dto["more"] == 1
    assert payload["items"][0]["sku"] == sku
    assert payload["items"][0]["name"] == name


def test_card_hard_line_limit_drops_trailing_rows_and_discloses_actual_count(monkeypatch):
    items = [item(f"{i:03d}" + "🧰" * 117, name="🧰" * 240, on_hand=i) for i in range(1, 51)]
    payload = result(monkeypatch, items)
    dto, _ = decode(payload)
    count = len(dto["rows"])
    assert 0 <= count < 50
    assert [row["sku"] for row in dto["rows"]] == [row["sku"] for row in items[:count]]
    assert dto["more"] == 50 - count
    assert len(payload["items"]) == 50 and len(payload["summary"]) == 50


def test_card_deduplicates_bounded_sku_collisions_and_discloses_omissions(monkeypatch):
    payload = result(monkeypatch, [item("X" * 120 + "A"), item("X" * 120 + "B")])
    dto, _ = decode(payload)
    assert len(dto["rows"]) == 1
    assert dto["more"] == 1


@pytest.mark.parametrize("changes", [
    {"on_hand": float("nan")}, {"on_hand": float("inf")}, {"on_hand": -1},
    {"monthly_sales": [10, float("nan"), 10]}, {"monthly_sales": [10, float("inf"), 10]},
    {"monthly_sales": [10, -1, 10]}, {"name": None}, {"sku": None},
])
def test_card_held_data_never_encodes_invalid_numbers_or_missing_text(monkeypatch, changes):
    dto, _ = decode(result(monkeypatch, [item(**changes)]))
    if changes.get("sku", "SKU") is None:
        assert dto["rows"] == []
        assert dto["more"] == 1
        return
    assert dto["rows"][0]["held"] is True
    assert dto["rows"][0]["grade"] == "Check item data"
    assert dto["rows"][0]["stock"] is None and dto["rows"][0]["monthly"] is None


def test_card_empty_matches_is_valid(monkeypatch):
    dto, _ = decode(result(monkeypatch, []))
    assert dto["rows"] == []


@pytest.mark.parametrize("sku", ["", "   ", " " * 121 + "X", None])
def test_card_skips_missing_or_whitespace_bounded_ids(monkeypatch, sku):
    payload = result(monkeypatch, [item(sku), item("GOOD")])
    dto, _ = decode(payload)
    assert [row["sku"] for row in dto["rows"]] == ["GOOD"]
    assert dto["more"] == 1
    assert len(payload["items"]) == 2


@pytest.mark.parametrize("changes", [{"sku": "BAD\ud800"}, {"name": "BAD\udfff"}])
def test_card_bad_unicode_omits_card_not_plain_result(monkeypatch, changes):
    payload = result(monkeypatch, [item(**changes)])
    tools.make_handler()({}).encode("utf-8")  # Even the surrounding tool text must remain transport-safe.
    assert "card" not in payload
    assert "error" not in payload
    assert len(payload["items"]) == len(payload["summary"]) == 1


def test_errors_do_not_emit_a_card():
    payload = json.loads(tools.make_handler()({"horizon": 0}))
    assert "error" in payload and "card" not in payload


def test_tool_and_skill_instruct_verbatim_card_emission():
    description = tools.TOOL_SCHEMA["description"]
    skill = (ROOT / "skills" / "stock-runway" / "SKILL.md").read_text()
    for text in (description, skill):
        assert "card" in text and "own paragraph" in text and "one-line answer" in text
        assert "verbatim" in text and "recreate" in text
