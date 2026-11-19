"""Offline build drift and dependency checks; no plugin installation."""
import importlib.util
from pathlib import Path
import re
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "standalone" / "build.py"
OUTPUTS = {
    "baseline": ROOT / "standalone" / "design/baseline.html",
    "option-gm-b": ROOT / "standalone" / "stock-runway.html",
    "option-a": ROOT / "standalone" / "design/option-a.html",
    "option-b": ROOT / "standalone" / "design/option-b.html",
    "option-a2": ROOT / "standalone" / "design/option-a2.html",
    "option-a3": ROOT / "standalone" / "design/option-a3.html",
}


@pytest.fixture(scope="module")
def builder():
    spec = importlib.util.spec_from_file_location("standalone_build", BUILD)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(params=OUTPUTS, ids=OUTPUTS)
def output(request):
    return request.param, OUTPUTS[request.param]


def block(html, name):
    start, end = f"/* STOCK_RUNWAY_{name}_START */\n", f"/* STOCK_RUNWAY_{name}_END */"
    assert html.count(start) == html.count(end) == 1, f"exactly one {name} block"
    return html.split(start, 1)[1].split(end, 1)[0]


def test_committed_html_is_byte_identical_to_build(builder, output):
    template, path = output
    assert builder.build(template).encode("utf-8") == path.read_bytes()
    assert builder.build(template=template).encode("utf-8") == path.read_bytes()
    if template == builder.DEFAULT_TEMPLATE:
        assert builder.build().encode("utf-8") == path.read_bytes()
        assert path.read_bytes() == (ROOT / "standalone/design/option-gm-b.html").read_bytes()


def test_cli_output_is_byte_identical_to_build(output):
    template, path = output
    output_dir = ROOT / ".scratch" / "standalone" / "build-test"
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / path.name
    result = subprocess.run(
        [sys.executable, str(BUILD), "--template", template, "--output", str(target)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == path.read_bytes()


def test_default_cli_ships_arctic():
    target = ROOT / ".scratch" / "standalone" / "build-test" / "default.html"
    result = subprocess.run([sys.executable, str(BUILD), "--output", str(target)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == OUTPUTS["option-gm-b"].read_bytes()


def test_embedded_core_is_exact_plugin_section(builder, output):
    _, path = output
    source = (ROOT / "desktop" / "plugin.js").read_text()
    expected = source.split("import { jsx, jsxs } from 'react/jsx-runtime'\n", 1)[1].split("const pageStyle =", 1)[0]
    assert block(path.read_text(), "CORE") == expected
    assert builder.extract_core(source) == expected


def test_embedded_helpers_are_exact_baseline_including_po_builder(output):
    _, path = output
    expected = block(OUTPUTS["baseline"].read_text(), "HELPERS")
    for function in ("standaloneRows", "attentionRows", "purchaseOrderText"):
        assert f"function {function}(" in expected
    assert block(path.read_text(), "HELPERS") == expected


def test_no_external_dependencies_or_network_calls(output):
    _, path = output
    html = path.read_text()
    assert not re.search(r"(?:src|href)\s*=\s*['\"]\s*(?:https?:)?//", html, re.I)
    assert not re.search(r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(", html)
    # Embedded icons/fonts are offline dependencies. Reject every other CSS
    # URL, including relative paths; ignore the local URL.createObjectURL API.
    assert_offline_css_urls(html)
    assert '<script type="module"' in html
    assert not re.search(r"<script\b[^>]*\bsrc\s*=", html, re.I)


def assert_offline_css_urls(html):
    assert not re.search(r'@import', html, re.I)
    for target in re.findall(r'(?<![\w.])url\s*\(\s*([^)]*)\)', html, re.I):
        target = target.strip().strip('\"\'')
        assert re.match(r'data:(?:image/svg\+xml,|font/(?:woff2?|ttf|otf);base64,)', target, re.I), target


@pytest.mark.parametrize('target', ['https://example.invalid/font.woff2', '//example.invalid/icon.svg',
                                  'font.woff2', '/icon.svg', 'file:///font.woff2'])
def test_css_urls_reject_nonembedded_dependencies(target):
    with pytest.raises(AssertionError):
        assert_offline_css_urls(f'body {{ background:url("{target}") }}')


@pytest.mark.parametrize('target', ['data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
                                  'data:font/woff2;base64,d09GMg=='])
def test_css_urls_allow_embedded_assets(target):
    assert_offline_css_urls(f'body {{ background:url("{target}") }}')


@pytest.mark.parametrize("template", ["option-a", "option-b"])
def test_design_preserves_operational_controls(template):
    html = OUTPUTS[template].read_text()
    for identifier in ("snapshot", "orders", "others", "copy-po", "copy-status", "copy-fallback", "po-text",
                       "settings", "delivery-days", "cover-months", "service-level", "reset-settings",
                       "csv-file", "sample", "dropzone", "source-status", "file-error", "theme-toggle"):
        assert len(re.findall(rf'\bid=[\'\"]{re.escape(identifier)}[\'\"]', html)) == 1, identifier


@pytest.mark.parametrize("identifier", ["host", "jsx", "useState", "Button", "StatusDot"])
def test_build_rejects_sdk_or_react_references(builder, identifier):
    source = (ROOT / "desktop" / "plugin.js").read_text()
    polluted = source.replace("const pageStyle =", f"const leakedDependency = {identifier};\nconst pageStyle =", 1)
    with pytest.raises(ValueError, match=identifier):
        builder.extract_core(polluted)


@pytest.mark.parametrize("old,new", [
    ("const pageStyle =", "const newPageStyle ="),
    ("import { jsx, jsxs }", "import { jsx }"),
])
def test_build_fails_closed_when_anchors_change(builder, old, new):
    source = (ROOT / "desktop" / "plugin.js").read_text()
    with pytest.raises(ValueError):
        builder.extract_core(source.replace(old, new, 1))
