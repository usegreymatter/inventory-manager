Lifecycle: living

# v1.2 integration — local offline candidate

## Scope and invariants

Merged lanes E `4f1b073`, P `af7014d`, M `7fe9f1b`, C `73530298` in that order. Resolved shared import fields as a union and shared shelf-setting keys with one definition. Presets remain one-time ordinary-setting applications; engine never reads recipe names. Recommended methods remain opt-in. Cost figures never change quantities. No O/profit-optimal lane is included.

Closed shell gaps: commercial **Get rid of by** lists, capped badges, explicit expiry-date acknowledgement for CSV/JSON/workbook flows, text-only DOM rendering, narrow-width styles, and truthful global preset warnings. Added CLI `--method recommended`. Integrated cost output already consumes the real `expiry_at_risk_qty` from E; a real-lot CLI regression proves `expiry_value_at_risk = expiry_at_risk_qty × unit_cost` without a fabricated hook.

## Default-off proof BEFORE refreshing pins

`scripts/golden_diff.py`: exit 0, every SKU/every field unchanged. `scripts/verify_import_examples.py`: exit 0 for all eight examples. All eight CLI exports returned 0; exact `order_qty`, `on_hand`, `on_order`, `safety_stock`, and `reorder_point` equal the extracted public-v1.1.0 (`v12-base`) CLI on 2026-04-01. Existing golden files and historical source fixtures were not rewritten.

Owner-approved exception: QuickBooks already contains `Sales Price = 9.99`. Its expected imported item now adds only `sale_price: 9.99`. Import report changes are exactly the corresponding recognized-field mapping replacing the ignored Sales Price column. No input CSV or quantity changed. Historical verification logs remain historical.

```diff
--- v1.1 QuickBooks imported items
+++ v1.2 QuickBooks imported items
@@ -10,6 +10,7 @@
       110,
       120
     ],
-    "receipts": {}
+    "receipts": {},
+    "sale_price": 9.99
   }
 ]
```

## Every refreshed byte pin / fingerprint

New full-source checkpoint `cee2550` supersedes only the active engine/import snapshot. The prior 34 vendored sources stay untouched; three new reviewed sources bring the exact manifest assertion to 37. The guard now checks the entire approved engine directly, which is stronger than reconstructing pre-v1.2 engine bytes after removing display helpers; exact helper-span checks and mutation-rejection checks remain enabled.

- **docs/forecast-methods-baseline.json** — `export const DEFAULT_ORDER_SETTINGS`
  - `3e7d319fd69219db1ba94da6ccd5d8f70068eb9202222ed62efbb8458d1177da` → `edddf991d8be552e23090b523546c7b66c6b78883ff2ff7cce19e141d9c4c9d6`
  - Why: E shelf settings, P recipes, M recommended method; unified shelf key definition.
- **docs/import-logic-baseline.json** — `pureBlock`
  - `02e370af7058a318533e34bcef5230381ddfeacde6777d507c5bc00853e57ecb` → `f04419364731813176464162283fe8b31a811a3e0d53335d130168b7a37bd1ce`
  - Why: E/P/M/C integrated pure JS; golden_diff unchanged.
- **docs/import-logic-baseline.json** — `engine.py`
  - `0d57278d36910a92de0cc65db70196ce6e85c7cf04c044f638969af11df7a86e` → `8c4beabbd69fc314aeac22c00d37d7f94fde79145b50211953b1bcdf0b68eb47`
  - Why: E shelf/lot import and engine, M opt-in forecast selection, C sale_price import.
- **docs/import-logic-baseline.json** — `pin engine.py`
  - `f2509b4` → `cee2550`
  - Why: Approved integrated source checkpoint, exact fixture retained for export-safe checks.
- **docs/import-logic-baseline.json** — `csv_import.py`
  - `3500576741e2b09ecbac4d88146a9f73f9c7980759d6b13bab1e7a6b252a68fd` → `8c57d697303192f090c2a5f59ff425150cbcfeba7f589ff7286a09b879ea010e`
  - Why: E shelf/lot import and engine, M opt-in forecast selection, C sale_price import.
- **docs/import-logic-baseline.json** — `pin csv_import.py`
  - `74572d6` → `cee2550`
  - Why: Approved integrated source checkpoint, exact fixture retained for export-safe checks.
