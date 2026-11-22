Lifecycle: living

# Worklist layout regressions: QA-P1-001 and QA-P2-002

## Scope and root causes

- **QA-P1-001 — missing layout invariant:** optional clearance and cost summaries
  consume more than the fixed mobile worklist height. Products previously shrank
  to `clientHeight=0`, while every ancestor clipped overflow. The worklist shell
  now scrolls vertically and the virtual product scrollport reserves 208 content
  pixels (two 104-pixel phone rows, plus its two border pixels).
- **QA-P2-002 — observer feedback:** the worklist ResizeObserver synchronously
  rebuilt phone controls even on height-only changes. Those writes could resize
  its own observed scrollport. An isolated WebKit probe of the original build
  emitted the warning normally and when chart observer delivery was disabled;
  disabling only worklist observer delivery removed it. The fix defers/coalesces
  worklist writes to an animation frame, skips unchanged dimensions, and does not
  rebuild controls on a height-only change. No errors are filtered or suppressed.

Only authored `worklist-gm-b.css` / `worklist-gm-b.js` layout code changed.
Desktop's unrelated measurement hook, presets, storage, profit, methods and
protected baselines are untouched. The parent must rebuild generated pages.

## Reproduce and verify offline

Use the existing synthetic `all.csv`, `cost.csv`, and `profit.csv` from the prior
browser-QA fixture directory; do not substitute customer files.

```sh
PLAYWRIGHT_MODULE=<local-node_modules>/playwright/index.js \
CHROMIUM_EXECUTABLE=<local-qa-chrome> \
QA_FIXTURE_DIR=<local-scratch>/v12/browser-qa \
QA_RUN=accepted node standalone/capture-layout-regression.cjs
node --test tests/worklist-layout.test.mjs
node --max-old-space-size=1024 --test tests/*.mjs
```

The browser runner builds only ignored `.scratch/layout-regression/<run>/sample.html`.
It imports real CSVs through review dialogs, toggles custom cost columns / profit,
checks 390×900 and 1440×900 in light/dark, wheels the outer shell, opens all three
products with pointer clicks, opens a product by keyboard, crosses breakpoints,
and collects unfiltered browser errors, screenshots and sampled process RSS.
WebKit runs if its existing executable is available; no browser installation runs.

## Local proof on this patch

- Original source: **24 scenarios, 8 failing checks** (collapsed mobile all-feature
  list in both engines/themes; WebKit phone cost/profit observer errors).
- Patched source: **24 scenarios, 230 checks, 0 failures**, Chromium
  **159.0.8154.13** and WebKit **27.2**. Zero page/console errors and HTTP requests.
- Phone clearance+cost list: `clientHeight=208` in both engines/themes. Native
  outer scrolling exposes its 210-pixel border box at y=646…856; all three product
  pointer activations and keyboard activation pass. Inner virtualization stays
  bounded; rows outside its viewport intentionally require scrolling.
- Largest sampled owned process: **243456 KiB RSS**, below the 2-GiB limit.
- Observer unit regression: **3/3 pass**; all three fail against the original
  worklist observer. Full Node suite: **3642/3642 pass**. Syntax checks and
  `git diff --check` pass.
- Raw handles: `.scratch/layout-regression/accepted/report.json`, its 24 PNGs,
  `observer-attribution.json`, `red-complete/report.json`, `unit-red.log`, and
  `node-suite.log` under `.scratch/layout-regression/`.

Not checked: hosted/deployed pages, native Safari/iOS, Desktop React runtime,
Python suite, large-catalog browser performance, or final parent-generated pages.
These are local synthetic browser/layout results, not release approval.
