Lifecycle: living

# Design candidate sources

Inputs: `../build.py`, exact core from `../../desktop/plugin.js`, helpers and operational controls from `../template.html`; synthetic/sample data only.
Job: isolated offline visual candidates. Never change forecasts in a renderer or hand-edit generated HTML.
Outputs: `option-a.html`, `option-a2.html`, `option-b.html`; A3 is authored in `template-a3.html`, `styles-a3.css`, `chart-a3.js`, `app-a3.js` and generated as `option-a3.html`.
Human check: run the repository Python/Node suites; `../capture-a3.cjs` produces the six A3 screenshots and `.scratch/design/a3-browser-report.json` when Chromium can launch. A3's source/evidence route is [A3.md](A3.md). Comparison sources and exports stay unchanged.

GreyMatter additive polish: [GM.md](GM.md) routes `option-gm-a/b/c` builds from `template-gm.html`, shared `styles-gm.css` / `presentation-gm.js`, per-variant CSS and C-only embedded fonts. Original A3 forecast logic stays unchanged; shared import fixes are rebuilt into every candidate. `../capture-gm.cjs` and `../qa-gm.py` write screenshot, contrast and numeric evidence to `.scratch/brand/`; raw displayed numeric-token additions are explicitly qualified separately from exact unchanged calculations.

Arctic product reports and first-class product-type groups: [PRODUCT-PAGE.md](PRODUCT-PAGE.md) identifies the presentation-only sources, nested navigation contract and bounded design-approval capture route.
