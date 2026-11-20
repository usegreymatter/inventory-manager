Lifecycle: historical

# v1.1 review-round-2 integration receipt

Local-only integration on `product-page`, starting at `776f058` and merging
`docs/v11-r2` (`d79201e`) in `5839fb0`. Synthetic fixtures only; no publishing,
installation, network access, ERP access or live inventory reads.

## Findings and fixes

- Reserved stock is netted across distinct contributing warehouse rows per exact
  SKU, then the aggregate is floored at zero. An oversold contributing warehouse
  still warns. Ineligible/duplicate warehouse rows do not inflate the subtraction.
- Partly unknown incoming retains known `on_order` and sets
  `incoming_unknown=true`, with per-product and overall warnings. Explicit
  **Not in file** alone removes undated incoming; dated confirmed receipts remain.
- Every contributing stock/sales unit label is checked, independent of row order.
  No automatic unit conversion is added. Reserved subtraction preserves locale
  evidence and exact decimal handling.
- Leading blank months before the first nonblank sale are review-classified as
  `not_yet_launched_cells` per exact SKU across contributing warehouse histories.
  Joined-wide sales count as evidence. All-blank, internal and trailing blanks
  remain missing; the strictly greater than 20% missing-row guard is unchanged.
  The original `blank_sales_cell.csv` has an internal `100,,120` gap and correctly
  still requires acknowledgement. Classification does not change forecast maths.
- The latest in-progress sales month produces the documented warning and requires
  acknowledgement. It is not removed, extrapolated or treated as a completed-month
  correction. Future-month review remains separate.
- CLI flags, stderr review, exit 2/no export before acknowledgement, exit 0 on
  successful export, seven warning texts, exact versus displayed explanation
  ledgers, partial incoming and aggregate reserved semantics are reconciled in
  GUIDE/WHY-THIS-AMOUNT and one coherent v1.1.0 CHANGELOG entry.
- Both import-review surfaces now say **These answers are remembered for this
  file layout. Imported data stays on this device.** The previous blanket claim
  that no spreadsheet rows are saved was false for Desktop. Desktop's
  `commitImport` saves accepted parsed data (minus `import_report`) to plugin-local
  `ctx.storage` as `csv_data`. Standalone keeps accepted parsed products in page
  memory; its `stock-runway-smart-mappings-v1` localStorage entries save bounded
  layout mappings/choices and warning fingerprints, not product rows. Other
  standalone stores retain settings, views and local order records. The replacement
  does not imply that persistence is identical between the two surfaces.
- `tests/storage-disclosure.test.mjs` failed before the wording fix and passed
  afterward. No existing test asserted the old sentence; no protection pin was
  refreshed for this display-only change. `engine.py`, plugin pure-core bytes
  outside INPUT_MEANING, and `scripts/golden_diff.py` remain unchanged by this
  integration.

## Known limitations / decisions still open

- Duplicate purchase-order lines / conflicting main-sheet joins are not redesigned;
  inspect export granularity rather than assuming a PO-line identity/dedup policy.
- SKU joins and launch classification use exact identifiers. Case-differing SKUs
  are not normalized or silently merged; review source identifiers explicitly.
- Some standalone imports retain both the meaning/mapping **Use this** confirmation
  and the preflight **Import N products** confirmation. The double confirmation
  remains; neither is removed to bypass review.
- CLI stock planning remains the CSV loader path, not the smart workbook inspector:
  exports with title/preamble lines may require `scripts/understand_sheet.py` review
  and canonical CSV export before CLI planning.
- In-progress-month handling is **warning and acknowledgement only**. Automatic
  exclusion is pending an owner decision; no forecast-policy change is authorized.

## Verification

Local machine logs are under `.scratch/final-gates/`.

| Gate | Final result |
| --- | --- |
| `node --test tests/*.mjs` | 3,508 passed, 0 failed; exit 0 |
| `/usr/bin/python3 -m pytest -q` | 2,058 passed; exit 0 |
| `/usr/bin/python3 -m unittest discover -s tests` | 202 passed; exit 0 |
| `scripts/golden_diff.py` | all fields unchanged; exit 0 |
| `scripts/verify_import_examples.py` | 8 examples / 8 records; exit 0 |
| All eight ERP example public CLI imports, no acknowledgement flag | 8/8 exit 0 |
| `scripts/check_docs.py` | 123 relative links, 62 JSON files, 0 problems; exit 0 |
| Eight named templates, shipped default, demo-1000 | all 10 builds exit 0 |
| Default versus `option-gm-b` | byte-identical; `cmp` exit 0 |
| All standalone and docs capture scripts | 35 distinct scripts, all final exit 0 |
| Protected integration bytes and seven exact warning texts | unchanged engine/core/golden script; 7/7 texts in GUIDE |
| `git diff --check` | exit 0 |

The initial capture batch had two CLI-usage errors, not product failures. Final
reruns used `--label after` for polish and `--label final --current` for stress;
no capture assertions or pins were changed. The actual Chromium runs use the
synthetic SDK harness where applicable, not real Desktop. At 390 and 1440 widths,
vision inspection confirmed the new storage sentence is legible and unclipped.
The review still repeats a unit-disagreement warning/reason in both layouts;
this pre-existing presentation duplication is not a new calculation change.

Capture acceptance: `.scratch/final-gates/captures-accepted.json` (35 exact exits).
Invariant proof: `.scratch/final-gates/invariants-proof.json`.

## Round-3 offline attack kit

`<local-round-3-kit>/run_r3.sh "$PWD"`
returned **exit 0 / PASS** against this integrated product-page checkout:

- **562 cases**: 62 directed and 500 seeded fuzz; 444 original CSVs and 118 XLSX.
- **9,063 assertions passed**, zero failed assertions and zero failing cases.
- All 444 public CSV CLI runs completed without a crash; Python/JS acceptance,
  input review and accepted value/warning/order/explanation parity passed.
- Aggregate netting, partial-known incoming, units under row permutations,
  current-month warning, invalid reserved rejection, joined incoming and all
  eight clean ERP examples passed the supplied oracles. No kit assertion or
  product behavior was changed to obtain this result.
- **38 stock-only numeric-noise cases** are retained in `numeric-noise.json`:
  CLI/workbook decimal aggregation paths differ within the kit's documented
  absolute tolerance of 1e-9. Quantities, warnings and explanation parity remain
  exact under the kit's checks. This is tolerance-qualified stock parity, not
  a claim of byte-identical floating-point aggregates.
- All seven watched source hashes stayed unchanged during the kit run. Engine
  and pure-core integration invariants also remained unchanged.

The complete kit result directory is retained locally at
`.scratch/final-gates/round3-kit/`; `summary.json` and `failures.json` bind these
counts. The kit does not supply a real launch-date oracle and covers inline-string,
uncompressed XLSX fixtures rather than every Excel encoding.

Not checked: real Desktop installation, real Safari/iPhone hardware, live ERP or
customer inventory, forecast accuracy against future outcomes, and publishing.
