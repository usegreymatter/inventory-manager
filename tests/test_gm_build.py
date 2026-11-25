"""GreyMatter variants are additive presentation builds, never alternate calculations."""
import base64
import importlib.util
from pathlib import Path
import re

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'standalone/design'
SPEC = importlib.util.spec_from_file_location('gm_build', ROOT / 'standalone/build.py')
assert SPEC is not None and SPEC.loader is not None
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


@pytest.mark.parametrize('variant', ['option-gm-a', 'option-gm-b', 'option-gm-c'])
def test_gm_generated_output_is_reproducible(variant):
    html = BUILDER.build(variant)
    assert html.encode() == (DESIGN / f'{variant}.html').read_bytes()
    assert '__GM_' not in html and '__DESIGN_' not in html
    assert 'by GreyMatter' in html
    assert '<span class="edition">' not in html


@pytest.mark.parametrize('variant', ['option-gm-a', 'option-gm-b', 'option-gm-c'])
def test_gm_shares_a3_logic_verbatim(variant):
    html = BUILDER.build(variant)
    for name in ['app-a3.js', 'chart-a3.js', 'learning-a3.js', 'health.js', 'why-a3.js']:
        expected = (DESIGN / name).read_text()
        if variant == 'option-gm-b' and name == 'app-a3.js':
            # Arctic alone defers large-catalog startup to its scheduler.
            # All other shared application bytes must remain verbatim.
            expected = expected.replace(
                'let evaluationSnapshot=null',
                'gmBInitialRestorePending=analysisIncomplete=data.items.length>1000\nlet evaluationSnapshot=null',
            ).replace(
                'initializeSheets();initializeLearning();syncSettings(); render()',
                'initializeSheets();initializeLearning();syncSettings(); if(data.items.length<=1000)render();else{withDatasetEvaluation(()=>{});setTimeout(()=>render(),0)}',
            )
            assert (DESIGN / 'progressive-gm-b.js').read_text() in html
        assert expected in html, name
    for block in ['CORE', 'HELPERS']:
        start, end = f'/* STOCK_RUNWAY_{block}_START */\n', f'/* STOCK_RUNWAY_{block}_END */'
        original = (DESIGN / 'option-a3.html').read_text().split(start)[1].split(end)[0]
        assert html.split(start)[1].split(end)[0] == original


@pytest.mark.parametrize('variant', ['option-gm-a', 'option-gm-b', 'option-gm-c'])
def test_gm_is_offline_with_shared_tokens(variant):
    html = BUILDER.build(variant)
    html = html.replace('<a class="version-link" href="https://github.com/usegreymatter/inventory-manager/releases" target="_blank" rel="noopener noreferrer">Check for a newer version</a>', "")  # Explicit click-only release navigation.
    assert not re.search(r'(?:src|href)\s*=\s*[\'\"]\s*(?:https?:)?//', html, re.I)
    assert not re.search(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(', html)
    assert (DESIGN / 'styles-gm.css').read_text() in html
    assert (DESIGN / f'styles-gm-{variant[-1]}.css').read_text() in html
    for colour in ['#FFFFFF', '#F5F6F8', '#070707', '#5A5F68', '#E4E6EA', '#C9CDD4', '#3F5687', '#B42318', '#2F7D6E']:
        assert colour in html


def test_brand_fonts_embed_valid_woff2_headers_and_weights():
    css = (DESIGN / 'fonts-gm.css').read_text()
    fonts = re.findall(r"font-family:'([^']+)';font-style:normal;font-weight:(\d+);.*?base64,([A-Za-z0-9+/=]+)", css)
    assert [(family, weight) for family, weight, _ in fonts] == [
        ('GM Poppins', '400'), ('GM Poppins', '600'), ('GM Tajawal', '400'), ('GM Tajawal', '500')]
    for _, _, encoded in fonts:
        assert base64.b64decode(encoded).startswith(b'wOF2')
    assert css in BUILDER.build('option-gm-c')
    assert css not in BUILDER.build('option-gm-a')
    assert css not in BUILDER.build('option-gm-b')


def test_original_a3_still_builds_byte_identically():
    assert BUILDER.build('option-a3').encode() == (DESIGN / 'option-a3.html').read_bytes()


def test_arctic_logo_and_presentation_are_b_only():
    html = BUILDER.build('option-gm-b')
    assert '<span class="gm-wordmark">' not in html
    assert (DESIGN / 'logo-gm.svg').read_text().strip() in html
    assert 'aria-label="GreyMatter" role="img"' in html
    logo = (DESIGN / 'logo-gm.svg').read_text()
    assert not re.search(r'<style|\bid=|\bstyle=|class="st[01]"', logo)
    assert '#0B1020' in logo
    # The official SVG defines st1 in its style sheet but uses it on no shape.
    # Do not invent a gray path merely to make a token appear in the cleaned logo.
    assert set(re.findall(r'fill="([^"]+)"', logo)) == {'#0B1020'}
    adapter = (DESIGN / 'presentation-gm-b.js').read_text()
    assert adapter in html
    for other in ['option-gm-a', 'option-gm-c', 'option-a3']:
        assert adapter not in BUILDER.build(other)
        assert 'class="gm-logo"' not in BUILDER.build(other)


def test_arctic_contrast_evidence_matches_tokens():
    spec = importlib.util.spec_from_file_location('qa_arctic', ROOT / 'standalone/qa-arctic.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # The final theme overrides the inherited presentation stylesheet. Read
    # active light-palette tokens, not historical hardcoded QA palette values.
    css = (DESIGN / 'theme-gm-b.css').read_text().lower()
    light = css.split('@media screen', 1)[0]
    tokens = dict(re.findall(r'--([\w-]+):\s*(#[0-9a-f]{6})', light))
    foregrounds = {'ink': 'ink', 'muted': 'muted', 'accent': 'accent',
                   'status red': 'red', 'order number': 'order-ink',
                   'watch text': 'amber', 'OK marker (not text)': 'fine',
                   'demand boundary': 'demand-edge', 'primary button text': 'on-accent'}
    for row in module.evidence()['checks']:
        foreground = tokens[foregrounds[row['name']]]
        background = tokens['accent' if row['name'] == 'primary button text'
                            else 'bg' if row['background'] == '#F5F8FD' else 'subtle']
        assert module.contrast(foreground, background) >= row['minimum'], row['name']
    # Pale fill cannot honestly be called 3:1; the actual full-opacity boundary
    # is what supplies graphical contrast without altering approved bar fill.
    assert module.contrast('#AEB8CA', '#F5F8FD') < 3
    assert tokens['demand'] == '#aeb8ca'
    assert tokens['demand-edge'] == '#5b6274'
    assert "e.setAttribute('opacity','1')" in (DESIGN / 'presentation-gm-b.js').read_text()
