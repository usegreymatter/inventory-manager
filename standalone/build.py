#!/usr/bin/env python3
"""Build one dependency-free HTML file from the unchanged Desktop JS core."""
import argparse
import html as html_module
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
START = "import { jsx, jsxs } from 'react/jsx-runtime'\n"
END = "const pageStyle ="
DEFAULT_TEMPLATE = "option-gm-b"
TEMPLATES = ("baseline", "option-a", "option-b", "option-a2", "option-a3", "option-gm-a", "option-gm-b", "option-gm-c")
LICENSE_NOTICE = """Inventory Manager — MIT License, Copyright (c) 2026 GreyMatter and Stock Runway contributors
"""
FONT_LICENSE_NOTICE = """Embedded fonts Poppins and Tajawal: SIL Open Font License 1.1, see LICENSES/OFL-1.1.txt and THIRD_PARTY_NOTICES.md
Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)
(c) 2017 by Boutros International. All rights reserved.
"""


def extract_core(source):
    """Fail closed if the text anchors or the SDK-free boundary drift."""
    if source.count(START) != 1 or source.count(END) != 1:
        raise ValueError("Desktop pure-core anchors changed; review the extraction boundary.")
    imports, remainder = source.split(START)
    core, _ = remainder.split(END)
    if not core.startswith("\nconst SAMPLE ="):
        raise ValueError("Desktop imports no longer end immediately before SAMPLE.")
    # Import bindings, not string literals or SDK tone comments, are forbidden.
    bindings = []
    for group in re.findall(r"import\s*\{([^}]+)\}\s*from", imports + START):
        bindings.extend(name.strip().split(" as ")[-1] for name in group.split(",") if name.strip())
    without_comments = re.sub(r"/\*.*?\*/|//[^\n]*", "", core, flags=re.S)
    for name in bindings:
        if re.search(r"\b" + re.escape(name) + r"\b", without_comments):
            raise ValueError(f"Pure core references SDK/React identifier: {name}")
    if re.search(r"</script|\bimport\s", core, re.I):
        raise ValueError("Pure core cannot contain script terminators or imports.")
    return core


