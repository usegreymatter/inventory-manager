# Phase 1 part A — number trust

Local sample/synthetic proof only. No live ERP, installation, remote or order placement.
Golden clock: 2026-11-12; snapshot: 2026-10-31.

Historical sample-derived numerical table retired in synthetic-data publication refresh; regenerate current results with `python3 scripts/golden_diff.py`. Historical sample rows below are removed rather than replaced with current results. Independently synthetic examples, formulas, approved rules and dated test-count receipts remain historical evidence.

## 1. Golden baseline

Five sample items and six synthetic edge items pin quantity, order-by, physical
run-out and display status, separately for Desktop JS, Python and CLI CSV export.
`ZERO-HISTORY` means an all-zero observed history (no observed demand), not a
missing file. MOQ/pack overrides exercise the real CLI `_export_rows` boundary;
the existing CLI does not expose SKU overrides as command-line flags.
`python3 scripts/golden_diff.py` prints the before/after Markdown table;
`--write` accepts results only after JS == Python == CLI. Inputs and numbers live
in `tests/golden/`; no production calculation changes in this step.

Validation: golden test RED while harness missing, then GREEN (1 passed).

| sku | field | before | after |
| --- | --- | --- | --- |
| (all 11 SKUs) | quantity / order-by / run-out / status | not pinned | baseline pinned identically on 3 surfaces |

## 2a. Round only the final purchase

Reason: keep fractional calendar-month demand throughout forecasting and planning;
apply the purchase ceiling once, with the existing exact-decimal MOQ/pack rules.
The four-ULP seasonal integer correction is unchanged. Safety-stock/reorder-point
quantities retain their own existing conservative ceilings (not demand rounding).

| sku | field | before | after |
| --- | --- | --- | --- |
| INTERMITTENT | order_qty | 11 | 9 |
| INTERMITTENT | run_out | 2026-11-08 | 2026-11-09 |
| HUGE-MOQ | order_by | 2026-11-14 | 2026-11-16 |
| HUGE-MOQ | run_out | 2026-11-28 | 2026-11-30 |
| PACK-SIZE | order_by | 2026-11-14 | 2026-11-16 |
| PACK-SIZE | run_out | 2026-11-28 | 2026-11-30 |
| UNDATED-INCOMING | order_by | 2027-10-12 | 2027-11-07 |
| UNDATED-INCOMING | run_out | 2027-01-23 | 2027-01-29 |

Refreshed pins: `tests/fixtures/planning-legacy.json` (only fractional demand
and dependent balance/order/EOQ values); `test_engine.py` rational sample and
fractional/ULP oracles; `test_a9_stress.py` fractional projections; `test_odoo.py`
fake fractional unit conversion; `test_safety.py` fractional receipt coverage;
`test_guidance.py` white-sealant quantity; `desktop.test.mjs` corresponding sample,
fractional projection/headline/order oracles and collision-aware value-label count.
`test_legacy_unchanged.py` still compares 468 complete historical-engine results,
with exactly one asserted historical source seam changed: monthly demand no longer
ceilings. All other historical code, validations and backtests remain the oracle.
This is an authorized delta, not an exclusion of changed output fields.

Guard refresh: only `engine.py` file hash and Desktop pure-block hash changed in
`docs/seasonal-logic-baseline.json`, because those are the two intentional maths
edits. `sources.py`, `tools.py`, sample and editor-block hashes remain untouched.
Mutation-rejection and historical backtest byte guards still pass. Rebuilt all five
HTML outputs because regeneration guards cover the review candidates too.

Validation: targeted RED (11 != 10.25) then GREEN; full pytest 1220 passed;
full Node suite 2241 passed, including exact Python/JS guidance and 1200 fuzz cases.

## 2b. One calendar cover rule

Reason: status cover now measures remaining calendar days to the same inventory-
position crossing used by order-by, divided by the shared 30-day month convention.
It no longer divides stale snapshot stock by just the next month's seasonal rate.
Seasonality, dated receipts, incoming position and elapsed time now inform both.
Lead-time order-now/order-soon checks still precede overstock, so a long-lead item
with abundant stock cannot be labelled Overstocked while needing an urgent order.
No quantity or date changed in this commit.

Historical sample-derived status table retired in synthetic-data publication refresh; regenerate current results with `python3 scripts/golden_diff.py`.

Updated pins: `planning-legacy.json` JS cover values (Python legacy physical
forecast fixture unchanged); `test_guidance.py` two sample statuses; Desktop A4
recovered 100-unit receipt now correctly shows more than six months' calendar
cover; parity's explicitly allowlisted JS year-zero case now has that same cover
status (Python still rejects year zero). Added a whole-corpus no-contradiction
assertion. Only the intentional engine and Desktop pure-block hashes refreshed;
all source/sample/editor hashes and backtest guards retained.

