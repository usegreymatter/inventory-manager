Lifecycle: living

# GreyMatter keep-DNA candidates

Three additive candidates, not a replacement for the owner-approved A3 layout. For the store operator deciding what to buy, preserve A3's product list, native quantity/why sheet, settings, import and purchase-order actions. Refine hierarchy, readable type, open chart and redundant shape/word status. No new forecast, source data, formula, learning policy, or purchase-order logic.

| Build | Direction | Difference |
| --- | --- | --- |
| `option-gm-a` | A · Quiet | System UI stack; order quantity in ink. |
| `option-gm-b` | B · Status-led | Same layout/type; actionable Order-now quantity in dark red. |
| `option-gm-c` | C · Brand type | B plus embedded Poppins 400/600 and prepared Tajawal 400/500. |

Owner selected **B · Status-led, Arctic ice-white, official GreyMatter logo** on 14 Nov 2026. A and C remain comparison alternatives, not selected builds.

## Selected B finish

`styles-gm-b.css` scopes the Arctic palette to B: canvas `#F5F8FD`, selection/control fill `#E6ECF7`, line `#D9E1EE`, rule `#C1CBDC`, ink `#0B1020`, muted `#5B6274`, accent `#3F5687`, status red `#B42318`, OK marker `#2F7D6E`. The stock chart is SVG (no canvas/clear-colour runtime); its wrapper and SVG background match the page exactly. White inputs use the Arctic hairline. A3/A/C sources and generated files remain byte-identical.

`logo-gm.svg` is the cleaned official `LOGO SVG-01.svg`, with st0 converted to `#0B1020`, styles/IDs removed. The source defines st1 but applies it to **zero shapes**, so no `#8A8F98` path is fabricated. The builder inlines it in B only, after “Stock Runway by”; height is 14px desktop / 12px phone with accessible GreyMatter name. No text-only wordmark remains in B.

`presentation-gm-b.js` retains all calculations/dates/quantities and adapts presentation only:
- Relative dates count from `data.as_of`, the physical forecast snapshot, explicitly saying e.g. **in 20 days from 31 Oct**. The actual decision date still drives the unchanged purchase guidance and chart Today line; the header identifies the stock snapshot, not the wall clock. CLI/Python calculation policy is unchanged, verified by full parity and golden suites.
- Phone charts show Today, Runs out, optional monthly Arrives and at most three month ticks, with receipt annotations and optional per-bar value labels suppressed. Native accessible receipt markers/tooltips survive. Optional numeric demand labels also yield to direct series names on desktop to prevent 6M collisions.
- Demand uses exact `#AEB8CA` fill at full opacity. That colour is **1.877:1**, not 3:1 against Arctic: full-contrast `#5B6274` outlines provide **5.728:1** meaningful graphical boundaries. Forecast boundaries remain dashed; no bar values or geometry change.
- Status red `#B42318` is **6.176:1**, not 7:1. The urgent key quantity uses scoped dark-red ink `#8E1B13` (**8.517:1** on page / **7.644:1** on selection); the approved status red stays exact for other status signals. OK green is graphical, not selected-row text. All UI text colour pairs are at least 4.5:1 on both surfaces; logo/logotype is exempt.
- Keyboard hints stay muted 12px on desktop and disappear at phone widths or coarse/touch pointers.
- The retained tooltip floats inside the figure rather than changing its height: opening it no longer resizes/replaces its own focused marker or pushes the phone chart below the screen.

Additional local acceptance: `node standalone/capture-arctic.cjs` writes final viewport and actual receipt-tooltip screenshots, checks all five sample products × four ranges × two viewports, rendered text contrast, label collisions, touch hints, exact surfaces, logo sizing and an explicitly synthetic optional-arrival fixture. `python3 standalone/qa-arctic.py` writes qualified contrast evidence; it does not falsely claim the pale demand fill reaches 3:1.

Final evidence in `.scratch/brand/`: `final-gm-b-1440x900.png`, `final-gm-b-390x844.png`, matching `-tooltip.png` files, `arctic-browser-report.json` (380 checks), `arctic-contrast.json`, and refreshed `brand-browser-report.json` (301 checks; calculated rows/series identical). Vision review found no visible text overlap/clipping in desktop/phone/tooltip states. Full Python suite: 1,620 passed; full Node suite: 2,454 passed (both Python environment overrides `/usr/bin/python3`); A3 browser capture: 161 checks passed; golden diff: all SKUs/all fields unchanged. Source rebuilds prove A3/A/C byte-identical to `7bd19a0`. Exact commands and logs stay in the final command receipt.

## Source boundaries

