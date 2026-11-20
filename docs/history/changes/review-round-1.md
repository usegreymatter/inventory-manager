Lifecycle: historical

# v1.1 review-round-1 closeout

Local-only code snapshot: `ae9a6eac74d3975308c5355a1229d99fca4c24cd`.
The closeout commit changes this receipt only. No push, install, live inventory,
ERP access, or external network calls were used.

## Corrections

- A: decide unknown incoming after the accepted workbook records are joined and
  parsed. A separate sheet's valid 500 incoming survives; explicit “Not in file”
  still removes undated incoming. Regression exercises parsing through guidance.
- B: explain no-demand suppression and policy adjustments separately from MOQ
  uplift and pack rounding. Pack attribution is smaller than the effective pack.
  Sub-1e-9 arithmetic noise is not labeled as a policy cap.
- C: visible explanations use human decimal amounts with an explicit decimal
  display-rounding term when needed. Displayed terms reconcile to displayed
  quantity; exact numeric attribution remains available in `why_breakdown`,
  including CLI JSON. Monthly rates use mirrored decimal half-up formatting.
- D: blank reserved means zero. Reserved greater than stock keeps the item with
  zero available (the existing engine requires nonnegative stock), adds the
  oversold warning, and retains purchase advice. Decimal subtraction is exact
  on both mirrors; review counts are finalized after accepted-record attachment.
- E: every single-CSV CLI import receives input review. Future sales dates and
  mismatched units require `--show-orders-anyway`; JSON rows carry warnings.
- F/G: retain the remaining recommendation's explanation after a local order,
  append its on-device provenance, use each item's unit, warn about subtracting
  reserved from an “Available” header, and suppress beyond-view quantities in
  the primary table/full product report without changing the planner.
- H: real CSS font embedding and notice tests already used style-only detection.
  Verified all built variants: only `option-gm-c.html` embeds fonts and carries
  the OFL notice/full license. Embedded license text was not counted as CSS.

The reviewer's synthetic `frac.csv` item C produces quantity 6, order date
2054-07-28, in both v1.0 (`9907056`) and this candidate. The long-term computation
was not changed; the primary display now says it is beyond the 6-month view.

## Failing-first evidence

New regressions were committed before implementation. Expected failures are
retained locally in `.scratch/r1-red-node.log`, `r1-red-python.log`,
`r1-display-red.log`, and `r1-review-red.log`. The original snapshot's pack probe
also reproduces SEAL-WHT-300 = -61 and WPR-GRE-01-026 = -856 mislabeled as pack
rounding (`.scratch/r1-red-pack.log`, expected exit 1). Fixed regressions cover
sample, demo-1000, 400 seeded items, and tiny/half-cent decimal edge cases with
Python/JavaScript parity. The older 1,230-case explanation corpus also passes.

Independent Opus review exposed decimal/count edge cases; they were reproduced,
fixed, and retested. A bounded independent second check returned GO and verified
load-bearing negative controls on the immutable math guard.

## Final gates

| Gate | Result |
| --- | --- |
| `node --test tests/*.mjs` | 3,495 passed, 0 failed |
| `/usr/bin/python3 -m pytest -q` | 2,049 passed |
| `/usr/bin/python3 -m unittest discover -s tests` | 202 passed |
| `scripts/golden_diff.py` | exit 0; all fields unchanged |
| `scripts/verify_import_examples.py` | exit 0; 8 files / 8 records |
| CLI imports of all 8 ERP examples | exit 0; no example requires acknowledgement |
| `scripts/check_docs.py` | exit 0 |
| All 8 named builds, default, demo-1000 | rebuilt; byte-identical on repetition |
| `cmp standalone/stock-runway.html standalone/design/option-gm-b.html` | exit 0 |
| All standalone and docs capture scripts | 35 distinct scripts, all final exit 0 |
| Protected engine functions | AST-identical to 9fecf09; frozen purchase/forecast bytes retained |
| `git diff --check` | exit 0 |

Capture reruns used the documented production React harness, `--label after`
for polish, and `--label final --current` for stress. The first capture attempts
exposed stale assertions about zero-valued human terms and the old import-count
sentence; the assertions now check the intended rounded display and new exact
kept/flagged counts. No capture gate was removed.

## Probe and visual receipts

- Adapted copies of the supplied p2/p3/p4 and pw1–4 probes are under
  `.scratch/r1-probes/`; only local paths were changed, plus pw2 now closes the
  active product dialog before selecting the next background row. The original
  pw2 attempted to click an inert, obscured background control and timed out.
- p2: 985 items with numeric advice, zero implausible pack-rounding terms.
- p3/p4: oversold and blank-reserved products remain; 10.3 - 0.1 is 10.2;
  unit/future risks block CLI until acknowledgement; no unexpected import errors.
- pw1/2/3/4: no recorded browser errors; visible rounded product explanations;
  reviewer item C's beyond-view table quantity is hidden.
- `.scratch/r1-product/why-line-hover.png` and
  `why-line-and-chart-tooltip.png` were inspected with vision. The why-line and
  chart tooltip are legible, unit-aware, and free of raw floating residue.
  Native why-title text and matching accessibility text are independently
  captured in `why-tooltip.json`; the OS-native title popup itself is not
  painted into headless screenshots.
- Machine receipts: `.scratch/r1-acceptance.json` (counts and source/artifact
  SHA-256), `.scratch/r1-captures/accepted.json` (35 distinct final exits),
  `.scratch/r1-source-evidence.json` (v1.0 comparison, protected functions, fonts).

## Not checked / unchanged scope

Real Desktop installation, other browser engines, live inventory, ERP writes,
publishing, and native OS title-popup painting were not checked. Pre-existing
workbook duplicate-PO-line/conflicting-main-sheet join semantics and ambiguous
reserved-only comma-decimal style detection were not redesigned in this packet.