Validation: targeted cover RED (6.315 != 5.267), then full pytest 1221 passed
and full Node 2242 passed, including every guidance field and fuzz case.

## 2c. Buffer days on order-by

Reason: order-by now = inventory-position crossing − lead time − buffer days
(default 7). Buffer is *time* only: it moves the purchase deadline earlier but
does not add units, change physical run-out, or change the quantity-cover end, so
it does not double count with optional safety stock (quantity). Settings key +
Advanced control (Desktop and A3), CLI `--buffer-days`, `/stock` parsing,
persistence/reset and validation added.

| sku | field | before | after |
| --- | --- | --- | --- |
| HUGE-MOQ | order_by | 2026-11-16 | now |
| PACK-SIZE | order_by | 2026-11-16 | now |
| UNDATED-INCOMING | order_by | 2027-11-07 | 2027-10-31 |

Updated pins: `tests/fixtures/planning-legacy.json`, `tests/test_guidance.py`,
`tests/desktop.test.mjs`. Intentional hashes refreshed for engine.py, tools.py,
Desktop pure core and settings/editor blocks; sources.py/sample hashes and
historical backtest guards retained.

Validation (Default rerun 2026-11-13): pytest 1227 passed; Node 2338 passed,
0 failed; golden JS/Python/CLI agree on all 11 cases; capture-a3 PASS (113);
`git diff --check` clean.

## 2d. Purchase attention precedes surplus labels (Opus findings 1–2)

Reason: explicit precedence is held → uncovered supply gap → positive-purchase
urgency (urgent days, then max(running-low days, lead + effective buffer)) →
no-purchase state. Positive future replenishment is never surplus. Zero-quantity
gaps remain visible as Order soon/check, not Order now. JS and Python are identical.

| sku | field | before | after |
| --- | --- | --- | --- |
| gap regression: 40 hand / 160 undated / 30 per month / 150-day lead | status | overstocked | order |
| (all 11 golden SKUs) | quantity / order-by / run-out / status | unchanged | unchanged |

Replaced the tautological urgency test with an independent invariant across JS,
Python and the whole corpus, including the gap regression and 1200 seeded cases
varying buffer 0..3650 and cover 0..36. RED on unchanged pre-fix 0374a1c core:
`node --test --test-name-pattern='purchase status invariants' tests/guidance.parity.test.mjs`
exited 1 (`JS/sample/SEAL-CLR-300/-30/0 positive order`, Overstocked). Evidence:
`.scratch/status-red.log`. The old code was still untouched at that point (no
stash needed). The new rule also fixes the positive-order gap fixture. Golden
refreshed with `python3 scripts/golden_diff.py --write`: all surfaces agree.

## 2e. Receipt-window test detects excluded receipts (Opus finding 3)

The safety regression now uses 3 units/month and requires a 2.7-unit purchase,
with and without the January delivery. Moving that delivery into December
reduces the purchase to zero. Mutation proof: removing only `<= endpoint` from
`safety_order_planning` makes the test fail with `0 != 2.7` (exit 1,
`.scratch/safety-mutation.log`); restored production code passes. No maths changed.

## 2f. Plan-bounded buffer and no empty purchase deadline (Opus finding 4)

Reason: normalize persisted integer buffer values 0..3650 to at most 365 days;
invalid values still use 7. CLI and `/stock` reject new values outside 0..365.
Effective timing buffer is min(normalized buffer, ceil(months of cover × 30)),
so zero cover has zero margin and a large buffer cannot drag a 33-month-stock
item into today's order list. Positive quantities/physical cover targets remain
unchanged. A zero purchase now has no order-by date, even when its physical
crossing is near; supply-gap checks remain visible as Order soon rather than an
empty Order now instruction. Reorder estimates are addressed separately below.

| sku | field | before | after |
| --- | --- | --- | --- |
| UNDATED-INCOMING | order_by | 2027-10-31 | None (zero purchase) |
| 33-month synthetic / buffer 3650 / cover 2 | order_by | now | physical crossing − lead − 60 days (future) |
| zero-cover synthetic / zero purchase | order_by | now | None |
| all golden SKUs | quantity / run-out / status | unchanged | unchanged |

New bound/zero-purchase tests failed before implementation (3650 != 365 and
'now' != None). Extended exact parity corpus includes 16 explicit buffer/cover
cross-products and the null-deadline invariant. Golden --write agrees on all
11 JS/Python/CLI cases. The previous year-1000 underflow fixture now remains
valid because the margin is limited to its selected 60-day plan.

