# Review round 3: canonical facts without losing source evidence

Status: implemented and locally verified on the product-page branch. No hosted release, live ERP access, network operation or push was performed.

Scope: local synthetic CSV/workbook import, input-meaning review and Desktop/standalone smart-preflight integration. Reviewed against `c54b645` through `f0b37cb`, including `5c950cd` and `8a43ab7`. This round changes import interpretation, contributor tracking and disclosures, not forecast or order formulas. It adds no connector, live ERP access, network dependency or order-sending action.

## Implemented behavior

### One joined set of facts for arithmetic

- Workbook understanding emits canonical joined rows and a canonical review report. Input review uses these facts, including reserved quantities, incoming totals and distinct stock/sales unit fields joined by exact SKU from auxiliary sheets. A separately joined PO total is not automatically unknown because its column is absent from the base sheet.
- Desktop and standalone smart preflight parse the **adjusted canonical rows** after the interpretation choices. Original source mappings remain editable, and original missing-field/unmatched-sales-history gates survive rebuilding those rows. Missing history is not an assertion of zero demand.
- Compatible non-ledger warehouse sheets add on-hand, reserved, on-order, monthly sales and supplied historical receipt quantities, naming their contributors in **Combined stock from sheets East, West**. Duplicate-looking exports are also added, so remove duplicates upstream. Incompatible quantity schemas require acknowledgement and retain the base snapshot. A long ledger with a stock snapshot is never an additional warehouse, regardless of which sheet is selected as base. With reserved subtraction selected, net aggregate stock against aggregate reserved quantities, then floor once per SKU at zero. Repeated stock/reserved snapshots in a long sales ledger remain snapshots, not quantities to add once per sales transaction.
- Conflicting supplier lead times or units retain the first/base value and require acknowledgement before ordering. Other metadata differences retain the first/base value with one compact informational warning. Acknowledgement accepts the disclosed risk; it neither reconciles conflicting metadata nor converts units.
- Partial incoming coverage retains the known incoming sum and `incoming_unknown`, with **Incoming partly unknown — known incoming retained; check open POs for every warehouse before ordering.** Explicit **Not in file** removes undated incoming; separately supplied confirmed receipts are not removed.

### Keep source evidence beside canonical arithmetic

Canonical rows are the arithmetic input, not a replacement for the source evidence. Review retains original stock/sales row counts, missing-data counts, blank-history classification, sales-date evidence and contributing stock/sales unit labels. Thus a nonblank aggregate cannot erase a missing contributor or conceal a unit mismatch. Warehouse oversold and blank-reserved provenance also survives aggregation; invalid reserved values cannot become valid by being summed with another row.

The existing acknowledgement thresholds remain: strictly more than 20% missing stock/sales rows or sales-ledger quantities, future sales, a latest month still in progress, mismatched units and invalid reserved subtraction can require acknowledgement. Required mappings and unmatched auxiliary history still block parsing where required; acknowledgement is not a row-validation bypass.

### Warehouse column present versus absent

| Source shape | Handling of repeated exact SKU |
| --- | --- |
| Warehouse/Location column, distinct named locations | Sum usable warehouse contributors. |
| Warehouse/Location column, blank cells | Treat as **Unspecified** and aggregate all otherwise usable blank-location rows, including repeated blanks; warn to check duplicate exports. |
| Warehouse/Location column, same named location repeated | Keep first usable row; set aside/omit duplicate. |
| No Warehouse/Location column | Keep first usable row; set aside/omit duplicate rather than invent distinct warehouses. |

A blank warehouse **cell** is deliberately different from an absent warehouse **column**. Incompatible stock units remain excluded. When rows are excluded, totals cover usable contributors only. Repeated product-wide sales in warehouse exports must still be de-duplicated upstream; the importer sums sales rather than guessing export granularity.

### CSV contributor identity