- **docs/import-logic-baseline.json** — `sources.py`
  - `2da814a6a1d1a34ce24985fefce99253c626dee96098f3f2f2d23b25074479bb` → `3b006371d3ab2ddaaba707eb9d823374d5c20415aefd8cffeba67d7e04092874`
  - Why: E shelf/lot import and engine, M opt-in forecast selection, C sale_price import.
- **docs/import-logic-baseline.json** — `pin sources.py`
  - `74572d6` → `cee2550`
  - Why: Approved integrated source checkpoint, exact fixture retained for export-safe checks.
- **tests/fixtures/baselines/manifest.json** — `cee2550:engine.py`
  - `absent` → `8c4beabbd69fc314aeac22c00d37d7f94fde79145b50211953b1bcdf0b68eb47`
  - Why: New v1.2 protected source snapshot; historical 34 untouched.
- **tests/fixtures/baselines/manifest.json** — `cee2550:csv_import.py`
  - `absent` → `8c57d697303192f090c2a5f59ff425150cbcfeba7f589ff7286a09b879ea010e`
  - Why: New v1.2 protected source snapshot; historical 34 untouched.
- **tests/fixtures/baselines/manifest.json** — `cee2550:sources.py`
  - `absent` → `3b006371d3ab2ddaaba707eb9d823374d5c20415aefd8cffeba67d7e04092874`
  - Why: New v1.2 protected source snapshot; historical 34 untouched.
- **tests/r2-protected-maths.test.mjs** — `protected plugin core`
  - `ab516ecff178109f1dfa20a71fed792027d2d33fddaff12d4adf37d021d4ffa0` → `dd1900da7f0de2f209166e8f086d4341b01e0ef46f520adc7acf5d80e9ca40f2`
  - Why: E shelf caps, M recommended opt-in, P unified settings; default-off parity verified.
- **tests/r2-protected-maths.test.mjs** — `engine.py`
  - `5dd43283a2628db577fd3a055e7619f1398e8095bf7403882a6c4f4414831945` → `8c4beabbd69fc314aeac22c00d37d7f94fde79145b50211953b1bcdf0b68eb47`
  - Why: E shelf caps, M recommended opt-in, P unified settings; default-off parity verified.
- **docs/forecast-methods-baseline.json** — `      // Owner 'align this'`
  - `27285fb07d27e0edf593dce0520d3018037ae078f3a74557c5485a012024a912` → `72f26a99a777fe0929da7cbd82ceaa7153bef89689224be918f3e611a432dab6`
  - Why: E shelf display in selected product; M method explanation; C cost presentation.
- **docs/capture-polish.cjs** — `display helper span`
  - `f4b2d029cfe1624149931a19817509ec493540bf0f9ed9c4a4e994e89e6dd516` → `8b9b3583a2afe3c1c6102b0fef3eb66facaa2adebdbf35ec514056a511f507ae`
  - Why: E ceiling/cap explanation and expiry warning; full approved engine snapshot also required.
- **docs/capture-polish.cjs** — `attribution helper span`
  - `ce0a0dc3811f452bb322114d1ae939ea0789f482f527a842ff41912007acbea8` → `3265a230703957e64d5e183302c6e70afe33e06b1dbb93f264bbec9a70f3d23f`
  - Why: E usable-stock attribution; exact span and full engine assertions retained.

## Rebuilt outputs

All eight templates, default and demo-1000 rebuilt from source; `cmp standalone/stock-runway.html standalone/design/option-gm-b.html` returned 0. Generated HTML is committed, not ignored. File hashes below are before (`v12-base`) → after.