def inject_demo(html, data):
    """Change only the standalone boot dataset/presentation, never SAMPLE/core.

    Keep the built-in sample and its existing reset/import handlers intact.
    JSON is emitted as data, with script terminators escaped, never as HTML.
    """
    if not isinstance(data, dict) or not isinstance(data.get("items"), list) or not data["items"]:
        raise ValueError("Demo data must be a stock dataset with a non-empty items list.")
    months = data.get("months")
    if not isinstance(months, list) or len(months) < 3 or not all(
            isinstance(m, str) and re.fullmatch(r"[1-9][0-9]{3}-(?:0[1-9]|1[0-2])", m) for m in months):
        raise ValueError("Demo data needs at least three YYYY-MM sales months.")
    # Match the core's calendar/snapshot contract without doing any forecasting.
    from calendar import monthrange
    ordinals = [int(m[:4]) * 12 + int(m[5:]) for m in months]
    if any(b != a + 1 for a, b in zip(ordinals, ordinals[1:])):
        raise ValueError("Demo sales months must be consecutive and in order.")
    last = months[-1]
    expected = f"{last}-{monthrange(int(last[:4]), int(last[5:]))[1]:02d}"
    if data.get("as_of") != expected:
        raise ValueError("Demo as_of must be the last sales month's final date.")
    if not all(isinstance(i, dict) and isinstance(i.get("sku"), str) and i["sku"].strip()
               and isinstance(i.get("monthly_sales"), list) and len(i["monthly_sales"]) == len(months)
               for i in data["items"]):
        raise ValueError("Every demo item needs a SKU and one sales value per month.")
    if len({i["sku"] for i in data["items"]}) != len(data["items"]):
        raise ValueError("Demo SKUs must be unique.")
    encoded = json.dumps(data, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    encoded = encoded.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    label = f"Synthetic demo data ({len(data['items']):,} products)"
    # Match only the initial declaration. The sample button still loads SAMPLE.
    html, count = re.subn(r"\blet data\s*=\s*SAMPLE\s*,\s*sourceName\s*=\s*'sample'",
                          "let data=STANDALONE_DEMO_DATA,sourceName='demo'", html)
    if count != 1:
        raise ValueError("Standalone initial dataset anchor changed; review demo injection.")
    core_end = "/* STOCK_RUNWAY_CORE_END */"
    if html.count(core_end) != 1:
        raise ValueError("Standalone core boundary changed; review demo injection.")
    html = html.replace(core_end, core_end + "\nconst STANDALONE_DEMO_DATA=" + encoded + "\n", 1)
    # Run after all presentation wrappers; keep the badge correct after filters,
    # settings, CSV imports and returning to the original built-in sample.
    badge = """
// Standalone build-only provenance; no core or forecast changes.
const standaloneDemoLabel=__LABEL__
function standaloneDemoBadge(){
  if(sourceName!=='demo'||data!==STANDALONE_DEMO_DATA)return
  const snapshot=document.getElementById('snapshot')
  snapshot.textContent=standaloneDemoLabel
  snapshot.title=data.note+' Stock snapshot: '+data.as_of
  document.getElementById('source-status').textContent=standaloneDemoLabel+' · Fictional stock, suppliers and orders.'
}
const standaloneDemoRender=render
render=function(...args){const result=standaloneDemoRender(...args);standaloneDemoBadge();return result}
standaloneDemoBadge()
""".replace("__LABEL__", json.dumps(label))
    if html.count('<script type="module" id="runway-app">') != 1:
        raise ValueError("Standalone module boundary changed; review demo badge injection.")
    head, end = html.rsplit("</script>", 1)
    return head + badge + "</script>" + end


def build(template=DEFAULT_TEMPLATE, data=None):
    if template not in TEMPLATES:
        raise ValueError("Unknown standalone design template.")
    gm = template.startswith("option-gm-")
    a3 = template == "option-a3" or gm
    core = extract_core((ROOT / "desktop" / "plugin.js").read_text(encoding="utf-8"))
    baseline = (ROOT / "standalone" / "template.html").read_text(encoding="utf-8")
    if template == "baseline":
        html = baseline
    else:
        design = ROOT / "standalone" / "design"
        html = (design / ("template-gm.html" if gm else "template-a3.html" if a3 else "template.html")).read_text(encoding="utf-8")
        # Share baseline helpers verbatim; purchase-order membership/text cannot drift.
        helpers = baseline.split("/* STOCK_RUNWAY_HELPERS_START */\n", 1)[1].split("/* STOCK_RUNWAY_HELPERS_END */", 1)[0]
        controls = baseline.split('<details id="settings">', 1)[1].split('<footer>', 1)[0]
        html = html.replace("__HELPERS__", helpers).replace("__CONTROLS__", '<details id="settings">' + controls)
        css = "" if a3 else (design / "styles.css").read_text(encoding="utf-8")
        suffix = "-a3" if a3 else "-a2" if template == "option-a2" else ""
        if suffix:
            css += "\n" + (design / f"styles{suffix}.css").read_text(encoding="utf-8")
        if gm:
            css += "\n" + (design / "styles-gm.css").read_text(encoding="utf-8")
            if template == "option-gm-c":
                css += "\n" + (design / "fonts-gm.css").read_text(encoding="utf-8")
            css += "\n" + (design / f"styles-gm-{template[-1]}.css").read_text(encoding="utf-8")
            presentation = (design / "presentation-gm.js").read_text(encoding="utf-8")
            if template == "option-gm-b":
                logo = (design / "logo-gm.svg").read_text(encoding="utf-8").strip()
                html = html.replace('<span class="gm-wordmark">by GreyMatter</span>',
                                    '<span class="gm-by"><span>by</span>' + logo + '</span>')
                presentation += "\n" + (design / "presentation-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "browse-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "settings-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "settings-gm-b.css").read_text(encoding="utf-8")
                presentation += "\n" + (design / "local-orders-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "supplier-minimums-gm-b.js").read_text(encoding="utf-8")
                presentation += "\nconst gmBStartupBrowseList=buildList\n" + (design / "worklist-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "xlsx-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "weekly-summary-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "weekly-summary-gm-b.css").read_text(encoding="utf-8")
                css += "\n" + (design / "supplier-minimums-gm-b.css").read_text(encoding="utf-8")
                css += "\n" + (design / "worklist-gm-b.css").read_text(encoding="utf-8")
                css += "\n" + (design / "local-orders-gm-b.css").read_text(encoding="utf-8")
                presentation += "\n" + (design / "risk.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "chart-focus-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "chart-focus-gm-b.css").read_text(encoding="utf-8")
                presentation += "\n" + (design / "product-page-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "product-page-gm-b.css").read_text(encoding="utf-8")
                presentation += "\n" + (design / "risk-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "costs-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "costs-gm-b.css").read_text(encoding="utf-8")
                presentation += "\n" + (design / "decision-simple-gm-b.js").read_text(encoding="utf-8")
                presentation += "\n" + (design / "profit-order-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "decision-simple-gm-b.css").read_text(encoding="utf-8")
                css += "\n" + (design / "risk-gm-b.css").read_text(encoding="utf-8")
                presentation += "\n" + (design / "import-gm-b.js").read_text(encoding="utf-8")
                css += "\n" + (design / "import-gm-b.css").read_text(encoding="utf-8")
                early_theme = (design / "theme-early-gm-b.js").read_text(encoding="utf-8")
                # Upper-case terminator preserves legacy probes targeting the module's </script>.
                html = html.replace('<style>', '<meta name="theme-color" content="#f5f8fd"><script>' + early_theme + '</SCRIPT><style>', 1)
                presentation += "\nconst themeField=node('label',null,'theme-control');themeField.htmlFor='theme-choice';themeField.append(node('span','Theme'));const themeChoice=node('select');themeChoice.id='theme-choice';for(const [value,label]of [['system','System'],['light','Light'],['dark','Dark']]){const option=node('option',label);option.value=value;themeChoice.append(option)}themeChoice.value=window.stockRunwayTheme.get();themeChoice.addEventListener('change',()=>window.stockRunwayTheme.set(themeChoice.value));themeField.append(themeChoice);document.querySelector('.tools-body').prepend(themeField);\n"
                presentation = presentation.replace('render();gmSyncFields()', 'if(data.items.length<=1000)render();gmSyncFields()').replace('localOrderLoad();render()', 'localOrderLoad();if(data.items.length<=1000)render();else withDatasetEvaluation(()=>{})')
                presentation += "\n" + (design / "progressive-gm-b.js").read_text(encoding="utf-8")
                # Large startup must not normalize hashes against an empty/partial catalog.
                html = html.replace("const a3Started=performance.now()", "const gmBInitialHash=location.hash\nlet gmBRestoreHash=gmBInitialHash,gmBInitialRestorePending=true,analysisIncomplete=true\nwindow.addEventListener('hashchange',e=>{if(analysisIncomplete){gmBRestoreHash=location.hash;e.stopImmediatePropagation()}},true)\nconst a3Started=performance.now()")
                presentation = presentation.replace('function wlHash(){', 'function wlHash(){if(analysisIncomplete)return;').replace('function gmBrowseHash(){', 'function gmBrowseHash(){if(analysisIncomplete)return;')
            html = html.replace("__GM_PRESENTATION__", presentation)
        html = html.replace("__DESIGN__", template).replace("__DESIGN_CSS__", css)
        html = html.replace("__DESIGN_APP__", (design / f"chart{suffix}.js").read_text(encoding="utf-8") + "\n" + (design / f"app{suffix}.js").read_text(encoding="utf-8"))
        if template == 'option-gm-b':
            html = html.replace('let evaluationSnapshot=null', 'gmBInitialRestorePending=analysisIncomplete=data.items.length>1000\nlet evaluationSnapshot=null')
            html = html.replace("initializeSheets();initializeLearning();syncSettings(); render()", "initializeSheets();initializeLearning();syncSettings(); if(data.items.length<=1000)render();else{withDatasetEvaluation(()=>{});setTimeout(()=>render(),0)}")
        if a3:
            copy_source = (design / "strings-a3.js").read_text(encoding="utf-8")
            strings = json.loads(copy_source.split("const STRINGS = ", 1)[1].split("\nconst S =", 1)[0])
            html = html.replace('<details id="settings">' + controls, (design / "controls-a3.html").read_text(encoding="utf-8"))
            html = re.sub(r"__S_(\w+)__", lambda match: html_module.escape(strings[match[1]], quote=True), html)
            extras = "\n".join((design / name).read_text(encoding="utf-8") for name in ("health.js", "why-a3.js", "learning-a3.js"))
            html = html.replace("const a3Started=performance.now()", copy_source + "\n" + extras + "\nconst a3Started=performance.now()")
    # One shared review module for every standalone variant, outside the pure core.
    design = ROOT / "standalone" / "design"
    smart_js = (ROOT / "desktop/cost-view.js").read_text(encoding="utf-8") + "\n" + (ROOT / "desktop/profit-warnings.js").read_text(encoding="utf-8") + "\n" + (design / "smart-import.js").read_text(encoding="utf-8")
    smart_css = (design / "smart-import.css").read_text(encoding="utf-8")
    html = html.replace("/* STOCK_RUNWAY_CORE_END */", "/* STOCK_RUNWAY_CORE_END */\n" + smart_js, 1)
    html = html.replace("</style>", smart_css + "\n</style>", 1)
    if template == "option-gm-b":
        html = html.replace("</style>", (design / "theme-gm-b.css").read_text(encoding="utf-8") + "\n</style>", 1)
    if html.count("__STOCK_RUNWAY_CORE__") != 1:
        raise ValueError("Template must contain exactly one core placeholder.")
    if data is not None:
        html = inject_demo(html, data)
    html = html.replace("__STOCK_RUNWAY_CORE__", core, 1)
    styles = "\n".join(re.findall(r"<style\b[^>]*>(.*?)</style>", html, re.I | re.S))
    embeds_fonts = bool(re.search(r"@font-face\b", styles, re.I))
    # Single-file downloads carry the complete license texts, not only links
    # which would be broken when an HTML asset is copied on its own.
    license_files = ['LICENSE', 'THIRD_PARTY_NOTICES.md']
    notice = LICENSE_NOTICE
    if embeds_fonts:
        license_files.append('LICENSES/OFL-1.1.txt')
        notice += FONT_LICENSE_NOTICE
    documents = {name: (ROOT / name).read_text(encoding='utf-8')
                 for name in license_files}
    # Non-executable JSON preserves exact license bytes, including double
    # hyphens forbidden inside HTML comments. Escape HTML delimiters and keep
    # the uppercase terminator used by other early metadata/script blocks.
    legal = json.dumps(documents, ensure_ascii=False).replace('<', '\\u003c')
    full_notices = '<script type="application/json" id="stock-runway-distribution-licenses">' + legal + '</SCRIPT>'
    # Some embedded export helpers contain an HTML <head> string as data;
    # only the first, actual document head near the start is an insertion site.
    head = html.find('<head>')
    if not 0 <= head < 512:
        raise ValueError('Standalone template needs an early document head for license metadata.')
    html = html.replace('<head>', '<head>\n' + full_notices, 1)
    return '<!--\n' + notice + '-->\n' + html


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", choices=TEMPLATES)
    parser.add_argument("--out", "--output", dest="output", type=Path,
                        help="Output HTML path (--output remains supported).")
    parser.add_argument("--data", type=Path, help="Optional synthetic stock dataset JSON; requires a separate --out.")
    args = parser.parse_args()
    data = None
    if args.data is not None:
        if args.output is None:
            parser.error("--data requires an explicit, separate --out HTML path")
        protected = {ROOT / "standalone/inventory-manager.html"}
        protected.update(ROOT / f"standalone/design/{name}.html" for name in TEMPLATES)
        if args.output.resolve() in {p.resolve() for p in protected}:
            parser.error("--data must use a separate output, not a standard sample build")
        if args.output.resolve() == args.data.resolve():
            parser.error("--out must not overwrite the input dataset")
        try:
            if args.data.stat().st_size > 16 * 1024 * 1024:
                raise ValueError("Demo data must be no larger than 16 MiB.")
            data = json.loads(args.data.read_text(encoding="utf-8"))
            if data is None:
                raise ValueError("Demo data must be a stock dataset, not null.")
        except (OSError, ValueError) as error:
            parser.error(str(error))
    if args.output is None:
        args.output = ROOT / "standalone" / ("inventory-manager.html" if args.template is None else f"design/{args.template}.html")
    try:
        output = build(args.template or DEFAULT_TEMPLATE, data=data).encode("utf-8")
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    print(f"Built {args.output} ({len(output)} bytes; exact Desktop JS core, no dependencies)")
    if args.template is None and args.data is None and args.output.resolve() == (ROOT / "standalone/inventory-manager.html").resolve():
        alias = ROOT / "standalone/stock-runway.html"
        alias.write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=inventory-manager.html"><title>Inventory Manager</title><p><a href="inventory-manager.html">Open Inventory Manager</a></p>\n', encoding="utf-8")
    if args.data is not None and args.output.resolve() == (ROOT / "standalone/inventory-manager-demo-1000.html").resolve():
        alias = ROOT / "standalone/stock-runway-demo-1000.html"
        alias.write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=inventory-manager-demo-1000.html"><title>Inventory Manager</title><p><a href="inventory-manager-demo-1000.html">Open Inventory Manager demo</a></p>\n', encoding="utf-8")


if __name__ == "__main__":
    main()