Tolerant CSV preflight now reports `import_report.accepted_rows`: zero-based parsed-record indexes, with the header at index 0, for the rows that actually contributed. This is distinct from the physical source-line numbers in `rows_set_aside`. Contributor tracking preserves quoted multiline cells and blank-record alignment rather than inferring acceptance from physical lines or treating all records as accepted. CSV reserved netting and incoming review exclude rejected contributors. The legacy CSV adapter retains its original delimiter/number convention when reparsing adjusted stock.

### Stable warning and stock-header provenance

`input-meaning-warning-order.json` is the single warning-priority contract: Python reads it, and `scripts/sync_input_meaning.py` generates the matching list in the JavaScript mirror before embedding that module. Global warnings, acknowledgement reasons and per-product warnings are unique and consistently ordered across raw CSV and joined-workbook paths. Equal-priority messages use JavaScript UTF-16 code-unit order in both runtimes; a supplementary-character/fullwidth-name regression was reproduced RED, then fixed in Python without changing the JavaScript outputs. Joined reserved values retain an already-available stock header warning; moving the reserved column to another sheet cannot hide the double-subtraction risk.

### Leading blank history is informational

Leading blank months before the first nonblank sale remain `not_yet_launched_cells`, excluded from missing-data counts. Affected products now receive **New product: N months before first sale ignored**. This warning alone does not require acknowledgement. “Ignored” refers to missing-data classification: the numeric sales series still contains zeros for blank cells, and no months are removed from the forecast window. All-blank, internal and trailing blanks remain missing. Source-based classification survives canonical aggregation.

## Regression contracts and observed TDD

Checked-in synthetic contracts:

- `tests/test_round3_python_regressions.py`: blank-location aggregation, joined incoming/reserved/unit review, warehouse-sheet totals and metadata acknowledgement, accepted CSV contributor identity, invalid-reserved handling, ledger snapshots and oversold provenance.
- `tests/review-round-3.test.mjs`: exact Python/JavaScript canonical-report and review parity, adjusted Desktop/standalone integration, retained missing-mapping/history gates, CSV contributor identities and decimal-comma reparsing.
- `tests/review-round-3-evidence.test.mjs`: source-evidence retention, sheet naming and the per-product new-launch explanation with Python parity.
- `tests/review-final-import.test.mjs`: long-ledger snapshot joins in both directions, compatible warehouse sums, ambiguous quantity schemas, cross-sheet unit conflicts, already-available header provenance and unique review messages. These final review findings were reproduced RED (9 failures, one control) before fixes.
- Warning-order regression reproduced the CLI/joined-path mismatch RED before the shared-priority fix. An audit of the initial kit failures found 91 exact-numeric warning-order differences and 14 also carrying binary floating-point stock tails (maximum `5.684341886080802e-14`); all quantities and explanation sentences were identical. The unchanged kit numeric tolerance covers those tails; no oracle was relaxed.

Observed local TDD evidence (scratch logs are development receipts, not committed release proof):

- `.scratch/round3-python-red.log` records the initial six Python regressions failing: four assertion failures and two errors, including missing contributor/canonical-review fields.
- `.scratch/r3-verified-red.log` records failures for joined facts, warehouse aggregation and related JavaScript parity contracts against the earlier implementation.
- `.scratch/r3-evidence-red.log` records the missing per-product launch explanation. `.scratch/r3-evidence-green.log` records that specific contract passing, **but the same run still has other failures**. Its filename is not proof of a passing suite.

These initial observations establish reproduced failures and targeted progress. The completed final local gate below supersedes the initial partial runs; earlier log filenames alone are not final-pass evidence.

## Completed final local verification