- `standalone/design/baseline.html`: `7df73483eaaae3e309c1b7e6c5da939d041d005eb21e00c899c52d1be4668539` → `6469f271bd9a1b0f6c720dd85ca937c538de5b4198f124e21422d7470a350fea` (E/P/M/C shared source rebuild).
- `standalone/design/option-a.html`: `db4ef6c900b5f93321df9b20728f76b6bafe4c135e060837a1134a2e5c47083c` → `e21ed8b0399b223dc4e426fc8dfbb0da256f92c3f15a3a4475283404976bedf2` (E/P/M/C shared source rebuild).
- `standalone/design/option-a2.html`: `6dfd9b3363a7054cc36bcfc407c348d14bc5b96a0156559c67bcc51029d8c62e` → `2dab639b38a501371422893d4d1d9641a080ed0692cdfae7e2078a98e18220c4` (E/P/M/C shared source rebuild).
- `standalone/design/option-a3.html`: `d762a797a75f97963c38d2a6014176682ae0cbacb26dc51b072ff0156ead2e6d` → `0655ad0e383b2065826b1dab39806e9aefcc4ebb92a9ce2193d110cb6e8a945f` (E/P/M/C shared source rebuild).
- `standalone/design/option-b.html`: `51a7e48dccdf570bd08b46406e53cc06a04ad7e6a34d7a1c9bd08daa8f9b7aa2` → `bec3dbb51dd1aa60476b1ede9876c9c284d6d27741945c0904e6d49d205fe973` (E/P/M/C shared source rebuild).
- `standalone/design/option-gm-a.html`: `d45cff4f88c93d23c1b58c4a5391cb1db27bef6a0f5192f6f4e6bcff872a4462` → `d87df00fe84255e21feb205285fead9cecd03e35d4d3f43f75191542a81b3f18` (E/P/M/C shared source rebuild).
- `standalone/design/option-gm-b.html`: `fd742db4ff0dff2963a3d621343a3a32d8f127f8d30e7cfa1ce81e964e80480a` → `01937c66abf4f7ee7001464988c6f8f04415d1344ef32c8532c5e9d080d994b8` (E/P/M/C shared source rebuild).
- `standalone/design/option-gm-c.html`: `e13d1e039d2d0fe1c6361ac9f40f54dd638661e0c5c3cec21741b48b2c29670c` → `0305b94e63dc93d5ce6424b519e263e44a1f5cdb6a4e3df563f2bd36489ae16c` (E/P/M/C shared source rebuild).
- `standalone/stock-runway.html`: `fd742db4ff0dff2963a3d621343a3a32d8f127f8d30e7cfa1ce81e964e80480a` → `01937c66abf4f7ee7001464988c6f8f04415d1344ef32c8532c5e9d080d994b8` (E/P/M/C shared source rebuild).
- `standalone/stock-runway-demo-1000.html`: `eaa49a01c806a3db697d5c62f65a86cde20ef28ac645473caf4c579dfc3b7c12` → `71c765af1a085ab0fe7bd4391f52b55db5a01877f1fe792d737f9e2852dfe0d9` (E/P/M/C shared source rebuild).

## Verification receipts

Evidence is synthetic/offline local-source and SDK-shim harness evidence, not installed Desktop/live ERP proof. Full machine-readable receipts: [verification](v12-integration-verification.json), [ERP quantities](v12-integration-erp.json).

- `node --test tests/*.mjs`: **3620 passed**, exit 0.
- `/usr/bin/python3 -m pytest -q`: **2151 passed**, exit 0.
- `/usr/bin/python3 -m unittest discover -s tests`: **294 passed**, exit 0.
- `golden_diff`: exit 0, all fields unchanged; no existing golden modified.
- `verify_import_examples`: exit 0, 8/8; separate extracted-v1.1 CLI comparisons retain identical quantities for all eight.
- `check_docs`: exit 0, zero problems; cost/smart-import synchronization checks exit 0.
- Independent round-3 kit: **562 cases** (62 directed + 500 fuzz; 444 CSV + 118 XLSX), **444 original CSV CLI runs**, status PASS, exit 0.
- **38/38 browser capture scripts** ultimately exit 0: all 31 `standalone/capture-*.cjs`, all six `docs/capture-*.cjs`, plus `tests/capture-auto-v12.cjs`. Polish used `--label after`; stress used `--label final --current`. Harness built with the existing esbuild production/SDK/React aliases. The one initial capture failure expected the pre-v1.2 17-option method list; exact 18-option assertion now includes Recommended. Its next failure exposed a real phone-layout regression: placing recipes first pushed method controls below the viewport. Keeping the method group before recipes restores the existing complete-visible geometry assertion; no assertion was relaxed.
- New `node standalone/capture-shelf-v12.cjs`: **42 checks**, four width/theme combinations (1440/390, light/dark), real caps/clearance, malicious-text escaping, explicit expiry acknowledgement, zero page errors/network requests. Cost capture now verifies real FEFO lot output, not a synthetic at-risk property.

