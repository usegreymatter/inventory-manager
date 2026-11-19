# Robust local CSV/ERP import — verification receipt

Lifecycle: review. Local-only candidate; no installation, remote action, live ERP or customer data.

## Delivered

- Bounded Python/JavaScript preflight reports, header aliases, delimiter/encoding and number normalization, row-level set-aside reasons, and source-line numbers.
- Distinct warehouse rows aggregate stock, on-order, sales and receipts. A repeated SKU at the same trimmed, casefolded location (including blank locations) is set aside; failed rows never reserve a location or mutate accepted totals. Partial totals explicitly warn that they include usable rows only.
- Unicode NBSP, figure space and narrow NBSP in headers/cells/grouped numbers are covered by cross-runtime tests. Boundary trimming also aligns BOM, NEL and information-separator characters so visually identical identifiers do not become separate products.
- Arctic import confirmation preserves current products until acceptance, supports Cancel/Escape, reports ignored/defaulted fields and warnings, and downloads set-aside source rows without persisting them.
- `--strict` keeps whole-file rejection. The legacy Desktop plugin upload and recovery paths explicitly stay strict until they have a preflight UI; the shipped Arctic page is the tolerant interactive surface. The Hermes tool now returns the report and an import-count disclosure. Already-validated bundle output bytes stay unchanged.
- Both former mixed-row Node test failures now assert strict rejection and tolerant acceptance of only the valid rows, including field-specific rejection reasons.

## Original import acceptance results

Original acceptance details and source hashes: [`import-preflight-verification.json`](import-preflight-verification.json). These capture counts describe the earlier import acceptance run, not the I1–I5 review rerun below.

| Check | Result |
| --- | --- |
| `/usr/bin/python3 -m pytest -q` | 1,695 passed |
| All 25 `tests/*.test.mjs`, five sorted batches using `node --test --test-concurrency=1` | 2,476 passed; zero failures/skips |
| `capture-import.cjs` | 102 passed; 10 desktop/phone screenshots |
| `capture-chart.cjs` | 985 passed |
| `capture-table.cjs` / `capture-browse.cjs` / `capture-settings.cjs` | 141 / 31 / 35 passed |
| `capture-arctic.cjs` / `capture-gm.cjs` | 461 / 299 passed |
| `capture.cjs --offline-only` / `capture-a2.cjs` / `capture-a3.cjs` | 104 / 268 / 161 passed |
| All ten capture harnesses, run one at a time | 2,587 checks passed |
| `scripts/verify_import_examples.py --baseline af2b1c7` | All 8 ERP example files: identical item dictionaries, months and dates |
| `scripts/golden_diff.py` | All SKU fields unchanged across Python, JS and CLI |
| Engine/golden scope | Import work did not change `engine.py`; order policy v2 changed it separately. `scripts/golden_diff.py` was not changed by import work. |
| Rebuilt standalone + `cmp standalone/stock-runway.html standalone/design/option-gm-b.html` | Identical |
| `git diff --check` | Clean |

Browser environment: `PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js`, `CHROMIUM_EXECUTABLE=/path/to/chrome`, `TMPDIR=$PWD/.scratch`.

At 390×844, the fully expanded report scrolled 422px to its exact end (706px client height, 1,128px content height). Import and Cancel were at y=788–832, within the viewport, and actual hit testing reached both buttons without Playwright auto-scrolling them. The synthetic 2,000-row import yielded 1,982 accepted products and 18 precise negative-stock set-asides.

All ten final import screenshots were visually checked at desktop/phone sizes. No import clipping, overlap or inaccessible actions remained. The preflight's singular product wording was corrected after the visual pass. Screenshots are preserved in [`../evidence/import-preflight/`](../evidence/import-preflight/).

A concurrent Node rerun timed out once without an assertion failure; serial suite execution completed all 25 suites. No unrelated system processes were terminated. The original review also caught silent report loss in the tool/legacy Desktop paths and stale import fingerprint hashes; both are now fixed and regression-tested.

## I1–I5 review fixes

- **I1:** One number convention is chosen per file from recognized numeric columns only. Comma/tab files use `decimal-dot`; semicolon files use `decimal-comma` when a numeric cell supplies comma-decimal evidence, otherwise `decimal-dot`. The report names the convention. In comma mode, `1.200` becomes 1200 and `1.200,50` becomes 1200.5. A lone dotted thousands-shaped amount without comma evidence is set aside, not guessed. Currency-marked three-digit comma values (e.g. `$1,200`) in comma mode, leading-zero thousands groups, and style conflicts are set aside as `ambiguous number format`. A mixed file cannot silently reinterpret ambiguous `1,500` as 1.5. Lead times with day/week/month suffixes use the same convention.
- **I2:** Only boundary currency symbols from the existing set are removed. Embedded symbols such as `1$20` remain invalid numbers; currency-code support was not expanded.
- **I3:** Warehouse identity uses trim plus Unicode casefold-equivalent comparison; combined warnings list the accepted location labels. Duplicate/failed rows still cannot mutate totals or reserve a location.
- **I4:** An aliased incoming/on-order column dropped because no numeric values parse now names the source column and warns that no incoming stock was counted.
- **I5:** Python and JS share explicit boundary/lead whitespace, including ASCII space/tab, NBSP, figure space, narrow NBSP and BOM; existing boundary handling for NEL/information separators is retained. Grouped numeric cells explicitly accept the six listed grouping characters. Neither numeric preflight path relies on runtime `\s` semantics.

Review regressions live in `tests/test_import_review.py`, each exercising Python and JS with exact output/report parity. Follow-up review exposed leading-zero grouping and mixed-file comma-thousands ambiguity; both were reproduced RED and fixed GREEN.

| Review rerun command | Result |
| --- | --- |
| `/usr/bin/python3 -m pytest -q` | 1,758 passed |
| `node --test --test-concurrency=1 tests/*.test.mjs` | 2,509 passed; zero failures/skips |
| `/usr/bin/python3 standalone/build.py` plus all eight design templates | All rebuilt from the exact Desktop core |
| `node standalone/capture-import.cjs` | 102 passed; 10 desktop/phone screenshots; zero network/browser errors |
| `/usr/bin/python3 scripts/verify_import_examples.py --baseline af2b1c7` | All 8 item dictionaries, months and dates identical; historical parser and historical engine loaded together in an isolated package |
| `/usr/bin/python3 scripts/golden_diff.py` | All SKU fields unchanged across Python, JS and CLI; no golden files modified |
| `node docs/capture-polish.cjs --label after --guard-only` | Passed after refreshing only JS pure-block and CSV-import hashes with the guard's SHA-256 boundaries/method |
| `cmp standalone/stock-runway.html standalone/design/option-gm-b.html` | Identical |

Initial verification caught stale generated HTML and the old example verifier's engine-byte assumption after policy v2. All templates were rebuilt; the baseline verifier now executes historical engine/parser code together rather than substituting current policy math. No change to `engine.py` or the JS guidance/order section was made by this review packet. Other historical capture suites above were not rerun for I1–I5.

## Not checked

- Loopback/static HTTP smoke was deliberately skipped by `--offline-only` because this packet prohibits network. No hosted/deployment claim is made.
- Live ERP/customer data, actual phone hardware/touch, and non-Chromium browsers were not exercised.
- Non-shipping design prototypes do not provide the Arctic confirmation sheet. Existing dashboard singular/plural wording (`1 data warnings`) is outside the import packet.