- `node --test tests/*.mjs`: **3,546 passed**, zero failures. Four VM-boundary test assertions were adapted to JSON-value comparison after canonical sorting began replacing warning arrays; warning order is still compared exactly.
- `/usr/bin/python3 -m pytest -q`: **2,072 passed**. `/usr/bin/python3 -m unittest discover -s tests`: **216 passed**.
- `scripts/golden_diff.py`: all fields unchanged. `scripts/verify_import_examples.py`: exit 0. `scripts/check_docs.py`: 125 relative links, 63 JSON files, zero problems. Protected-maths tests and `docs/capture-polish.cjs --label after --guard-only` pass; engine and protected forecast/purchase math remain unchanged.
- All **8/8** `docs/erp-examples` CSVs run through the CLI without acknowledgement flags and return 0.
- All **10** requested standalone outputs rebuilt. `cmp standalone/stock-runway.html standalone/design/option-gm-b.html` returns 0.
- Every capture returns 0 on final outputs: **29 standalone scripts** (including `capture.cjs`) and **6 docs scripts**. Polish used `--label after`; stress used `--label final --current`. An earlier inventory capture failed under the initial capture runner; the fresh final serial docs run passed without a product-code change.
- The **unmodified external round-three kit** returns 0: **562 cases, 9,063 assertions, zero failures**. The 442 applicable original CLI/desktop parity checks all pass. The kit reports 38 binary-floating-point stock-noise cases within its existing `1e-9` tolerance, not changed for this work.
- Original workbook/import probes plus valid browser CSV probes were rerun. Real XLSX browser imports preserve joined PO quantities (A: stock 20, incoming 50) and combined warehouse stock (110). The two-month `short2.csv` fixture is intentionally invalid: CLI returns 2 and browser states **Add at least three YYYY-MM monthly sales columns**, retaining previous sample data; the original probe's attempt to import it is not a product acceptance expectation.

Final receipts are in `.scratch/r3-final-kit.log`, `.scratch/r3-final-node.log`, `.scratch/r3-final-pytest.log`, `.scratch/r3-final-unittest.log`, `.scratch/r3-final-captures/{standalone,docs}-results.json` and `.scratch/r3-probes/`. The 105-failure pre-fix audit is `.scratch/r3-kit-order-audit.json`. These are local verification artifacts, not a live-runtime or hosted-release claim.

## Round-3 re-check

The follow-up reviewer probes reproduced A1/A2/O1/O2/O3 before their fixes. Python
RED evidence is `.scratch/recheck-python-red.log`; JavaScript RED evidence is
`.scratch/recheck-js-red.log`. The independent final review also found numeric SKU
object-enumeration order diverging between runtimes; `.scratch/recheck-numeric-red.log`
records that failure before affected-product lists gained one UTF-16 SKU ordering.
The new checked-in regressions are `tests/test_round3_recheck.py` and
`tests/review-round-3-recheck.test.mjs`.

- **A1:** incoming retained from a non-additive ledger snapshot now carries known
  provenance. The ledger join keeps incoming 50 and never describes it as zero.
- **A2:** CSV review carries the metadata conflicts of its actual accepted source
  contributors. Conflicting 14/180-day leads require acknowledgement on CLI,
  Desktop and standalone; CLI returns 2 with no order output until overridden.
- **O1:** every product whose stock combines multiple compatible sheets receives
  a named-sheet confirmation and acknowledgement reason, warning against totals,
  copies and older snapshots. The added stock quantities remain unchanged.
- **O2:** exact cell-for-cell identical blank-location rows require acknowledgement
  in CSV and workbooks and retain a per-product duplicate-export warning. This is
  intentionally not fuzzy duplicate detection; nonidentical rows still aggregate.
- **O3:** selecting stock-includes-reserved retains a per-product warning naming
  contributing stock sheets with absent/blank reserved evidence, even when another
  sheet supplies a reserved column. This warning alone does not require acknowledgement.

The general incoming/why invariant covers every usable item in the checked-in
workbook fixtures plus the new regressions. The external kit was also checked
across all 562 fixtures / 558 imported items: 128 fully unknown, 161 partly unknown
and 269 known. Fully unknown supply has no negative incoming ledger term; known
supply matches its ledger deduction. **Partial supply is intentionally different:**
`incoming_unknown` remains true while known incoming is retained and deducted; it
must show “Incoming partly unknown”, never “counted as 0”. A literal invariant
`incoming_unknown => no incoming term` would contradict that existing contract and
change quantities, so the check explicitly distinguishes full from partial unknowns.