- Known range-hygiene debt: `git diff --check v12-base..HEAD` returns 2 for a Lane M extra EOF blank in `forecast_methods.py:374` and original trailing whitespace retained byte-for-byte in the new `cee2550/csv_import.py:399` source fixture. These are formatting findings, not test failures. The fixture is intentionally not normalized because it must match the reviewed source checkpoint exactly; working-tree `git diff --check` is clean.

### Review-driven follow-ups

Opus review found stale Desktop preset-preview and presets-doc copy; both now state the actual cap behavior while retaining the global-scope warning. A second outside-family check found that the first embedded-CLI regression could be masked by test collection; it now spies on the exact engine-package cost import and asserts a real margin. Cost/risk sibling resolution supports named packages and top-level engine imports. Missing optional risk analysis omits the estimate without losing known cost figures. The round-3 kit initially exposed the hardcoded CLI-private-package import; the corrected final run passes all cases.

The standalone method group intentionally stays above recipes for 390px visibility; Desktop retains its own component layout. New shelf capture and benchmark commands are documented below rather than left as unreferenced one-offs.

### Demo-1000 cold load

Fresh Chromium process and context for each run; file://, offline, 1440px, frozen 2026-11-11. Measure navigation start until DOMContentLoaded and all 1,000 rows evaluated. Three runs per method; 980 eligible products receive recommended picks, with the 20 no-history products not given invented picks. No task-owned capture batch running; host-wide load not controlled.

- Current/default median: **780.76 ms**.
- Recommended median: **1614.19 ms**.
- Raw six runs and DOM navigation timings are in the verification JSON. Timing is a local measurement, not an SLA or cross-machine benchmark.

Reproduce with the already-installed browser dependencies (no install/network):

```sh
mkdir -p .scratch
export TMPDIR="$PWD/.scratch" PYTHON=/usr/bin/python3
export PLAYWRIGHT_MODULE=/path/to/playwright/index.js
export CHROMIUM_EXECUTABLE=/path/to/chromium
node standalone/capture-shelf-v12.cjs
node scripts/benchmark_cold_v12.cjs
```

**Not checked:** installed Hermes Desktop, actual Safari/WebKit or physical devices, live inventory/ERP, real demand outcomes, independent held-out industry-superiority/stress-frontier gates, or lane O/profit-optimal (outside this E/P/M/C integration). No push, publish, install or network operation was performed.


## Lane O integration / review-driven rollback

Merged `e9cae36` into `195b038`. Added real CSV sale-price-to-suggestion proof. Default-off golden_diff and all eight import-example digests remain unchanged before pin refresh. The broad current-plan service floors and sparse reserve from developmental rounds r2/r3 were rejected after paired stress showed harm; they are not final policy. Pure `suggest` maths is restored byte-for-byte to Lane O. Irregular histories (existing classifier ADI >= 1.32 or positive-demand CV² >= .49) omit the suggestion and explain that the standard amount is retained. This abstention is not an optimized quantity. Short-life review cadence is text only; weekly review remains an existing optional input to the original optimizer, not a changed standard-order ceiling. The current planner retains E's shelf cap; O uses its original simulated usable-window objective without the incompatible future-order E cap.

Performance: shared exact-input candidate fits within one recommendation reduce fits 82 → 47 without result changes. Internal forecast-only planner calls skip optional profit simulations whose results were discarded; the externally requested guidance still evaluates the same optimizer. These are operation-count bounds, not a real-time scheduler/SLA guarantee.

Only the new reviewed engine snapshot supplements the 37 existing fixtures; no historical fixture or golden is rewritten. Every refreshed pin below is justified by O's opt-in integration, abstention/explanation and default-result-preserving performance/cadence changes:

