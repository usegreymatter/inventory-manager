# Lane C — local cost/profit verification

Scope: display-only valuation on the public v1.1.0 base (`v12-base`). No network,
installs, live stock data or order placements. No generated HTML is committed.

## Implemented

Optional sale-price imports; pure Python/JS metrics; monetary incoming from the
existing additive dated-supply ledger; weighted/coverage-aware totals; CLI JSON
and explanation columns; production offline Custom columns, totals and product
panels; Desktop inline single-blob-compatible cost display; optional existing
risk-path shortfall collector; expiry quantity valuation hook. Formula and
assumption documentation is in `docs/COSTS.md`.

Observed failing-first tests covered absent modules/metrics, optional collector,
CLI/UI wiring, explicit-null parity, existing supply valuation and plain-decimal
explanations. Review found and reproduced an IIFE concatenation bug and forbidden
Desktop relative imports; both were fixed with regression probes. Detailed and
Simple column defaults remain unchanged; monetary cells preserve cents.

## Final executed results

Environment for every run: `TMPDIR=$PWD/.scratch`, `PYTHON=/usr/bin/python3`.

- `node --test tests/*.mjs`: **3,594 passed / 1 failed** (3,595 tests).
  The sole failure is the immutable full-import snapshot guard below.
- `/usr/bin/python3 -m pytest -q`: **2,098 passed / 2 failed**.
  Both failures are the frozen QuickBooks example below.
- `/usr/bin/python3 -m unittest discover -s tests`: **243 run / 1 failure**,
  the same frozen QuickBooks example.
- `scripts/golden_diff.py`: exit **0**, all SKUs/all fields **unchanged**.
- `scripts/verify_import_examples.py`: exit **1**, `quickbooks.csv` only.
- `scripts/check_docs.py`: exit **0**, **129 relative links / 63 JSON files**,
  no problems (before this evidence-only file).
- `scripts/sync_smart_import.py --check` and
  `scripts/sync_cost_view.py --check`: exit **0**.
- All eight standalone templates, default and demo-1000 rebuilt successfully.
  Rebuilds were used for verification only and then restored from HEAD.
- `standalone/capture-costs.cjs`: exit **0**, **37 / 37 checks passed** at
  **1280 and 390 CSS px**, zero page errors, zero console errors, zero network
  calls. Builds HEAD into scratch before opening; covers partial totals,
  fractional stock/margin, incoming receipts, cost-only/unknown data, expiry
  hook, sampled loss, Custom choices, unchanged Detailed defaults, malicious
  product-name text and unchanged quantities after view operations. Screenshots
  were visually checked: readable totals/detail, no overlap or clipping.
- Pure metric parity: **1,200 seeded random items** and aggregate totals.
  Optional shortfall collector: **30 exact Py/JS risk scenarios** with unchanged
  original probabilities. Desktop/CLI adapters: **25 synthetic products**,
  including fractional stock, settings costs and dated receipts.
- `engine.py`, `scripts/golden_diff.py` and
  `tests/r2-protected-maths.test.mjs`: **zero diff from v12-base**. The unchanged
  protected-maths tests pass in the full Node run.

## Explicit unresolved contract conflicts — not a green release

1. `docs/erp-examples/quickbooks.csv` already contains `Price = 9.99`. Supporting
   the explicitly requested `price` alias necessarily now imports
   `sale_price: 9.99`, and records that matched field instead of ignoring it.
   This conflicts with the separate instruction that every existing import
   example remains byte-identical. No source example, frozen assertion or
   verifier was changed to hide the difference. Failing tests:
   `test_valid_examples_unchanged_items` and
   `test_eight_existing_preflight_examples_are_byte_identical_to_core_commit`.
2. The older capture-polish guard pins the **entire importer bytes**, including
   import aliases and `sources.py`/`csv_import.py`. New import-only metadata
   necessarily changes those bytes. It therefore rejects the new import span
   even though the stricter forecast/order-only guard and numeric goldens pass.
   The guard/manifest/pins remain untouched. An owner-approved narrow importer
   rebaseline or changed import requirement is required at integration.

Not checked: real Hermes Desktop host runtime; real Safari/iPhone hardware;
merged expiry/preset/auto-method lanes or their cross-feature interactions;
production currencies or real business outcomes. The expiry hook was exercised
with synthetic supplied at-risk quantities, not Lane E's merged implementation.