- `template-gm.html`: additive shared shell; quiet `by GreyMatter` wordmark, no A3 edition label.
- `styles-gm.css`: shared semantic token/scale layer on top of A3's original CSS.
- `styles-gm-{a,b,c}.css`: only the named variant differences.
- `fonts-gm.css`: offline base64 WOFF2 font subsets, C only.
- `presentation-gm.js`: shared DOM/SVG presentation adapter. Moves the original status node ahead of product/title; retains existing buttons/listeners; formats existing dates; splits the original stock-path geometry into solid past and dashed forecast; adds direct labels and diamond receipt markers. Never mutates rows, guidance, projections, stock or demand.
- `app-a3.js`, `chart-a3.js`, `learning-a3.js`, health/why code, strings, controls and extracted Desktop core/helpers are embedded verbatim. Existing outputs including `option-a3.html` remain byte-identical.
- `capture-gm.cjs`: isolated offline Chromium captures, visible-number dumps and complete calculated-row equality checks.
- `qa-gm.py`: WCAG contrast ratios, actual screenshot colour-matrix simulation, comparison sheets, exact calculated-row byte comparison. Uses the already-installed Pillow; no install is required for page builds.
- `tests/test_gm_build.py`: additive build/source/font/offline checks.

Unknown arrival dates stay **Unknown**. Receipt sources contain monthly totals, so their direct labels say **Received Jun 2026** / **Arrives [month]**, with an exact-day-unavailable note; they never fabricate the illustrative brief's “9 Dec”. Actual run-out dates, not the brief's example dates, are used. The chart's original numeric scale and all points/values are retained. `Today` is placed at the actual decision date on the existing monthly time axis, distinct from the stock snapshot/forecast boundary.

## Build and capture

```sh
export TMPDIR=$PWD/.scratch
/usr/bin/python3 standalone/build.py --template option-gm-a
/usr/bin/python3 standalone/build.py --template option-gm-b
/usr/bin/python3 standalone/build.py --template option-gm-c
node standalone/capture-gm.cjs
/usr/bin/python3 standalone/qa-gm.py
/usr/bin/python3 -m pytest tests -q
PYTHON=/usr/bin/python3 node --test tests/*.test.mjs
node standalone/capture-a3.cjs
/usr/bin/python3 scripts/golden_diff.py
```

Open any `option-gm-*.html` directly from disk; self-contained, no server, network, build runtime or installation. Evidence stays ignored in `.scratch/brand/`, including matching baseline/variant PNGs at 1440×900 and 390×844, full-size separate images plus overview sheets, colour simulation, contrast and numeric JSON. Capture time is frozen to 12 Nov 2026 so sample snapshots and decisions remain deterministic. A3 has **no Arabic toggle**: EN only was captured, not a claimed Arabic translation. Logical CSS properties, untested Arabic direction/scale preparation, LTR chart axis and embedded Tajawal are not evidence of translated Arabic UI or real-device RTL QA.

## Numeric evidence: important qualification

`brand-browser-report.json` dumps **every visible numeric text token** for all five sample products, four ranges, two viewports and four candidates (160 states). Full calculated rows are also exported for each candidate, and every rendered demand/stock/receipt data value plus the displayed purchase quantity is checked against A3. The full calculated JSON files are byte-identical: **zero changed fields**. Golden diffs are unchanged.

A literal zero diff of the raw **displayed token sequence** cannot coexist with the brief's required full years, relative day counts and direct event/date labels: these add numeric text and move the status/order/date layout. The report therefore explicitly retains 120 raw-token differences across the three new candidates; it does **not** falsely claim zero raw-token differences. No purchase, stock, demand, receipt quantity or forecast date is changed. Controller acceptance of this presentation-only qualification is still required if raw token identity is interpreted literally.

## Embedded font provenance and size

FontTools performed Unicode subsetting, with local Node's built-in Brotli codec because this system's FontTools lacked the Python Brotli extension. No dependency install/network. Kept Latin/Latin Extended, punctuation, Arabic ranges and shaping features. Original brand sources:

- `Branding/FONT FILES/Poppins-Regular.ttf`: 158,240 bytes → 10,572-byte WOFF2 (14,096 base64 bytes).
- `Branding/FONT FILES/Poppins-SemiBold.ttf`: 155,232 → 10,684-byte WOFF2 (14,248 base64 bytes).
- `Branding/System/invoice-v2/assets/fonts/Tajawal-400.woff2`: 8,932 → 8,440-byte WOFF2 (11,256 base64 bytes).
- `Branding/System/invoice-v2/assets/fonts/Tajawal-500.woff2`: 8,940 → 8,368-byte WOFF2 (11,160 base64 bytes).

See `.scratch/brand/fonts.json` and `.scratch/prepare-gm-fonts.py` for the local source/subset receipt. All key text colour pairs pass WCAG AA (minimum 4.538:1 on selected subtle fill). The B deuteranopia PNG is a **simple approximate channel matrix**, not clinical colour-vision certification; filled dot versus hollow ring, diamond markers and plain words remain the primary redundant signals.

Not checked: translated Arabic app (none exists), physical touch/iPhone safe areas, Safari/Firefox, owner aesthetic approval, hosted/live ERP, or acceptance of literal raw visible-token identity. Local screenshot review does not establish any of those.
