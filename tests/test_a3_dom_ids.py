"""Every element id the A3 script looks up must exist in the built A3 page.

Guards against merge drift such as a settings control wired in app-a3.js but
dropped from controls-a3.html (which would crash the page on load).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "standalone" / "design"


def test_every_looked_up_id_exists_in_built_a3_page():
    html = (DESIGN / "option-a3.html").read_text(encoding="utf-8")
    ids_in_page = set(re.findall(r'\bid="([^"]+)"', html))
    created = set()
    looked_up = set()
    for name in ("app-a3.js", "why-a3.js", "chart-a3.js"):
        path = DESIGN / name
        if not path.exists():
            continue
        src = path.read_text(encoding="utf-8")
        looked_up |= set(re.findall(r"\$\('([A-Za-z0-9_-]+)'\)", src))
        looked_up |= set(re.findall(r"getElementById\('([A-Za-z0-9_-]+)'\)", src))
        created |= set(re.findall(r"\.id\s*=\s*'([A-Za-z0-9_-]+)'", src))
    missing = sorted(i for i in looked_up - ids_in_page - created)
    assert looked_up, "expected the A3 script to look up element ids"
    assert missing == [], f"ids used by A3 script but missing from page: {missing}"


def test_settings_loop_ids_exist_in_built_a3_page():
    html = (DESIGN / "option-a3.html").read_text(encoding="utf-8")
    src = (DESIGN / "app-a3.js").read_text(encoding="utf-8")
    loop_ids = re.findall(r"\['([a-z-]+)',\s*'[a-z_]+',\s*\d", src)
    assert "buffer-days" in loop_ids
    for i in loop_ids:
        assert f'id="{i}"' in html, i
