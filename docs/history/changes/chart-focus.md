# Arctic chart focus — local acceptance receipt

Lifecycle: evidence. Offline built-in samples and explicitly labeled synthetic
fixtures only; no live ERP, deployment, install, push, or external data access.

## Delivered

- Chart-first compact drawer; product metadata and decision details below chart.
- One figure moves into full-window focus (not a cloned chart): Expand, chart
  tap/click, F, previous/next, native swipe, range controls, Escape and Close.
- Stock fill and forecast shading reuse the existing monthly series unchanged.
- Worklist days-left uses the same snapshot date as the drawer. Drawer title is
  below sticky navigation; low-priority columns hide when drawer space is tight.

Sources: `standalone/design/chart-focus-gm-b.{js,css}`, build integration,
`presentation-gm-b.js`, `worklist-gm-b.js`; generated portable/design HTML match.

## Root causes and regression guards

1. **Touch event lifecycle / legacy tooltip ownership.** Touch emits pointerleave
   on finger lift. Do not dismiss a pinned touch tooltip then. Intercept receipt
   click and Enter/Space before legacy delivery-only handlers. Worklist Enter must
   not consume receipt activation. `capture-chart.cjs` checks full monthly demand,
   stock, receipts and exact-month values after native touch and keyboard input.
2. **Harness target collision / cascading blocked controls.** A fixed tap position
   sometimes hit a receipt, which correctly showed a tooltip rather than opening
   focus. The abandoned drawer/focus then covered Close and later product rows.
   Target the SVG gutter for explicit chart expansion and close focus before the
   drawer. Phone `.work-product` is valid; no replacement card selector is needed.
3. **Navigation boundary confusion.** Legacy swipe changed selected SKU behind
   the overlay without replacing its figure. Route shared navigation through
   close/navigate/reopen; verify native swipes synchronize SKU, figure, product
   name and counter, with exactly one mounted chart.
4. **Nested modal shortcut collision.** F over an open settings dialog could make
   the dialog inert beneath an inaccessible overlay. Both focus-opening paths
   respect open native dialogs; test F followed by successful settings dismissal.
5. **Generated output drift / visual clipping.** WIP source and committed output
   disagreed. Regenerate both outputs, keeping compact header, axis labels and
   legend visible. Replace zero-font status heading with an explicitly named
   sortable control; do not weaken font-floor audits.

## Commands and actual results

Environment: `TMPDIR=$PWD/.scratch`, `PYTHON=/usr/bin/python3`,
`FORECAST_LAB_PYTHON=/usr/bin/python3`. Browser captures use existing
`PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js`
and `CHROMIUM_EXECUTABLE=/path/to/chrome`.

| Command / gate | Result |
| --- | --- |
| `/usr/bin/python3 standalone/build.py` and `--template option-gm-b` | both generated; byte-identical outputs |
| `/usr/bin/python3 -m pytest -q` | 1,672 passed, exit 0 |
| `node --test` over all 25 `tests/*.test.mjs`, four file subsets | 2,475 passed, exit 0; subsets 2,282 / 45 / 112 / 36 |
| `node standalone/capture-chart.cjs` | 985/985 checks, 126 completed stages, 90 tooltip observations, 15 snapshot-day comparisons |
| `node standalone/capture-table.cjs` | 141/141 checks |
| `node standalone/capture-browse.cjs` | 31/31 checks |
| `node standalone/capture-settings.cjs` | 35/35 checks |
| `node standalone/capture-arctic.cjs` | 461/461 checks; all four ranges |
| `node standalone/capture-gm.cjs` | 299/299 checks |
| `node standalone/capture.cjs` | 105/105 checks |
| `node standalone/capture-a2.cjs` | 268/268 checks |
| `node standalone/capture-a3.cjs` | 161/161 checks |
| `node .scratch/brand/audit.mjs` | 2 viewports, 16 states; no offscale text, small targets or overflow |
| `/usr/bin/python3 scripts/golden_diff.py` | every SKU/field unchanged across JS/Python/CLI |
| `git diff --check` | exit 0 |

All nine browser capture suites: **2,486 passing checks**. Reports and raw logs
are ignored local evidence under `.scratch/{chart,table,browse,settings,brand,design,standalone,verify}`.

The shell `pytest` entrypoint was not on PATH; the installed module works via
`/usr/bin/python3 -m pytest`. One Node subset transiently hung in a Python parity
bridge during concurrent gates; timed-out owned processes were stopped, and the
same six files passed under `--test-concurrency=1` (36 tests). No assertion or
product code was changed to bypass the hang.

Independent review found the swipe, modal-F and receipt-keyboard defects above;
all were fixed and added to strict browser acceptance. The reviewer's disposable
probe was rerun after fixes: no browser errors, synchronized desktop/phone swipes,
complete keyboard receipt tooltip, and dismissible settings after F.

## Visual evidence

Final required screenshots reviewed for overlap/clipping/clarity:

- `.scratch/chart/drawer-1457.png`
- `.scratch/chart/focus-1457.png`
- `.scratch/chart/focus-1440.png`
- `.scratch/chart/phone-detail.png`
- `.scratch/chart/phone-focus.png`

Header, controls, chart ticks and legend pass visual review. Metadata or decision
content below the chart is intentionally reachable by scrolling. Today/runout
marks are close where the underlying dates are close; labels remain separate.

Not checked: physical phones, Safari/Firefox, hosted/live data, deployment, owner
aesthetic approval. Forecast math and engine sources were not changed.