- **docs/forecast-methods-baseline.json** `export const DEFAULT_ORDER_SETTINGS`: `edddf991d8be552e23090b523546c7b66c6b78883ff2ff7cce19e141d9c4c9d6` → `55c971778f35a3728bf01806ff77c765b0f119853d7def2fb3e996a9316211a7`.
- **docs/forecast-methods-baseline.json** `      // Owner 'align this'`: `72f26a99a777fe0929da7cbd82ceaa7153bef89689224be918f3e611a432dab6` → `1d45562a261f97f240a9c56f2e91a88f00090b8ccbf1b051415d6a18260d84f1`.
- **docs/import-logic-baseline.json** `pureBlock`: `f04419364731813176464162283fe8b31a811a3e0d53335d130168b7a37bd1ce` → `63cb5bfb98eb57ee1aa4216fd41c0c901fc4f50ea86ae1c30d554e2c42722c40`.
- **docs/import-logic-baseline.json** `engine.py`: `8c4beabbd69fc314aeac22c00d37d7f94fde79145b50211953b1bcdf0b68eb47` → `3c8cfe29c5bff6743be921694bffcb0d4f91cd3172a0f7695eec42ae32d523be`.
- **docs/import-logic-baseline.json** `engine pin`: `cee2550` → `e92becb`.
- **tests/fixtures/baselines/manifest.json** `e92becb:engine.py`: `None` → `3c8cfe29c5bff6743be921694bffcb0d4f91cd3172a0f7695eec42ae32d523be`.
- **tests/r2-protected-maths.test.mjs** `protected plugin core`: `dd1900da7f0de2f209166e8f086d4341b01e0ef46f520adc7acf5d80e9ca40f2` → `2336e2b7a89db3df7b80faf6a305e624b7b242aee7766e671d681d91a5465c5f`.
- **tests/r2-protected-maths.test.mjs** `engine`: `8c4beabbd69fc314aeac22c00d37d7f94fde79145b50211953b1bcdf0b68eb47` → `3c8cfe29c5bff6743be921694bffcb0d4f91cd3172a0f7695eec42ae32d523be`.
- **docs/capture-polish.cjs** `display helper span`: `8b9b3583a2afe3c1c6102b0fef3eb66facaa2adebdbf35ec514056a511f507ae` → `6d102b17933e2cf6c41648acee967c0154e2435f4706e9b003a7a8891241c322`.
- **tests/test_baselines.py** `exact source fixture count`: `37` → `38`.


### Final Lane O stock-basis seam

The original Lane O simulator uses physical stock and does not optimize old-lot FEFO. E excludes expiry-risk stock from the **standard** plan. Passing that reduced balance to O changed 14/90-day freshest outcomes even after floors were removed. A failing-first regression proved this seam; O now receives its original physical-stock balance, while standard E advice remains unchanged. Reviewed source checkpoint `7ef3619` supplements, never overwrites, `e92becb`. CLI boundary mocks accept the new internal skip-optional-economics keyword without relaxing assertions. Subsequent pin changes are justified solely by this original-result-restoring seam:

- **docs/import-logic-baseline.json** `pureBlock`: `63cb5bfb98eb57ee1aa4216fd41c0c901fc4f50ea86ae1c30d554e2c42722c40` → `88e97baa403b8775339a80083dadc9db991ff4a6b5403cd42e41bab14f982fe4`.
- **docs/import-logic-baseline.json** `engine hash`: `3c8cfe29c5bff6743be921694bffcb0d4f91cd3172a0f7695eec42ae32d523be` → `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d`.
- **docs/import-logic-baseline.json** `engine pin`: `e92becb` → `7ef3619`.
- **tests/fixtures/baselines/manifest.json** `7ef3619:engine.py`: `None` → `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d`.
- **tests/r2-protected-maths.test.mjs** `protected core`: `2336e2b7a89db3df7b80faf6a305e624b7b242aee7766e671d681d91a5465c5f` → `0d80862e43d6e32be9f36d8a021e749f12a4f7d2babe012bca3c93dccacc1ea2`.
- **tests/r2-protected-maths.test.mjs** `engine`: `3c8cfe29c5bff6743be921694bffcb0d4f91cd3172a0f7695eec42ae32d523be` → `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d`.
- **tests/test_baselines.py** `exact source fixture count`: `38` → `39`.

## Round 3A — CLI contracts, display risk and stable persisted choices

Commits from `c3b5d93` through `63d4153` address the Opus MED findings without changing preset recipes or standard order maths.