## 2g. Displayed reorder point uses the timing margin (Opus finding 5)

Reason: reorder point now includes demand over lead + effective buffer, plus the
existing safety stock. Optional safety units are still unchanged and added only
once to purchase quantity. This is a calendar-demand estimate at the snapshot,
not a receipt-aware instruction to buy a second time. Updated Desktop hint:
margin is capped to cover; earlier arrivals raise average stock slightly.

| sku | field | before | after |
| --- | --- | --- | --- |
| steady synthetic, 30/month, lead 14, buffer 7 | reorder_point | 14 | 21 |
| same item, buffer 3650 / cover 2 | reorder_point | 14 | 73 (lead + capped 60-day margin) |
| (all 11 golden SKUs) | quantity / order-by / run-out / status | unchanged | unchanged |

Test RED (`14 != 21`), then GREEN. `golden_diff.py --write` reports all fields
unchanged and JS/Python/CLI equal; 2020 exact guidance parity tests pass.

Reorder regression refresh: retained all 468 historical whole-result comparisons,
with exactly two asserted source seams (fractional month demand and the new
seven-day default reorder margin); no fields are dropped. Independent calendar
formula tests and exact sample chat/card/slash text now include the margin.

## 2h. Restore strict assertions (Opus finding 6)

Sample engine values were restored as exact pins. The historical sample-derived
numerical ULP example is retired; regenerate current results with
`python3 -m pytest -q tests/test_engine.py`. Only the independent rational
cross-check permits one binary64 ULP, with an explanatory comment; all
integer-demand comparisons remain exact.
The Desktop anchor compares order-by to `calculate` again with buffer explicitly
zero, while the adjacent default-buffer boundary assertions remain independent.

Restoring six labels everywhere fails for narrow A3 (`SEAL-WHT-300`, 350px,
start 12: five collision-free labels; `.scratch/labels-red.log`). Strengthened
minimum back to six for every A2 and every wide A3 case. Narrow A3 alone keeps
four because its existing collision avoidance intentionally suppresses labels;
separate A3 geometry checks still verify all six at desktop widths and absence
of stock-path collisions. No UI sources or chart maths changed. Targeted tests:
26 Python engine + 3 Desktop anchor/label cases pass.

## 2i. CLI day flags require ASCII digits (Opus finding 7)

Both `--buffer-days` and `--delivery-days` validate `[0-9]+` before `int`,
matching `/stock`'s existing strict token contract. Unicode digits, underscores,
signs, decimal notation and NaN are rejected (argparse exit 2). RED: CLI accepted
`٧` with exit 0. The process-level matrix now checks both flags and slash;
buffer 365 succeeds and 366 is rejected. No forecast maths changed.

## 2j. Refresh exact regression expectations for approved status rules

Updated old UI/standalone expectations that required zero-quantity Order now or
Overstocked alongside a positive future purchase. Physical gap dates, restored
balances, receipt quantities, 61-row pagination and PO exclusion checks are all
retained. Zero-quantity gaps now count in Order soon; no-gap zero purchases leave
the attention panel. Added an exact-crossing, zero-cover surplus fixture so every
bucket still has real calculation coverage rather than merely dropping surplus
coverage. Regenerated all five standalone variants for their byte-equality gates.

Explicit old-copy replay: loaded exact `0374a1c:desktop/plugin.js` into the
isolated test target and reran the final invariant. It failed on the named gap
regression (`overstocked` != `order`, exit 1), not merely on a parity mismatch.
Evidence `.scratch/invariant-old-copy.log`; restored current bytes immediately.
The test pins quantity 20 and supply_gap true before checking precedence.

## Final local verification (Opus follow-up)

- `python3 -m pytest -q`: **1231 passed**, exit 0.
- `node --test tests/*.test.mjs`: **2355 passed**, zero failures/skips, exit 0.
- `node standalone/capture-a3.cjs`: **PASS**, 113 checks, zero failures;
  exact report `.scratch/design/a3-browser-report.json` read back and validated.
- `python3 scripts/golden_diff.py`: all 11 cases JS == Python == CLI;
  no unreviewed differences against refreshed pins. Only golden delta in this
  follow-up is UNDATED-INCOMING's zero-purchase deadline becoming null.
- All five standalone outputs rebuilt; regeneration and exact-core tests pass.
- `git diff --check`: clean. Dedicated child branch is based on the requested
  0374a1c maths baseline, not its automatically inherited forecast-lab branch.
  No forecast-lab changes were imported; no A3 UI source files were edited.

Not checked: live ERP, installed Desktop plugin, hosted deployment, Safari/
Firefox, physical touch devices, human screenshot review. No remote, push,
installation, live credentials or supplier actions were used.
