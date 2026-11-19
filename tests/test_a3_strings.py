"""The A3-owned presentation copy has one table; upstream core/helpers stay exact."""
import json
from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'standalone/design'


def strings():
    source = (DESIGN / 'strings-a3.js').read_text()
    return json.loads(source.split('const STRINGS = ', 1)[1].split('\nconst S =', 1)[0])


class CopyProbe(HTMLParser):
    def __init__(self):
        super().__init__()
        self.raw = False
        self.literals = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.raw = True
        for key, value in attrs:
            if key in ('aria-label', 'placeholder', 'title') and value:
                assert re.fullmatch(r'__S_\w+__', value), value

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.raw = False

    def handle_data(self, data):
        if not self.raw and data.strip() and not re.fullmatch(r'__\w+__', data.strip()):
            self.literals.append(data)


def test_html_copy_is_table_owned():
    for filename in ('template-a3.html', 'controls-a3.html'):
        probe = CopyProbe()
        probe.feed((DESIGN / filename).read_text())
        assert not probe.literals
        for key in re.findall(r'__S_(\w+)__', (DESIGN / filename).read_text()):
            assert key in strings()


def test_js_visible_copy_heuristic():
    # Deliberately scoped: IDs, classes, data enums and units are not UI copy.
    # Catch direct DOM copy and prose literals/templates. Runtime/canonical core
    # strings (reason, explanations, PO text) remain upstream-owned.
    for filename in ('app-a3.js', 'chart-a3.js', 'why-a3.js'):
        source = (DESIGN / filename).read_text()
        source = re.sub(r'^\s*//[^\n]*|/\*.*?\*/', '', source, flags=re.S | re.M)
        if filename == 'app-a3.js':
            # Import cancellation retains the previous source. This exact,
            # reviewed fallback is the sole exception, not arbitrary new prose.
            fallback = "$('source-status').textContent=sourceName==='sample'?'Still using built-in sample data.':'Still using '+sourceName+'.'"
            assert source.count(fallback) == 1
            source = source.replace(fallback, '', 1)
        if filename == 'chart-a3.js':
            # Shared stockout-advisory labels are upstream-owned like reasons;
            # pin their exact contexts rather than allowing arbitrary literals.
            advisory_copy = (
                "(flag.confidence==='known'?'known stock-out':'likely stock-out')",
                "label(flag.month)+' · suspected capped sales'",
            )
            for expression in advisory_copy:
                assert source.count(expression) == 1
                source = source.replace(expression, "''", 1)
        assert not re.search(r"node\('[^']+',\s*'[^']*[A-Za-z][^']*'", source)
        assert not re.search(r"(?:textContent\s*=|setAttribute\('aria-label',)\s*'[^']*[A-Za-z]", source)
        literals = re.findall(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", source)
        assert not [value for value in literals if re.search(r'[A-Za-z]+ [A-Za-z]+', value)]
        for key in re.findall(r'\bSTRINGS\.(\w+)', source):
            assert key in strings()


def test_forecast_labels_stay_compact():
    table=strings()
    assert table['calendarNote'] == 'Approx dates'
    assert table['testedMonths'] == 'Tested: {count} mo'
    for key in ('calendarNote','testedMonths'):
        assert len(table[key].replace('{count}','12').split()) <= 3


def test_english_table_is_plain_keyed_strings():
    table = strings()
    assert len(table) > 80
    assert all(isinstance(key, str) and isinstance(value, str) for key, value in table.items())


def test_every_table_value_is_display_copy_not_a_code_token():
    # Symbols and placeholder-only labels are intentional visible copy. Protocol
    # tokens must remain in code, never in a future translation payload.
    display_symbols = {'•••', '⌄', '⌕', '↑ ↓', '‹', '›', '⚠', '—', 'ⓘ', '×'}
    keyboard_keys = {'Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete',
                     'Home', 'End', 'PageUp', 'PageDown'}
    code_key_names = {'keydown', 'keyup', 'click', 'timeZone', 'keyCode', 'key', 'sku'}
    for key, value in strings().items():
        text = value.strip()
        assert text and text not in keyboard_keys | code_key_names, (key, value)
        assert not re.search(r'Arrow(?:Down|Right|Up|Left)|^Key[A-Z]$|^Digit[0-9]$', text), (key, value)
        assert not re.search(r'T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:Z|[+-])|^(?:UTC|GMT|[A-Za-z_]+/[A-Za-z_]+)$', text), (key, value)
        assert not re.search(r'^(?:#|https?://)|\b[A-Za-z_$][\w$]*[.=]\w+|^[A-Za-z]+(?:_[a-z]+)+$', text), (key, value)
        assert text in display_symbols or re.search(r'[A-Za-z0-9]', text), (key, value)