- **R3A-SNAPSHOT / state drift:** the browser abstention reproducer edited sales in place. The ready snapshot was keyed by source identity, so the off state retained the stale 165 while enabling profit invalidated settings and recalculated the standard amount as 65. The source contents now participate in the snapshot key; both toggle states calculate the same fresh ordinary amount. No profit setting leaked into planner maths. The real browser guard checks the abstention reason, unchanged standard amount, persistence and 1440/390 layouts.
- **R3A-RISK / physical-vs-usable boundary:** display-only shortfall simulation now subtracts `expiry_excluded_qty` in Python, Desktop and standalone. Physical money tied up remains physical stock value. The corrected synthetic 200-unit expired-lot case matches zero usable stock for lost profit (96.576 in the focused fixture). This is distinct from the original Lane O physical-stock optimization basis above, which is deliberately unchanged.
- **R3A-CLI / unsafe presentation default:** `--costs` or settings `show_costs: true` is now required for monetary CLI fields/columns and Cost totals. New archive-based tests compare stdout, stderr and output files to `git archive v1.1-freeze`, including a unit-cost-only CSV and all eight ERP examples. Existing monetary tests now explicitly opt in; default examples and goldens were not rewritten.
- **R3A-EXPIRY-UI / missing decision warning:** standalone rows, full product report and side panel show expiry interpretation and lot-total warnings using text-only DOM nodes, including Simple mode. Browser checks include a literal hostile `<img ...>` warning with no image element or execution.
- **R3A-METHOD / missing caller context:** CLI Recommended exports method metadata/reason in JSON and CSV explanations. `--previous-methods` accepts an explicit validated SKU-to-candidate mapping. Desktop stores per-SKU choices by adjustment mode and retains both the current pick and its prior snapshot seed. Only an earlier snapshot seeds a fit. Opus caught the first implementation overwriting that seed and changing the same-month rerender from SES/95 to Current/91; the failing-first regression plus outside-family check prove SES/95 remains SES/95 after saving. Stateless/blocked-storage and reused-SKU limitations are documented.
- **R3A-DOC:** shelf-life docs now say increasing minimum remaining life can raise an order when known lots are conservatively excluded.

### Rebuild and byte-pin decision

All ten offline HTML outputs were rebuilt from current sources; six actually changed, four remained byte-identical. Protected planner/forecast source bytes **did not change** in this round: exact `pureBlock` stays `88e97baa403b8775339a80083dadc9db991ff4a6b5403cd42e41bab14f982fe4`; engine stays `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d`, checkpoint `7ef3619`. All source-pin/mutation guards pass unchanged. Therefore no historical math pin was gratuitously refreshed or weakened: these fixes are in caller/presentation adapters outside those spans. Default-off byte identity is strengthened by direct archive comparisons rather than a new permissive pin.

### Verification receipt

- `node --test tests/*.mjs`: **3628/3628 pass**, exit 0.
- `/usr/bin/python3 -m pytest -q`: **2189 pass**, exit 0.
- `/usr/bin/python3 -m unittest discover -s tests`: **332 pass**, exit 0.
- `golden_diff`, `verify_import_examples` (8/8), `check_docs`: exit 0; all eight ERP CSV CLI invocations exit 0.
- Independent r3 kit: **562 cases** (62 directed + 500 fuzz), 444 original CSV CLI runs, **PASS**, no assertion failures. Original kit and harness remain unchanged.
- Browser captures: **39/39 scripts exit 0** (32 standalone, six Desktop SDK-shim captures, one Recommended-method capture). All six Desktop captures were rerun after the final persistence fix with the freshly esbuild-bundled harness. Logs and exact per-script durations are in `.scratch/r3a-captures/summary.json` and `docs-latest-summary.json`. This proves offline browser/shim behavior, not an installed Desktop.
- Profit browser proof: 1440/390, expiry warnings escaped, expired-stock shortfall uses zero usable stock, ordinary amount unchanged on toggle, abstention visible, no runtime/network errors.
- Profit latency (1000 synthetic items, 96 paths, five paired Python runs): **142.13 ms median added**, 778 eligible suggestions in every run. A local CPU measurement, not a cross-device guarantee.
- Fresh independent profit stress: **2880 runs**, exact matching scenario universes; per-family paired deltas and CIs in [final profit table](v12-profit-final.md). Eleven eligible families reproduce O96 exactly. Withheld parts reproduce ordinary v1.1 amounts; short-life service/profit trade-offs remain visible rather than being described as universal improvement.