Re-check verification on the final source:

- JavaScript suite: **3,554 passed**, zero failures.
- Python pytest: **2,081 passed**; unittest discovery: **225 passed**.
- Golden outputs unchanged; protected-maths guard unchanged and passing; all
  8 import examples return 0 without acknowledgement flags; docs check returns 0.
- All 10 offline outputs rebuilt; default equals `design/option-gm-b.html` byte-for-byte.
- All **35 capture scripts** return 0 on final outputs: **6 docs + 29 standalone**.
  Polish used `--label after`; stress used `--label final --current`. The initial
  stale import-only fingerprint failure was resolved by the documented fingerprint
  refresh; the final complete capture rerun passes.
- Unmodified external round-three kit: **562 cases / 9,063 assertions**, exit 0.
- Astra focused and original 16-case browser harnesses return 0; an extended
  **21-case** offline Chromium harness adds totals/snapshots, exact duplicates in
  CSV/XLSX and partially missing reserved. All acknowledgement controls gate before
  acceptance, imports enable after acknowledgement, and there are no page errors.
- All **25 Opus reviewer variants** rerun; all 8 applicable original CLI/browser
  comparisons match quantities, warning arrays and acknowledgement exactly.
- The import-only pure-block fingerprint was refreshed after the protected-maths
  guard passed. Engine, sources, CSV importer and sample bytes were not changed.

Receipts: `.scratch/recheck-full-results.json`, `.scratch/recheck-full-*.log`,
`.scratch/recheck-capture-results.json`, `.scratch/recheck-capture-*.log`,
`.scratch/recheck-cli-eight.json`, `.scratch/recheck-astra-*.log`,
`.scratch/recheck-extended-browser.log`, `.scratch/recheck-opus-*.log` and
`.scratch/recheck-all-incoming.log`. These are local-only synthetic receipts.

Not checked: live ERP/customer files, hosted deployment, native Hermes Desktop,
real Safari/iPhone hardware or remote systems. Nothing was pushed or sent.

## v1.1 final-polish addendum

The final reviewer findings F1–F4 were reproduced before changes. Import regressions
first failed **10/10** checks; the cross-sheet warning-budget follow-up also failed
before its fix. Browser REDs independently covered the supplied
`v_reserved_one_sheet.xlsx`, duplicate rows and metadata conflicts with import
controls closed. Desktop RED covered the missing affected-product count and row
accessible name. The follow-up all-shell regression reproduced the legacy null
anchor and empty-global-warning fallback failures (**11 failed / 12 passed**),
then passed **23/23**. A3 string/ID contracts were fixed without relaxing their tests. A final failing-first
codegen test normalizes authored EOF blank lines while preserving every existing
embedded/generated byte; all ten pages were rebuilt unchanged after that cleanup.

- **F1:** accepted imports keep a visible worklist summary, an affected-product
  count and session-only dismissal. Affected rows keep text warning markers, and
  the Arctic full product page, side panel and Desktop product advice keep the
  actual item warnings. Warning strings use DOM text/React children, never user
  HTML. Dismissal neither alters the warnings nor writes local storage; the next
  accepted import restores the summary. Older design shells have a safe main/body
  banner anchor instead of assuming the Arctic worklist exists.
- **F2:** exact-SKU reserved evidence joined from a no-stock allocations sheet
  clears false missing-reserved provenance, including a supplied zero. The
  original joined-allocations probe now has stock **40**, incoming **50**, no
  warnings and no acknowledgement gate. Blank allocations still warn.
