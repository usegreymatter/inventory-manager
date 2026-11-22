Lifecycle: review

# v1.2 import-safety reviewed delta

Owner authorization: Yousef approved option A (import-only protected-region changes and re-pinning) on 2026-11-20. Source parent is `1a7d3df`. This is local synthetic evidence, not a deployment.

## Boundary and rationale

- **IMPORT-01:** `lot_fields`/`lotFields` distinguish a present-but-blank lot quantity from a missing quantity column. Unknown lots are not fabricated from product stock. Repeated explicit-quantity rows keep one on-hand snapshot per SKU/location even when quantity is blank. Known lots remain; missing quantities and mismatched totals require acknowledgement. Files without a lot-quantity column keep legacy implicit stock summation.
- **IMPORT-02:** contributor review detects ambiguous numeric transaction-date columns, mixed separators and contradictory order evidence. Existing month assignments are retained, never silently reinterpreted. A consistent column with a day above 12 establishes order; ISO and month-only dates keep the prior no-ack behavior.
- **IMPORT-03:** numeric cells beneath an expiry alias use the workbook epoch even without a date style. The 1904 unstyled reproducer now agrees with its styled control (2029-12-10). CSV numeric serials still use the prior 1900 convention. Unstyled out-of-range serials remain raw for row-level validation; they do not make an unrelated notes sheet abort a valid workbook. This review-discovered boundary had its own failing-first reader parity test.
- **IMPORT-04:** canonical and input-meaning CSV serialization use CRLF quoting triggers; readers use `newline=''`. Embedded CR stays inside the quoted cell rather than becoming another row. Only serialization changes, not cell content.
- **IMPORT-06:** sale-price evidence is excluded from the legacy inventory-number convention. Price retains its previous inference; stock, sales, leads, lots and other fields use exactly the evidence available without sale_price. Ambiguous inventory stays invalid rather than becoming 1000-fold larger merely because a price was added.
- **IMPORT-07:** bad lot cells are caught at the row boundary, recorded as `rows_set_aside` with row/reason/original values, excluded before aggregation, and remaining usable rows continue. No forecast/order function changes.
- Direct CSV input-meaning attachment also gates the already-produced lot-total/unknown-lot warnings, not just workbook review.

## Changed pinned hunk inventory

The following are every changed hunk in pinned source files and the plugin pure block relative to `1a7d3df`. Line coordinates identify the exact reviewed diff; generated workbook/input-meaning hunks mirror authored modules. Each is covered by the rationale above and failing-first tests. Full reviewed `sources.py` and `csv_import.py` are added as immutable source-checkpoint fixtures; no existing fixture is overwritten.

### sources.py

- `@@ -228,8 +228,10 @@`

Before SHA-256: `3b006371d3ab2ddaaba707eb9d823374d5c20415aefd8cffeba67d7e04092874`. After: `eaafe613441d8496ee2c9a5459d20b2208e58a008af1d3d8f4edee45d4be696e`.

### csv_import.py

- `@@ -93,7 +93,7 @@`
- `@@ -102,6 +102,11 @@`
- `@@ -288,11 +293,19 @@`
- `@@ -330,7 +343,8 @@`
- `@@ -353,19 +367,19 @@`
- `@@ -380,7 +394,7 @@`
- `@@ -395,7 +409,7 @@`

Before SHA-256: `69ad3bdd80a5663f1d7003339c62efdef4eecb27bca8695a4777cb55a8d44c93`. After: `1cc216fc77a4295b40618804ac865bbce0870be8e69d7b601cad57992957f76b`.

### desktop/plugin.js (pure block relative coordinates)

- `@@ -1754,10 +1754,13 @@`
- `@@ -1957,7 +1960,7 @@`
- `@@ -2023,6 +2026,16 @@`
- `@@ -2031,11 +2044,15 @@`
- `@@ -2118,7 +2135,7 @@`
- `@@ -2143,7 +2160,8 @@`
- `@@ -2169,13 +2187,13 @@`
- `@@ -2220,21 +2238,23 @@`
- `@@ -2290,6 +2310,7 @@`
- `@@ -2445,6 +2466,15 @@`
- `@@ -2536,10 +2566,13 @@`
- `@@ -2577,8 +2610,12 @@`
- `@@ -2604,7 +2641,7 @@`
- `@@ -2613,7 +2650,7 @@`
- `@@ -2622,12 +2659,12 @@`
- `@@ -2637,14 +2674,14 @@`

Before SHA-256: `fcbfef80da364610a96177d9aaee1c8697b0a079ef13e858b647425de5d59471`. After: `55891fb2ea1f679030134653e4c1ce65136d5dbbb3e8dc09a15f08e300324a2b`.

## Immutable mathematical guard