Raw evidence is under `.scratch/r3a-*`; numerical results above are local/synthetic proof. Not checked: installed Hermes Desktop, live ERP data, production behavior, actual commercial outcomes, or a new preset/Recommended combination stress arm. No network, push, install or preset change was performed.


## Redesigned presets integration (reviewed merge 50e8117)

Merged v12-r3-presets 645ccc5 into the isolated descendant of v12-int 5a63cce with no conflicts. Round 3A fixes are retained. All ten HTML files rebuilt from sources. Recipes preserve actual ordering cadence, never reduce cover, leave shelf assumptions untouched and provide before/after affected-product counts. Explicit per-product null/0/none disables inherited shelf caps for standard and profit suggestions.

### Exact pin justification

Default-off golden_diff and all eight import examples passed before this refresh. Historical fixtures and golden files are not rewritten. Only the following source/settings snapshots changed:
- **docs/forecast-methods-baseline.json** export const DEFAULT_ORDER_SETTINGS: `55c971778f35a3728bf01806ff77c765b0f119853d7def2fb3e996a9316211a7` → `ba80fe5b6be8b42af8bb3354ad54a29e2fdd797992f9ca6601658ac12fa41cab`. Reviewed preset settings/explicit opt-out and current preview presentation; no forecast algorithm changed.
- **docs/import-logic-baseline.json** pureBlock: `88e97baa403b8775339a80083dadc9db991ff4a6b5403cd42e41bab14f982fe4` → `508bf879913bc97b1a7a16d301fadec85d4e7a9b8c4f1538534de3d9b985dbce`. One-time recipes, settings opt-out resolver and profit-adapter resolved shelf values.
- **docs/import-logic-baseline.json** engine.py: `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d` → `d358c594784de9d6cedee0750498c115d888a72465151b1edbfcf61094b0c236`. Explicit product shelf opt-out only; full reviewed source checkpoint added without rewriting historical fixtures.
- **docs/import-logic-baseline.json** pin engine.py: `7ef3619` → `50e8117`. Reviewed merge checkpoint.
- **tests/fixtures/baselines/manifest.json** 50e8117:engine.py: `None` → `d358c594784de9d6cedee0750498c115d888a72465151b1edbfcf61094b0c236`. Additive reviewed fixture; all 39 previous entries unchanged.
- **docs/import-logic-baseline.json** csv_import.py: `8c57d697303192f090c2a5f59ff425150cbcfeba7f589ff7286a09b879ea010e` → `69ad3bdd80a5663f1d7003339c62efdef4eecb27bca8695a4777cb55a8d44c93`. Explicit product shelf opt-out only; full reviewed source checkpoint added without rewriting historical fixtures.
- **docs/import-logic-baseline.json** pin csv_import.py: `cee2550` → `50e8117`. Reviewed merge checkpoint.
- **tests/fixtures/baselines/manifest.json** 50e8117:csv_import.py: `None` → `69ad3bdd80a5663f1d7003339c62efdef4eecb27bca8695a4777cb55a8d44c93`. Additive reviewed fixture; all 39 previous entries unchanged.

The two protected mathematical digests in tests/r2-protected-maths.test.mjs remain exactly 0d80862e43d6e32be9f36d8a021e749f12a4f7d2babe012bca3c93dccacc1ea2 (plugin) and a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d (engine). An exact immutable reviewed delta (tests/fixtures/preset-approved-delta.json, SHA-256 d5d9202a01cc881fbd69b4afc511ae87578f4e685ee4272b8a01b9f3c2df1efe) reconstructs the previous settings/adapters only: six JS regions, four Python regions. Any changed approved snippet fails closed; unknown bytes remain in the protected digest. This avoids refreshing mathematical pins or adding broad unprotected spans. The full current engine/import source is independently pinned to reviewed merge 50e8117; manifest count rises 39 → 41 for two additive fixtures. Display-helper, attribution-helper and forecast-method algorithm pins are unchanged. The polish capture now requires the same new source checkpoint.


### Owner gate decision: setup guides, not quantity optimizers

The independent redesigned-gate-both synthetic comparison rejected Pharmacy automatic 0.99 service (monthly profit negative; weekly inconclusive). Owner selected redesigned-gate-no99: qualified synthetic no-op versus General at 7/30-day cadence, not superiority. Commit 5c05271 removes only the Pharmacy service proposal, updates setup-guide copy and adds failing-first JS/Python no-op regressions. Existing CLI advisory presets have no service target and remain unchanged.

