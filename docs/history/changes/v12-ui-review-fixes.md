Lifecycle: living

# v1.2 review fixes: partial closeout at protected-source gate

## Accepted local fixes

- **M2 / input-boundary mismatch:** Desktop preset preview and main evaluation now share the same stable, learning-prepared, remembered-method dataset. `tests/preview-storage-safety.test.mjs` exercises an actual prior Recommended seed and learning context, checks reference identity and matching before/after preview totals, and proves raw-data preview would differ. Final review caught an Undo identity regression: Undo now checks the stable raw-data identity separately from the prepared preview input. A Page-plus-controls regression reproduces the original failure and proves apply → enabled Undo → exact restore, while replacement raw data still disables Undo.
- **LOW / persistence validation:** remembered methods reject corrupt structures, invalid methods/months, unknown fields/modes and reserved `__proto__` / `constructor` SKU keys. Valid modes and earlier seeds survive. Regression tests cover both reading and writing.
- **QA-P1-001 / missing layout invariant:** the standalone worklist shell scrolls and reserves 208 content pixels for the product scrollport, even when clearance and cost summaries exceed phone height.
- **QA-P2-002 / observer feedback:** worklist resize delivery coalesces writes in an animation frame, skips unchanged dimensions and avoids rebuilding controls for height-only changes. No browser errors are filtered. See [layout investigation](../../../standalone/design/WORKLIST-LAYOUT-QA.md).
- Documentation reconciles industry setup-guide wording and Pharmacy's withdrawn automatic 99% target, links PRESETS, lists current override fields and archives original synthetic gate JSON evidence. No audit report with an arithmetic typo was found in this base.

## Blocked: do not count as fixed

**H1 profit shelf cap** and **M1 preset floor** require changing protected source bytes. The packet explicitly says to stop rather than edit pinned blocks or refresh their pins.

- `docs/import-logic-baseline.json` pins the whole Desktop pure block from `const SAMPLE =` through `const pageStyle =` (SHA-256 `fcbfef80da364610a96177d9aaee1c8697b0a079ef13e858b647425de5d59471`). The profit module, its adapter, and preset floor are inside it.
- `docs/forecast-methods-baseline.json` also pins `export const DEFAULT_ORDER_SETTINGS` through `const dateOrdinal =` (SHA-256 `3afb665374a102ad63bf20f978d779b8ed6980f03d701f53ac5c89b56fcf1e0c`), including the preset floor.
- A delegated preset attempt touched that protected region and was explicitly reverted. Only its unpinned preview/storage hunks were retained. Final hashes equal the original pins; neither protected manifest changed.
- No profit code was changed; the requested synthetic before/after cap suggestion comparison is therefore pending. A future authorized packet must decide how to change those protected source blocks while retaining a truthful immutable v1.1 maths reference. Do not run `golden_diff --write` to bypass this gate.

The earlier preset attempt is retained in git history for inspection, not accepted as a fix. No per-product cover change has landed. No claim is made that H1/M1 are resolved.

## Verification of retained changes

All commands ran locally with synthetic inputs; no installs, remote operations or live inventory access.

| Check | Result |
| --- | --- |
| Focused Desktop/preview/storage/layout Node tests | 261 passed |
| Build all eight template variants, default HTML and demo-1000 via `standalone/build.py` | 10 outputs rebuilt |
| `python3 -m pytest -q tests/test_standalone_build.py` | 47 passed, byte-identical authored/generated outputs |
| `node --test` | 3643 passed, zero failures |
| `python3 -m pytest -q` | 2195 passed |
| `python3 -m unittest discover -s tests` | 338 passed |
| `python3 scripts/golden_diff.py` | all SKUs/all fields unchanged |
| `python3 scripts/verify_import_examples.py` | exit 0 |
| `python3 scripts/check_docs.py` before this receipt | 156 links, 71 JSON files, zero problems |
| `<local-scratch>/sr-r3-prep/run_r3.sh "$PWD"` | exit 0 |
| `node standalone/capture-layout-regression.cjs` | 24 scenarios, 230 checks, zero failures |

Browser rerun used existing Playwright, Chromium `<local-qa-chrome>` and available WebKit; 390×900 and 1440×900, light/dark, all/cost/profit fixtures. Raw gate logs: `.scratch/ui-fix/gates.json` and `gate-*.log`; final browser report/screenshots: `.scratch/layout-regression/ui-fix-accepted/`. Browser input was built from final authored sources. Reproduction environment is documented in the layout investigation.

Not checked: hosted deployment, Desktop host runtime, native Safari/iOS, customer inventory, or performance of large live catalogs. H1/M1 remain blocked, so this is not complete v1.2 review acceptance.