`engine.py`, `forecast_methods.py/js`, `docs/forecast-methods-baseline.json` (including every approvedBlock), and `scripts/golden_diff.py` remain byte-identical. The original protected digests remain `0d80862e43d6e32be9f36d8a021e749f12a4f7d2babe012bca3c93dccacc1ea2` (plugin) and `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d` (engine). The only formerly-included helper is reconstructed by the exact `tests/fixtures/import-safety-approved-delta.json` (SHA-256 `086573da22589146173f4010752ebd77cfe3dce7534511367dfa29cc5b80338f`). Missing/changed snippets and unknown-byte mutations fail closed. The prior preset delta is unchanged.

## Changed accepted-file outcomes

- Previously wrong/ambiguous explicit blank-lot snapshots: 200 -> 100 physical units in the supplied reproducer, with unknown lot quantities and acknowledgement required before CLI/Desktop advice.
- Ambiguous or mixed-separator transaction dates: identical canonical month/quantity values, now acknowledgement required.
- Unstyled 1904 expiry serial 46000: wrong 2025-12-09 -> correct 2029-12-10, matching the styled control; this is a known-epoch reader repair, not a forecast change.
- Optional-price ambiguity reproducer: previously accepted stock 1234 becomes invalid ambiguous stock, exactly as its no-price control; formatting must be clarified before import, not acknowledged into a guessed number.
- Quoted embedded CR: previously rejected Python file now imports losslessly, matching JS.
- Bad lot row: previously aborted workbook now exposes usable rows plus a named set-aside row. Its stock/sales are excluded, matching CSV behavior.

The last four are explicit requested consistency/correctness repairs, not quantity changes on unambiguous historical inputs. Raw `load_csv`/agent-tool consumers retain the pre-existing warning-only contract; unlike CLI/Desktop input-meaning review, the agent tool has no acknowledgement control. This pre-existing surface limitation is not represented as fixed here.

## Verification


## Exact source re-pin receipt

- `sources.py` checkpoint `cee2550` -> `de6ded8`; SHA-256 `3b006371d3ab2ddaaba707eb9d823374d5c20415aefd8cffeba67d7e04092874` -> `eaafe613441d8496ee2c9a5459d20b2208e58a008af1d3d8f4edee45d4be696e`.
- `csv_import.py` checkpoint `50e8117` -> `de6ded8`; SHA-256 `69ad3bdd80a5663f1d7003339c62efdef4eecb27bca8695a4777cb55a8d44c93` -> `1cc216fc77a4295b40618804ac865bbce0870be8e69d7b601cad57992957f76b`.
- Plugin pureBlock `fcbfef80da364610a96177d9aaee1c8697b0a079ef13e858b647425de5d59471` -> `55891fb2ea1f679030134653e4c1ce65136d5dbbb3e8dc09a15f08e300324a2b`.
- Manifest adds two fixtures (41 -> 43); all prior entries and bytes are unchanged. Capture guard now uses both immutable reviewed importer fixtures, including CSV (removing its old mutable-manifest exception).
- Engine checkpoint remains 50e8117 and all forecast-method approvedBlocks are byte-identical.

Final local receipts (all exit 0):

- `node --test --test-concurrency=2 tests/*.mjs`: **3690 passed**, 0 failed (Node heap cap 512 MiB per process).
- `/usr/bin/python3 -m pytest -q`: **2221 passed**; `/usr/bin/python3 -m unittest discover -s tests`: **364 tests, OK**. The reviewer's different Python environment was not used for these receipts.
- `scripts/golden_diff.py`: all fields unchanged, never `--write`; `scripts/verify_import_examples.py`: **8/8 unchanged item quantities**.
- **34 historical CSV fingerprints unchanged** against `1a7d3df` (30 import-probes plus four root CSV fixtures); the frozen fingerprint manifest and a normal regression test are committed.
- Unmodified independent r3: **562 cases, 9063 assertions, zero failures**, including 444 original CSV CLI runs.
- Original `js-runner.mjs` against `FUZZ_REPO=$PWD`: **13 reproducer files**, exact complete Python/JS workbook-reader and report equality; explicit fixed-behavior assertions for every finding. Original `export-runner.mjs` rerun; prior IMPORT-05 fix retained.
- All **10** standalone HTML files rebuilt; full reproducibility/mirror tests passed. `sync_smart_import.py --check` and `sync_input_meaning.py --check` pass.
- `check_docs.py` and `capture-polish.cjs --label after --guard-only` pass with only the documented import pins. Every old baseline entry is unchanged; 43 vendored checkpoint files validate.
- Independent review found no hard blocker in the specified importer scope. Its unrelated-notes-sheet invalid serial regression was then reproduced failing-first and fixed: only valid unstyled serials enter epoch conversion; other raw values reach per-row validation.

[Machine-readable local receipt](v12-import-safety-evidence.json). Logs and original-runner JSON are under this worktree's ignored `.scratch/` directory. Confidence: high for local synthetic behavior. Not checked: installed Desktop, live ERP/production, real spreadsheet applications or UI browser automation in this lane. The pre-existing raw agent-tool warning-only gate remains a limitation, not a fixed surface.
 Failing-first targeted tests were run with `/usr/bin/python3 -m pytest`, not Homebrew Python. Existing goldens were never regenerated. No network, push, install or live inventory was used.