Rebuilt all ten HTML files again. Refresh only these consequent UI/settings pins; the original protected mathematical digests stay unchanged. The frozen exact delta is revised solely for the withdrawn Pharmacy setting.
- docs/forecast-methods-baseline.json export const DEFAULT_ORDER_SETTINGS: ba80fe5b6be8b42af8bb3354ad54a29e2fdd797992f9ca6601658ac12fa41cab → 3afb665374a102ad63bf20f978d779b8ed6980f03d701f53ac5c89b56fcf1e0c. Pharmacy service withdrawal only.
- docs/import-logic-baseline.json pureBlock: 508bf879913bc97b1a7a16d301fadec85d4e7a9b8c4f1538534de3d9b985dbce → fcbfef80da364610a96177d9aaee1c8697b0a079ef13e858b647425de5d59471. Pharmacy service withdrawal only.
- Frozen delta SHA-256: d5d9202a01cc881fbd69b4afc511ae87578f4e685ee4272b8a01b9f3c2df1efe → a1286b842b5d2ea318c257af0c5c4d5276d2b7c33c3b84315ebcc584113b0dfa.


### Final redesigned-guide verification

Final product/source revision: `c187f8e` (follow-up behaviour at `5c05271`); this closeout adds evidence/docs only. Machine-readable [verification receipt](v12-presets-verification.json) includes command exits, per-script capture inventory, all ten generated HTML hashes, benchmark samples, source hashes and read-back independent gate summaries.

- Full Node: **3639/3639 pass**, zero skipped/failures; full pytest: **2195 pass**; unittest discovery: **338 pass**. Every command exits 0.
- `golden_diff`, `verify_import_examples` (8/8), `check_docs`, smart-import/cost/profit synchronization checks: exit 0. Existing golden files remain byte-identical. Separate final default-off/archive regressions: **479 pass**, including exact v1.1 CLI stdout/stderr and output-file comparisons. All **8/8 ERP CLI** invocations exit 0.
- Unmodified independent r3 kit: **562 cases**, 62 directed + 500 fuzz; 444 CSV + 118 XLSX; **444 original CSV CLI runs**, **9063 assertions**, zero failures, exit 0.
- Every maintained capture script: **38/38 exit 0** = 31 standalone + six Desktop SDK-shim + one Recommended capture (inventory counted from the actual files, not the older prose total). Harness freshly esbuild-bundled with production React and existing local dependencies. Separate preset Playwright: **14 checks**, six guides plus product opt-out at 390px in both themes; exact Apply/Undo and affected counts, no overflow/runtime/network errors. Separate profit browser: 1440/390, off/on/off unchanged standard amounts, persisted toggle, irregular-demand abstention and escaped expiry warnings, usable-stock risk; PASS. Both 390px preview screenshots inspected; preview content readable and impact visible. Top/bottom screenshot cutoffs reflect the intentionally scrolled settings viewport, not horizontal overflow.
- Profit latency: **157.69 ms median added**, five alternating paired runs, 1,000 items, 96 paths, 778 eligible suggestions each; **<300 ms gate**, exit 0. Final measurement after the task-owned capture batch completed; host load uncontrolled, not an SLA.
- All **10/10 HTML outputs** equal fresh in-memory builds. Protected mathematical digests retained, full current engine/import source pinned, all 39 historical fixtures untouched. Independent final review found no medium/high issues in the Pharmacy removal/setup-guide follow-up; exact-delta audit confirmed reconstruction and 41/41 fixture hashes. These byte guards freeze approved settings/adapter changes; they are not proof that opt-in shelf-setting semantics never change quantities.
- Range hygiene: `git diff --check 5a63cce..HEAD` returns 2 only for inherited trailing whitespace at `tests/fixtures/baselines/50e8117/csv_import.py:402`. This is an exact reviewed source fixture and is deliberately not normalized. Working-tree diff-check is clean.

**Not checked:** installed Hermes Desktop, actual Safari/WebKit or physical devices, live ERP/inventory, or actual commercial outcomes. Independent preset gates were read back, not re-executed in this integration; they qualify setup-guide noninferiority/no-op only, not superiority. No stress harness branch, push, install, network or live data was used.