- **F3:** only lead-time/unit metadata conflicts require acknowledgement. Other
  metadata, including name, supplier, cost, MOQ and pack size, retains the first
  value with one compact informational summary: affected count, at most ten
  shortened SKU examples and remaining count. A real 500-SKU East 5.00 / West
  5.20 CSV now exits **0** without acknowledgement flags; its single metadata
  message names ten examples and **490 more**. Metadata messages and aggregate
  warning budgets are bounded in both runtimes. Review retained the explicit
  scope rather than broadening the gate back to MOQ/pack conflicts.
- **F4:** filling blank base stock is described as **filled**, not added together;
  any actual later addition is still disclosed. A single-sheet absent reserved
  column produces one disclosure instead of a duplicate pair.

Final source verification:

- `node --test tests/*.mjs`: **3,590 passed**, zero failures.
- `/usr/bin/python3 -m pytest -q`: **2,082 passed**; unittest discovery:
  **225 passed**, all exit 0.
- Golden outputs unchanged; protected-maths tests pass unchanged; import examples
  retain all eight item-record hashes. Authored workbook and embedded mirrors
  are synchronized. The import-only pure-block fingerprint was refreshed only
  after the unchanged protected-maths guard passed; engine/forecast code was not
  changed.
- All eight ERP CLI examples exit 0 without acknowledgement flags. The original
  r5 reviewer harness passes **46 cases**; its real browser harness now asserts
  warning visibility as a hard failure instead of merely logging visibility
  failures. No product assertions were relaxed.
- All ten offline outputs were rebuilt; default equals `option-gm-b.html`
  byte-for-byte. An independent clean-archive rebuild also compared all ten.
- All **35 original captures plus the new warning-visibility capture** exit 0
  on final outputs (**6 docs + 30 standalone = 36**). Polish used `--label after`;
  stress used `--label final --current`. The warning-visibility capture passes
  **118 checks** at 1440/390 widths, including literal malicious text, dismissal,
  repeat imports, full-page/side-panel disclosure and warning-free synthetic
  controls. The original r5 real-browser harness passes **32 imports** with
  hard warning-visibility assertions and no page errors.
- The unmodified external round-three kit exits 0: **562 cases / 9,063 assertions**,
  zero failures. Docs check: 125 relative links, 63 JSON files, zero problems.

False-alarm acceptance clarification: the actual sample and actual 1,000-product
page show no input-warning banner or markers. The eight shipped ERP CSV examples
all omit incoming supply and therefore truthfully retain their pre-existing
**Incoming orders unknown** disclosure (no acknowledgement required). Browser
checks confirm no new reserved/metadata/aggregation/duplicate warnings on these
examples. A literal requirement for *no warning banner at all* on those incomplete
files conflicts with persistent missing-incoming disclosure; the warning was not
hidden and the fixtures were not changed to manufacture a pass.

Initial verification failures were resolved, not ignored: the supplied reviewer
fixture was moved out of the exact-generator fixture directory; A3 copy moved
into its existing string table; shared banner reset remains in the import module.
The first docs-capture harness accidentally used React development mode and
reported the same pre-existing missing-option-key warning on the unchanged base.
The final harness uses the production React mode used for runtime captures; no
product exception or capture assertion was added to suppress errors.

Local receipts: `.scratch/polish-final-*-results.json`,
`.scratch/polish-final-*.log`, `.scratch/polish-false-alarm-results.json`,
`.scratch/import-warnings-receipt.json`, `.scratch/warning-visibility/report.json`,
`.scratch/f1-*-red*.log`, `.scratch/f1-followup-*-red.log`,
`.scratch/polish-final-review.md` and `.scratch/polish-second-check.md`.
Independent review found and reproduced the legacy-anchor issue; the fix was
verified by the follow-up test and outside-family second check.

Not checked: live ERP/customer files, hosted deployment, native Hermes Desktop,
real Safari/iPhone hardware or remote systems. No push, send, install or network
operation was performed. The pre-existing failed/cancelled-import summary-reset
lifecycle on older banner-only variants is outside this accepted-import fix.
