"""Offline distribution notices and CLI defaults must survive regeneration."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
COPYRIGHTS = (
    "Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)",
    "(c) 2017 by Boutros International. All rights reserved.",
)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("variant", (
    "baseline", "option-a", "option-b", "option-a2", "option-a3",
    "option-gm-a", "option-gm-b", "option-gm-c", "default", "demo-1000",
))
def test_every_build_embeds_license_comment(variant):
    builder = load("standalone/build.py", "notice_builder")
    if variant == "demo-1000":
        data = json.loads((ROOT / "data/demo-1000.json").read_text())
        html = builder.build(data=data)
        path = ROOT / "standalone/stock-runway-demo-1000.html"
    elif variant == "default":
        html = builder.build()
        path = ROOT / "standalone/stock-runway.html"
    else:
        html = builder.build(variant)
        path = ROOT / f"standalone/design/{variant}.html"
    expected = "<!--\n" + "\n".join((
        "Stock Runway — MIT License, Copyright (c) 2026 Stock Runway contributors",
        "Embedded fonts Poppins and Tajawal: SIL Open Font License 1.1, see LICENSES/OFL-1.1.txt and THIRD_PARTY_NOTICES.md",
        *COPYRIGHTS,
    )) + "\n-->\n"
    assert html.startswith(expected)
    assert html.count(expected) == 1
    import re
    encoded = re.search(r'<script type="application/json" id="stock-runway-distribution-licenses">(.*?)</SCRIPT>', html)
    assert encoded is not None
    documents = json.loads(encoded.group(1))
    assert set(documents) == {'LICENSE', 'LICENSES/OFL-1.1.txt', 'THIRD_PARTY_NOTICES.md'}
    for relative, text in documents.items():
        assert (ROOT / relative).read_text() == text
    assert path.read_text(encoding="utf-8") == html
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    assert all(line in notices for line in COPYRIGHTS)
    assert "[LICENSES/OFL-1.1.txt](LICENSES/OFL-1.1.txt)" in notices


@pytest.mark.parametrize("case", (
    "missing-incoming", "missing-sales", "missing-sales-value", "missing-stock",
    "fallback-lead", "no-fallback-lead", "zero-source-lead", "invalid-incoming",
))
def test_documented_data_gates(case):
    cli = load("stock_runway.py", "gate_cli")
    engine, _ = cli._load_modules()
    raw = dict(sku="SYNTHETIC", name="Synthetic", unit="ea", on_hand=2,
               supplier_days=14, monthly_sales=[10, 11, 12])
    settings = {}
    if case == "missing-sales":
        raw.pop("monthly_sales")
    elif case == "missing-sales-value":
        raw["monthly_sales"] = [10, None, 12]
    elif case == "missing-stock":
        raw.pop("on_hand")
    elif case == "invalid-incoming":
        raw["on_order"] = None
    elif case in ("fallback-lead", "no-fallback-lead"):
        raw["supplier_days"] = None
        if case == "no-fallback-lead":
            settings["default_delivery_days"] = None
    elif case == "zero-source-lead":
        raw["supplier_days"] = 0
    months = ["2026-08", "2026-09", "2026-10"]
    physical = engine.forecast(raw, months, "2026-10-31")
    guidance = engine.order_guidance({**raw, **physical, "as_of": "2026-10-31"},
                                     "2026-11-01", settings)
    if case in ("missing-sales", "missing-sales-value", "missing-stock", "invalid-incoming"):
        assert physical["held"] is True
        assert guidance["status"] == "needs-data"
        assert guidance.get("quantity") is None
    elif case == "no-fallback-lead":
        assert physical["held"] is False
        assert guidance["status"] == "needs-data"
        assert guidance.get("quantity") is None
        assert "No delivery time" in guidance["reason"]
    else:
        assert physical["held"] is False
        assert guidance["quantity"] > 0
        if case == "missing-incoming":
            explicit = engine.order_guidance({**raw, **physical, "on_order": 0,
                "as_of": "2026-10-31"}, "2026-11-01")
            assert guidance["quantity"] == explicit["quantity"]
            assert "on_order" not in raw and "on_order" not in physical
        else:
            assert guidance["lead_days"] == (0 if case == "zero-source-lead" else 14)
            assert guidance["used_default_lead"] is (case == "fallback-lead")


def test_local_ofl_includes_all_sections():
    license_text = (ROOT / "LICENSES/OFL-1.1.txt").read_text()
    assert license_text.startswith("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n")
    for section in ("PREAMBLE", "DEFINITIONS", "PERMISSION & CONDITIONS", "TERMINATION", "DISCLAIMER"):
        assert section in license_text
    assert '1) Neither the Font Software nor any of its individual components,' in license_text
    assert '5) The Font Software, modified or unmodified, in part or in whole,' in license_text
    assert license_text.rstrip().endswith('OTHER DEALINGS IN THE FONT SOFTWARE.')


@pytest.mark.parametrize("flag,key", (
    ("--delivery-days", "default_delivery_days"),
    ("--buffer-days", "buffer_days"),
    ("--months-of-cover", "months_of_cover"),
    ("--service-level", "service_level"),
    ("--include-safety-stock", "include_backup_in_orders"),
    ("--stockout-adjust", "stockout_adjust"),
))
def test_cli_help_matches_engine_defaults(flag, key):
    cli = load("stock_runway.py", "defaults_cli")
    engine, _ = cli._load_modules()
    result = subprocess.run([sys.executable, str(ROOT / "stock_runway.py"), "--help"],
                            capture_output=True, text=True, cwd=ROOT)
    assert result.returncode == 0, result.stderr
    help_text = " ".join(result.stdout.split())
    start = help_text.rindex(flag)
    text = help_text[start:].split(" --", 1)[0]
    value = engine.DEFAULT_ORDER_SETTINGS[key]
    if isinstance(value, bool):
        assert f"({'on' if value else 'off'} by default)" in text
    else:
        assert f"(default: {value})" in text


def test_root_pages_entry_redirects_to_the_shipped_offline_planner():
    from html.parser import HTMLParser
    class Entry(HTMLParser):
        refresh = []
        links = []
        def handle_starttag(self, tag, attrs):
            attributes = dict(attrs)
            if tag == 'meta' and attributes.get('http-equiv', '').lower() == 'refresh':
                self.refresh.append(attributes['content'])
            if tag == 'a':
                self.links.append(attributes['href'])
    entry = Entry()
    entry.feed((ROOT / 'index.html').read_text())
    assert entry.refresh == ['0; url=standalone/stock-runway.html']
    assert 'standalone/stock-runway.html' in entry.links
    assert all((ROOT / path).is_file() for path in entry.links)
