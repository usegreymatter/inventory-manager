Lifecycle: working
# Phase 2 first milestone: dated supply and committed demand

Authority: native writer packet, 2026-11-13; isolated branch based on a0b3264.
This milestone does not claim full roadmap acceptance or live ERP proof.

## Feature 1 — dated incoming purchase orders

Only explicit `planning_facts` activates the dated event path. The existing single
CSV importer and absent-facts whole outputs retain Phase 1 behavior. Readiness is
per SKU; a valid row for another SKU does not unlock missing/invalid facts.

Confirmed positive `remaining_qty` arrives at the **start of its exact due date**,
before that business day's demand. A first depletion remains visible even if a
later receipt restores stock; chart month-end totals do not erase intra-month gaps.
Draft, cancelled and received lines contribute nothing; identities, destinations,
supplier, quantities and real dates are required even on excluded lines.

Snapshot stock is close-of-day. Forecast baseline starts the following day.
The dated supply cutoff is `max(today, snapshot + 1 day)`: a PO due today is usable;
a positive confirmed PO before that cutoff is unresolved and excluded from every
trusted projected balance. Rolling an old snapshot forward never marks a scheduled
PO fulfilled. Actual fulfillment needs a refreshed snapshot. Late PO locks purchase
approval (`needs-data`, `purchase_hold=true`, no `quantity` or `order_by`); the
unapproved calculation remains as `scenario_quantity` with `late_po_quantity`.
Reconfirm the date or reconcile the outstanding balance before buying a replacement.
Positive aggregate `on_order` or legacy dated supply overlapping confirmed detailed
supply locks purchases; the streams are never summed. Invalid optional facts lock
purchases while preserving baseline physical calculations and unrelated SKUs.

Physical runout, calendar order timing, quantity endpoint and bucket share the same
adopted event stream in Python and JavaScript. Legacy month-only receipts keep their
old start-of-month timing. Legacy on-order remains undated purchase credit only.

### Explicit local load paths

- Python: `sources.load_bundle(directory, today='2026-11-13')` uses the existing
  strict `data_contract.validate_bundle` preflight over named sibling files.
- Chat tool: `{"source":"csv","bundle_path":"/path/to/bundle"}`. A bundle is
  mutually exclusive with `csv_path` / `receipts_path`.
- CLI: `/usr/bin/python3 stock_runway.py /path/to/bundle --bundle --today 2026-11-13 --all`.
- Browser/Desktop: `/usr/bin/python3 bundle_import.py /path/to/bundle --today 2026-11-13 > /new/path/bundle.json`,
  then choose that JSON in the existing file picker. The source CSV directory is
  read-only. No dependencies, network or ERP fields are added. Existing CSVs still
  use the unchanged parser. Browser bridge maximum 16 MiB; each CSV retains 2 MiB.

Bridge schema: dataset `bundle_version:"1.0"`, `as_of`, `decision_date`, `months`,
`items`; item `planning_facts:{version:"1.0",warehouses:["MAIN"],incoming_pos:[…]}`.
Rows retain CONTRACT field names, with numeric quantities represented as JSON numbers.
`errors.dated_incoming` carries strict validator error codes; absence means unknown,
never an empty complete table. `bundle_health` is diagnostic only. Browser calculations
independently revalidate each item's metadata; uploaded readiness claims cannot unlock
facts. Duplicate bridge PO identities lock all involved items. The bridge is local
interchange, not a signed export or a direct ERP adapter. UI and Why expansion follows
in the next milestone; no new main-screen column or status dot is introduced here.

### Reviewed legacy golden delta after feature 1

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

Feature 1 verification: full pytest **1348 passed**, full Node **2374 passed**;
180 seeded cross-language optional-fact cases inside the new Node parity test;
whole calculated/guidance regressions against a0b3264, plus retained 468-case
historical forecast oracle. All five generated standalone variants rebuilt.
Golden reconciliation passed across Python/JS/CLI; `git diff --check` passed.
No actual browser session, real Desktop, ERP or hosted behavior is claimed.

## Feature 2 — committed customer demand (controller commit pending)

Built on feature-1 commit `afea1c3`. Only per-SKU valid optional customer facts
activate this adjustment; single CSVs and supply-only facts retain their numeric
outputs. `customer_orders.csv` uses the existing strict contract, including unique
identities, destination references, real dates, nonnegative remaining base-unit
quantities, `confirmed`/`draft`/`cancelled` states and an explicit boolean inclusion
classification. Only positive confirmed balances draw stock. Excluded lines still
validate; one malformed/duplicate line locks that SKU's customer facts, rather than
applying an unverified partial sum. Valid supply facts remain independent.

### Adopted dates and allocation

For each **global SKU** calendar month, let B be the fractional baseline, C the sum
of included obligations, and A incremental obligations. Demand is exactly
`max(B,C)+A`: distribute `max(0,B-C)` uniformly over that month's actual calendar
days, put **full** included and incremental quantities on their adopted delivery
dates. Included obligations consume the month's allocation once; neither an entire
monthly baseline nor a second reservation debit is added to those same units.
Future obligations remain on their dates, never spread backwards as an extra daily
load. The reduced residual baseline can extend through the days before the delivery;
this is the pinned allocation policy, not a claim about customers' daily behavior.

Example: B=30, included=20 on Nov 10 gives residual 10/30 per day and a 20-unit
Nov 10 event. With 25 opening stock, demand through Nov 9 is 3; depletion is Nov 15,
month demand is 30, not 50. Included=80 makes the month 80. Incremental=20 without
included orders makes it 50. Full precision is retained until purchase rounding.

Outstanding delivery dates before `max(today,snapshot+1 day)` are adopted on that
cutoff and flagged in `overdue_order_quantity` / Data health. Included overdue
quantities consume the **adopted month's** allocation. Earlier baseline months remain
consumed; moving an old undelivered promise forward never invents fulfillment or
removes historical forecast consumption. Due-today orders are not overdue. No
orders are consumed inside the close-of-day stock snapshot. If planning is on the
snapshot date itself, adopted events begin the next day.

On each date: **all confirmed receipts first, all customer obligations second,
that day's residual baseline last**. Aggregate same-date events before testing the
crossing; file row order cannot invent a temporary same-day shortage. Retain the
first at-or-below-zero day after later recovery. Physical projection/runout, today's
balance, inventory-position crossing, order endpoint/quantity, bucket, tool and CLI
all use this same event ledger and clock. Desktop quick view now also passes the
planning clock rather than treating a bridge export's old decision date as today.
An item with outstanding commitments is not put in No sales solely because its
three historical sales months are zero. Historical safety/backtest estimates stay
based on history; commitments affect the dated demand ledger.

### Reservation boundary — explicit HOLD path

This milestone supports the conservative **HOLD** alternative in CONTRACT, not a
reservation allocator. For each destination with a positive confirmed customer
balance, `stock_states.csv` must explicitly observe **zero reserved**. Its strict
preflight requires matching valid `warehouse_stock.csv`; missing/partial/error facts
are unknown, never asserted zero. The bridge carries those per-SKU state rows and
scoped `errors.reservations` alongside the orders. At runtime, duplicate/invalid
states, unknown reservation status, positive reservation balances, an ambiguous
precomputed usable-stock balance, or an invalid explicit `reserved` value HOLD
purchase approval. Raw bridge metadata cannot claim readiness around this gate.

Positive reserved quantities remain locked even if a caller supplies an unimplemented
`reservation_mapping` assertion. No mapping schema, relief engine, partial reservation
allocation or usable-stock subtraction ships here. Valid customer events still run
as a **gross-stock provisional scenario**, with `scenario_quantity` retained,
`purchase_hold=true`, `quantity=null`, `order_by=null`, and a needs-data bucket.
Reservations are not subtracted a second time. A future explicitly validated mapping
and stock-availability policy is needed to release these held cases. The existing
CSV import path remains usable: zero-reservation bundles can unlock immediately;
otherwise the source is still inspected with approval held.

### Loader, bridge and health

The feature-1 opt-in commands remain the actual path; `sources.load_bundle`, tool
`bundle_path`, CLI `--bundle` and `bundle_import.py` now attach typed
`planning_facts.customer_orders` (CONTRACT fields; `forecast_included` JSON boolean)
and optional `planning_facts.stock_states`. Nothing is added to `stock.csv` columns.
There is no new ERP allowlist entry or dependency. Browser JSON import independently
validates per-item facts and detects duplicate order identities across SKUs.

Both health implementations emit per-SKU `committed_demand` Hidden/Locked/On gates
(short chip **Customer orders**), and align the existing committed-orders gate to
runtime readiness when these facts are present. Late customer orders and reservation
HOLDs use the existing Data health surface. No main-screen column or status dot was
added. No demand cleaning, site allocation, UI/Why expansion, or next maths feature
is included in this round. Warehouse references validate destinations; SKU-only
history cannot supply site demand shares, so the demand ledger remains global.

### Reviewed optional-fixture delta after feature 2

Seven reproducible synthetic cases live in `tests/golden/phase2-inputs.json`.
`phase2-before.json` was executed against **unchanged committed afea1c3 Python and
Desktop source**, with CLI export using that historical engine; all three agreed.
`phase2-numbers.json` records current Python/Desktop/CLI agreement. A separate test
also exercises the actual strict directory loader, chat tool and CLI process for
all seven cases. The included=20 purchase drops because its earlier first depletion
moves the same physical cover window earlier; it is not a removal of customer demand.
`None` in the table means no actionable purchase value, not zero.

| sku | field | before | after |
| --- | --- | --- | --- |
| INCLUDED-20 | order_qty | 59 | 49 |
| INCLUDED-20 | order_by | 2026-11-16 | 2026-11-06 |
| INCLUDED-20 | run_out | 2026-11-25 | 2026-11-15 |
| INCLUDED-20 | status | running-low | order |
| INCLUDED-80 | order_qty | 59 | 104 |
| INCLUDED-80 | order_by | 2026-11-16 | 2026-11-11 |
| INCLUDED-80 | run_out | 2026-11-25 | 2026-11-20 |
| INCREMENTAL-20 | order_qty | 59 | 64 |
| INCREMENTAL-20 | order_by | 2026-11-16 | now |
| INCREMENTAL-20 | run_out | 2026-11-25 | 2026-11-10 |
| INCREMENTAL-20 | status | running-low | order |
| OVERDUE-40 | order_qty | 59 | 47 |
| OVERDUE-40 | order_by | 2026-11-16 | now |
| OVERDUE-40 | run_out | 2026-11-25 | 2026-11-01 |
| OVERDUE-40 | status | running-low | order |
| RESERVED-HOLD | order_qty | 59 | None |
| RESERVED-HOLD | order_by | 2026-11-16 | None |
| RESERVED-HOLD | run_out | 2026-11-25 | 2026-11-15 |
| RESERVED-HOLD | status | running-low | needs-data |
| ZERO-BASELINE | order_qty | 0 | 15 |
| ZERO-BASELINE | order_by | None | 2026-11-11 |
| ZERO-BASELINE | run_out | None | 2026-11-20 |
| ZERO-BASELINE | status | no-sales | running-low |
| SAME-DAY-SUPPLY | order_by | 2026-12-07 | 2026-11-27 |
| SAME-DAY-SUPPLY | run_out | 2026-12-16 | 2026-12-06 |
| SAME-DAY-SUPPLY | status | healthy | running-low |

Regenerate the optional table without replacing the legacy fixtures:

```sh
TMPDIR="$PWD/.scratch" /usr/bin/python3 scripts/golden_diff.py \
  --inputs tests/golden/phase2-inputs.json --output tests/golden/phase2-numbers.json \
  --before tests/golden/phase2-before.json --write
```

### Legacy golden delta after feature 2

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

Feature 2 local verification: full pytest **1379 passed** (exit 0), full Node
**2381 passed, 0 failed/skipped** (exit 0). Focused Python policy/source/golden tests:
**57 passed**; focused Node feature-1/2 tests: **11 passed**, including **282 combined
seeded/edge cases** plus the retained **180 supply cases**. Seven optional golden
cases agree on Python/Desktop/CLI, with actual directory/tool/CLI process coverage.
All five guarded standalone variants rebuilt and passed regeneration tests.
Legacy golden `--write` remained unchanged; `git diff --check` passed. Feature-1
whole-output comparisons versus afea1c3, absent-data comparisons versus a0b3264,
and the original historical backtest/forecast oracles remain in place. Only the
engine/core/source hash pins were refreshed. No actual browser session, real
Desktop, ERP, hosted proof or full acceptance is claimed. The controller owns the
feature-2 commit; the native writer does not retry Git writes.

## Review repair A (F1–F4, separate from demand features)

The frozen feature-1 review remains **NO_GO** until parent delta review; F5 was
explicitly dismissed. Truncated numeric optional rows now become unknown with
scoped errors instead of raising TypeError; nonfinite converted quantities cannot
leak into bridge JSON. Any invalid legacy receipt file rejects the whole bundle,
so valid receipt rows are never silently dropped before an actionable purchase.
CLI output resolving anywhere inside the bundle (including symlink aliases) is
rejected before writing. Optional JS safety fields adopt the actual planning date
like Python; no-facts legacy snapshot behavior remains unchanged. Complete physical
parity now includes every corresponding field, including optional suggested order,
inventory position, coverage and big-order flags. Malformed errors shapes lock in
both languages; health maps preserve __proto__ SKU keys. Desktop date dependencies
and format-specific import size errors are corrected. These are narrow review repairs,
not a new demand model or an independent reviewer GO.

### Checkpoint review-repair: golden delta

Legacy:

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

Optional corpus (previous checkpoint to current):

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

Local verification: 1384 Python passed, 2383 Node passed; 0 failed. Five standalone variants regenerated; golden surfaces and diff check pass. Parent acceptance remains pending.

## Feature 3 — stockout correction (writer patch; parent commit pending)

Base `aeecfd7`; only stockout correction is implemented in this round. Projects,
outlier suggestions, manual percentages and future forecast-method selection remain
off. Optional evidence arrives through the existing explicit bundle path:
`stock.csv` remains unchanged, `sales_history.csv` supplies matching raw quantity,
calendar month, `in_stock_days` and explicit `backorder` for every month of that SKU.
Python loader/tool/CLI and `bundle_import.py` -> Desktop/standalone JSON import all
carry typed `planning_facts.sales_history` with those CONTRACT field names.
A different SKU's complete annotations cannot unlock missing facts for this SKU.

### Adoption and eligibility

The production adapter invokes **`forecast_lab.clean_demand`** and the actual
JavaScript **`clean_demand` twin**. `scripts/sync_cleaning_lab.py` embeds the exact
`forecast_lab.js` source inside the SDK-free Desktop core; a byte guard prevents
that source from becoming a detached or divergent copy. The adapter passes only
exposure and explicit backorder policy, never project/manual/link options.

For `backorder=false`, exposure is `in_stock_days / calendar days` and corrected
sales are `raw / max(0.25, exposure)` — no more than four times raw quantity.
`backorder=true` leaves the observed quantity unchanged, even with low exposure.
Missing exposure or unknown policy never defaults to lost sales. All values,
month identities, raw-quantity reconciliation, duplicate keys and complete coverage
validate before adoption. Partial/invalid supplied facts lock the capability and
HOLD purchase approval. Their physical raw basic scenario remains inspectable;
it is not labeled an adopted correction. Whole-file absence is unchanged behavior.

A **zero-exposure, zero-sales lost-sales month is censored/unobserved**. Its raw
zero and lab trace stay in the calendar ledger, but `eligible=false` excludes it
from model and variance denominators. Positive sales with zero exposure under that
policy is inconsistent and locked. Backorder-policy zeros stay observed because
that explicit policy records demand without the lost-sales uplift.

At least **three eligible observations** are needed. Fewer locks purchase guidance
(no actionable quantity/date; raw `scenario_quantity` only). With any censored
month, the adopted forecast is flat: mean of the latest three eligible corrected
observations, with their original month keys retained. It never feeds a compacted
gapped series into seasonal month indexing. With complete eligible history, the
existing calendar model uses corrected observations; no new method is selected.
The raw monthly sales, historical inventory reconstruction and historical backtests
remain immutable. They do not become a validation score for the corrected model.

### One actual model, trace and gates

The adopted model drives physical monthly projection, first runout, calendar order
horizon, committed-order baseline netting, purchase quantity, variance/safety stock,
reorder point and existing EOQ estimate. Safety remains opt-in in purchase quantity.
Calendar/raw history used for display and stock reconstruction stays separate.
Optional JS safety scenarios also carry the adopted/retained seasonal flag so a
locked correction does not silently make their raw seasonal scenario flat.

`demand_history` appears in physical/guidance output only when annotations are
explicitly supplied. It includes `state`, `needs`, original `months`, `raw`,
`corrected`, `eligible`, `eligible_months`, `censored_months`, the actual lab's
stockout `trace`/flags, and the adopted `model` when On. A censored row's lab numeric
zero is never evidence of an observed zero: eligibility is authoritative. Metadata
is recomputed from source facts; an uploaded precomputed model cannot unlock it.
This supplies exact cleaning provenance for later Why work, without inventing
per-window additive impacts or rewriting that renderer in this feature.

Health twins expose per-SKU `stockout_correction` Hidden/Locked/On gates with short
chip **Stockout adjustment**. Locked annotations use the existing Data health
surface; no new screen section or dot is added. Supply/commitment/reservation holds
remain independent and still block approval. No-stockout-data physical and guidance
JSON outputs are checked byte-for-byte against `aeecfd7`; older numeric oracles remain.
The existing safe raw-demand bounds remain; the valid corrected model's guidance
bound allows the corresponding fourfold adjusted range without changing raw inputs.

### Reviewed feature-3 optional before/after values

Five additional clearly synthetic cases extend the original seven-case optional
corpus; all original fields/assertions stay. Before values were executed and saved
while the implementation was still `aeecfd7`, including the new unrecognized facts;
after values agree across Python/Desktop/CLI. The real strict bundle loader, chat
tool and actual CLI subprocess are exercised for all twelve optional cases.
`None` means purchase approval is held, not a zero purchase. Backorder-no-uplift is
explicitly unchanged and is still pinned even though it produces no delta row.

| sku | field | before | after |
| --- | --- | --- | --- |
| LOST-SALES | order_qty | 59 | 80 |
| LOST-SALES | order_by | 2026-11-16 | 2026-11-10 |
| LOST-SALES | run_out | 2026-11-25 | 2026-11-19 |
| FLOOR-EXPOSURE | order_qty | 59 | 119 |
| FLOOR-EXPOSURE | order_by | 2026-11-16 | 2026-11-04 |
| FLOOR-EXPOSURE | run_out | 2026-11-25 | 2026-11-13 |
| FLOOR-EXPOSURE | status | running-low | order |
| CENSORED-MONTH | order_qty | 40 | 59 |
| CENSORED-MONTH | order_by | 2026-11-29 | 2026-11-16 |
| CENSORED-MONTH | run_out | 2026-12-08 | 2026-11-25 |
| THIN-ELIGIBLE | order_qty | 40 | None |
| THIN-ELIGIBLE | order_by | 2026-11-29 | None |
| THIN-ELIGIBLE | status | running-low | needs-data |

### Feature 3 legacy golden delta and local verification

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

Actual full gates: **1403 Python passed** (exit 0), **2388 Node passed, 0 failed,
0 skipped** (exit 0). The new feature suite includes **211 seeded/edge complete
optional-output comparisons**, plus nineteen Python policy/source cases. Earlier
supply/commitment parity and all historical oracles remain. Five standalone variants
rebuilt and regeneration guards passed. Twelve optional golden cases agree across
Python/Desktop/CLI, with strict loader/tool/CLI subprocess coverage; legacy values
remain unchanged. Physical/guidance JSON without stockout history is checked
byte-for-byte against aeecfd7. Actual chart sources consume the adopted projection
while their historical series continues to use raw sales. No actual browser/layout,
real Desktop, live ERP, hosted or independent acceptance proof is claimed here.
No Git write attempted; feature3 patch is held for parent commit. Features4–7 stay off.

## Feature 4 — explicit projects and outlier suggestions (parent commit pending)

Base `fa2da9e`. This round implements only complete explicit project flags and
suggestion-only outlier diagnostics. Manual demand percent, new stock accuracy,
Why UI and future forecasting methods remain off. Nothing is added to the stock.csv
month parser or the ERP allowlist. Existing `sales_history.csv.project` is typed as
a JSON boolean through the actual bundle/tool/CLI/bridge path, not inferred from
large sales or a customer label. Omitted flags are unknown, never false.

### Ordered cleaning and calendar eligibility

The actual existing lab pipeline starts from **raw** quantities, performs the
verified exposure correction, then applies `one_off=true` only for a validated
`project=true` whole-month observation. The exclusion trace records the **corrected**
quantity removed: raw 60 in 10/31 exposure becomes 186, then project exclusion
removes 186. The adapter never uplifts an already corrected quantity a second time.
Raw observations/backtests/historical inventory remain unchanged.

The lab's excluded-row output is numeric zero; that zero is **not** an observation
for adoption. Independent eligibility is `stockout_eligible AND NOT project`.
Original month labels, corrected history and `after_projects` all retain every
calendar slot. `project_flags`, `project_months`, `project_excluded_count` and the
actual lab's stockout/project traces make attribution explicit. A month that is
both censored and project is ineligible once; separate provenance lists retain both
facts. No sales/history rows or calendar indexes are compacted or shifted.

With any censored or project month, the adopted model remains the documented flat
mean of the latest three eligible observations. At least three eligible months are
required; otherwise the model is Locked, purchases have no actionable quantity/date,
and the raw basic `scenario_quantity` is provisional only. With no excluded months,
the existing calendar model is retained. A middle-history exclusion can therefore
raise a future month's demand when it triggers the flat fallback: `PROJECT-GAP`
changes November demand to 60 and purchase 66 to 119. Exclusion is not a monotonic
promise to buy less; the calendar/fallback policy is pinned in the fixture.

Project and exposure evidence have separate gates. Complete project-only annotations
can filter raw history without claiming exposure correction; stockout adjustment
stays Hidden when neither exposure nor policy was declared. Declared but missing,
partial or inconsistent exposure still HOLDs the combined pipeline. Invalid,
partial or nonboolean project flags likewise HOLD; no partial set is applied.
An all-false complete flag set is an explicit On/no-op and can enable diagnostics.
Absent project flags return the exact feature-3 history/result schema and bytes.

### Outliers are suggestions, never exclusion

After valid project adoption, at least six eligible months unlock the existing lab
outlier diagnostic. It uses eligible **raw inputs** through the same correction
logic solely for flags; it does not return adopted values to the model. Project and
censored rows are excluded from that diagnostic population. The existing lab pins
median/MAD and magnitude thresholds; this round introduces no new detection formula.
A suggestion leaves eligibility, demand, runout, safety and purchase unchanged.
Only explicit `project=true` authorizes exclusion. Outlier shortage/partial history
locks the diagnostic capability without blocking an otherwise valid three-month
planning model. No suggestion is automatically accepted or turned into a zero.

`demand_history` gains `project_state`, `stockout_state`, `stockout_eligible`,
`after_projects`, project attribution and `outlier_suggestions` only when project
facts are supplied. Suggestion metadata has `{state,needs,chip:"Check spike",months}`;
flags retain original SKU/month keys. This is core metadata for later compact UI,
not a new page section or a UI-owned calculation. Health twins expose per-SKU
**Project sales** and **Check spike** gates. Warnings use the existing health surface
and existing single per-SKU marker; no new dot or main-screen field is introduced.
The exact embedded JS lab source guard remains unchanged.

### Actual paths and compatibility proof

The strict existing contract validates complete per-SKU monthly quantity/project
facts. `sources.load_bundle` preserves omitted exposure headers for project-only
files, retains explicit blank cells as unknown, and carries scoped errors including
an explicitly empty project file. Tool `bundle_path`, CLI `--bundle` and
`bundle_import.py` -> `parseStockImport` all use those typed facts. A different SKU's
flags cannot unlock missing facts. No manual percent column/setting is enabled.

All original physical/guidance numeric fields remain compared. Absent-project
physical/guidance JSON bytes are checked against unchanged `fa2da9e` source in both
languages. Actual tool JSON DTO bytes (including valid and partial exposure-only
bundle cases) also compare to frozen fa2da9e engine/sources/tools. The old F3 future
feature guard retains its manual/unmapped-one-off assertions; explicit projects
now have their own authorized adoption/HOLD regressions.

Seven new synthetic cases extend the twelve existing optional goldens. Before
values were captured from fa2da9e before this implementation, with project flags
unadopted. After values agree across Python/Desktop/CLI, and all nineteen cases
exercise strict loader, chat handler and actual CLI subprocess. `OUTLIER-CHECK`
remains numerically unchanged and is pinned by explicit suggestion/no-auto-change
assertions. `None` in the table denotes held approval, not zero purchase.

| sku | field | before | after |
| --- | --- | --- | --- |
| PROJECT-LAST | order_qty | 239 | 59 |
| PROJECT-LAST | order_by | now | 2026-11-16 |
| PROJECT-LAST | run_out | 2026-11-07 | 2026-11-25 |
| PROJECT-LAST | status | order | running-low |
| PROJECT-CORRECTED | order_qty | 163 | 59 |
| PROJECT-CORRECTED | order_by | now | 2026-11-16 |
| PROJECT-CORRECTED | run_out | 2026-11-10 | 2026-11-25 |
| PROJECT-CORRECTED | status | order | running-low |
| PROJECT-GAP | order_qty | 66 | 119 |
| PROJECT-GAP | order_by | 2026-11-16 | 2026-11-04 |
| PROJECT-GAP | run_out | 2026-11-25 | 2026-11-13 |
| PROJECT-GAP | status | running-low | order |
| PROJECT-THIN | order_qty | 239 | None |
| PROJECT-THIN | order_by | now | None |
| PROJECT-THIN | status | order | needs-data |
| PROJECT-ONLY | order_qty | None | 59 |
| PROJECT-ONLY | order_by | None | 2026-11-16 |
| PROJECT-ONLY | run_out | 2026-11-07 | 2026-11-25 |
| PROJECT-ONLY | status | needs-data | running-low |
| CENSORED-PROJECT | order_qty | 98 | 59 |
| CENSORED-PROJECT | order_by | 2026-11-06 | 2026-11-16 |
| CENSORED-PROJECT | run_out | 2026-11-15 | 2026-11-25 |
| CENSORED-PROJECT | status | order | running-low |


### Feature4 verification checkpoint (controller commit pending)

`/usr/bin/python3 -m pytest tests -q`: **1,424 passed**, exit 0.
`node --test tests/*.test.mjs`: **2,394 passed, 0 failed**, exit 0.
The feature4 parity test compares 201 seeded/edge complete optional planning,
metadata and health outputs; the existing feature3 seeded matrix stays intact.
Focused Python: 71 passed; focused Node after the oracle clarification: 11 passed.
All five guarded standalone variants rebuilt with exit 0. Both golden write commands
passed all JS/Python/CLI equality assertions. The eleven legacy cases and the
original twelve optional rows are unchanged; seven new optional cases pin the
feature4 changes above. `git diff --check` passed. No Git writes were attempted.

Legacy before/after table from `scripts/golden_diff.py --write`:

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

One full Node run initially failed when its pre-feature3 oracle consumed the newly
expanded fixture corpus. Frozen execution confirms the new `PROJECT-GAP` history
**without sales_history**, with backup enabled, already gives suggested order 106
in fa2da9e versus 99 in aeecfd7. Feature4 preserves 106 exactly. This is a
pre-existing feature3 seasonal snapshot discrepancy, left unchanged for parent
review rather than adding another maths repair to this feature. The historical
byte oracle now uses its original twelve-case fa2da9e input file; its aeecfd7 code
and all output assertions remain intact. Added full-corpus no-history byte checks
against fa2da9e and an explicit 99/106 frozen-execution assertion retain evidence
of the discrepancy. No numerical assertions or historical code oracles were
dropped. First-failure evidence is `.scratch/phase2/f4-node-red1.log`.

This checkpoint is source/local calculation proof only. Browser captures and fresh
independent review were not run here; parent review, commit and acceptance remain
pending. Manual percentages, stock accuracy and the Why UI are not implemented by
this step.

## Step 1 — absent-data safety regression repaired

The expanded 19-case whole-output JS oracle failed before the fix with
PROJECT-GAP suggested_order 106 versus aeecfd7 99 (backup enabled). Seasonal
snapshot guidance is now opt-in to declared cleaning history; empty planning
facts keep the original flat snapshot estimate. Python already preserved this
behavior. Both languages compare complete JSON outputs, including every safety
field, across 19 cases × two settings × facts absent/history absent. Removed the
feature-3 99/106 allowance. No optional-history adoption or raw history changed.

| sku | field | before | after |
| --- | --- | --- | --- |
| PROJECT-GAP, absent history + backup | JS suggested_order | 106 | 99 |
| legacy golden (11 cases) | all fields | unchanged | unchanged |
| optional golden (19 cases) | all fields | unchanged | unchanged |

Verified: focused Python 19 passed; Node 5 passed (includes seeded parity).
Full suites: Python 1424 passed; Node 2394 passed, zero failed/skipped. All five
standalone variants rebuilt; legacy golden --write unchanged; diff --check clean.
This is local source/runtime proof, not real Desktop/ERP/browser acceptance.

## Step 2 — per-SKU manual demand change

Optional stock.csv/JSON demand_change_pct is finite signed -90..300, blank CSV
cells omit the adjustment for that SKU. Applied once after exposure correction
and whole-month project exclusion, before forecast/safety math. Adjusted history
and manual_change trace are separate from immutable raw/corrected/project stages.
Invalid explicit values HOLD purchase approval (raw provisional scenario retained);
invalid CSV syntax/range and duplicate headers reject import. Capability manual_change
is per-SKU, On/Locked with a <=3-word chip; complete absence preserves old output.
The actual CSV, strict bundle validator and Desktop ERP-normalization paths support
the column; bundle_import bridges it without any CLI parsing/UI changes.

Red: Python 22 failed/1 passed; Node 2 failed before implementation. Green: Python
24 focused tests; Node 2 focused tests include 120 seeded full-output parity cases.
Full suites: Python 1448 passed; Node 2396 passed. All five HTML variants rebuilt.
Legacy golden (11) and existing optional golden (19) unchanged. Five new manual
goldens agree on Python/JS/CLI. Their before means the exact same inputs with the
optional percentage omitted; no reconstructed/synthetic historical execution claim.

| sku | field | before | after |
| --- | --- | --- | --- |
| MANUAL-UP | order_qty | 59 | 89 |
| MANUAL-UP | order_by | 2026-11-16 | 2026-11-08 |
| MANUAL-UP | run_out | 2026-11-25 | 2026-11-17 |
| MANUAL-UP | status | running-low | order |
| MANUAL-DOWN | order_qty | 59 | 31 |
| MANUAL-DOWN | order_by | 2026-11-16 | 2026-12-12 |
| MANUAL-DOWN | run_out | 2026-11-25 | 2026-12-21 |
| MANUAL-DOWN | status | running-low | healthy |
| MANUAL-LOW | order_qty | 59 | 6 |
| MANUAL-LOW | order_by | 2026-11-16 | 2027-07-02 |
| MANUAL-LOW | run_out | 2026-11-25 | 2027-07-11 |
| MANUAL-LOW | status | running-low | healthy |
| MANUAL-HIGH | order_qty | 59 | 239 |
| MANUAL-HIGH | order_by | 2026-11-16 | now |
| MANUAL-HIGH | run_out | 2026-11-25 | 2026-11-07 |
| MANUAL-HIGH | status | running-low | order |
| MANUAL-CLEANED | order_qty | 59 | 89 |
| MANUAL-CLEANED | order_by | 2026-11-16 | 2026-11-08 |
| MANUAL-CLEANED | run_out | 2026-11-25 | 2026-11-17 |
| MANUAL-CLEANED | status | running-low | order |

## Step 3 — stock accuracy warnings

Health twins add warning codes negative_stock (Negative stock), excess_stock
(Check stock level), stale_stock_count (Old stock count). Excess means strictly
greater than 24 times the average full-month raw sales; a zero/unknown baseline
does not invent a ratio. Count age means strictly older than 180 days using explicit
today, falling back deterministically to snapshot. Unknown/invalid/future explicit
count dates warn invalid_count_date (Check count date); absence does not assert a
count. Stock accuracy is opt-in per item: only an own `last_count_date` key enables
negative_stock / excess_stock, even if that key's value is invalid. Without it,
health retains the complete pre-optional-data output (3dde510): negative stock
keeps negative_value only, and excess on_hand keeps unit_sanity. With accuracy
enabled, unit_sanity still checks suggested/guidance quantities but no longer
duplicates the stock-level warning. All labels are at most three words. These
warnings do not change forecast/purchase numbers.

Optional last_count_date now crosses canonical/ERP-normalized CSV, strict bundle
validation, JSON bridge and health intact; blanks omit per SKU, malformed CSV dates
or duplicate headers reject import. No live ERP fields, main-screen columns or
extra status dots added.

Red: four focused tests failed before implementation. Green: 31 Python focused
tests, including 323-case seeded health parity with count dates, and three Node
focused tests. Full suites: Python 1451 passed; Node 2397 passed, zero failed/skipped.
Five standalone variants rebuilt; legacy golden --write unchanged; diff check clean.

| sku | field | before | after |
| --- | --- | --- | --- |
| legacy / optional / manual golden | order_qty, order_by, run_out, status | unchanged | unchanged |

## Step 4 — pure core quantity Why ledger (not wired to UI)

New APIs: engine.why_breakdown(item, today, settings=None, as_of=None) and
Desktop whyBreakdown(item, today, settings={}, asOf=item.as_of), taking the same
calculated/source-merged item as order_guidance/orderGuidance. Both return an
ordered array of {key, qty} with signed numeric quantities. The actual planner
produces the final quantity and fixed cover endpoint; raw forecast demand then
stockout_correction, projects_excluded and manual_change deltas are integrated
at that SAME endpoint. committed_orders applies the dated included/incremental
ledger once. Stock, confirmed incoming, undated incoming, optional safety stock,
zero floor, minimum order and pack rounding explain the rest. These are quantity
contributions, not full independent counterfactual plans with moving deadlines.

Exact decimal rational arithmetic computes components and rounding. Numeric
clients can reduce qty left-to-right with strict equality to guidance.quantity.
Any binary64 residue is an explicit arithmetic_reconciliation entry, never
hidden in demand/stock. JS reduces rationals before conversion, matching Python
Fraction (otherwise denominator size caused a one-ULP parity failure).

HOLD is not a zero order: when final quantity is null/missing, the function
returns a single {key, qty:null} marker: late_po_hold, demand_history_hold,
committed_orders_hold or data_hold. Do not sum or render a numeric purchase
for that marker. No scenario quantity is promoted to an actionable order.

Red: six Python tests failed on missing API; Node missing-export failure. Green:
six Python oracle tests and 425 full JS/Python Why parity cases (400 seeded,
19 optional goldens, five manual goldens, one explicit late-PO hold), including
mutation guards and strict exact numeric totals. Full suites: Python 1457 passed;
Node 2398 passed, zero failed/skipped. All five variants regenerated.

| sku | field | before | after |
| --- | --- | --- | --- |
| all golden corpora | order_qty, order_by, run_out, status | unchanged | unchanged |

No changes to Why UI, string/control assets or CLI parsing. UI integration and
independent parent acceptance remain outside this core patch.

### Follow-up — explicit 0% is exact identity

Final edge review found multiply-by-100/divide-by-100 could move an arbitrary
fractional observation by one ULP even at 0%. Added a failing example in both
languages (88.84031387546717 became 88.84031387546719), then made 0% copy the
post-cleaning observations exactly. No multiplier is run for identity.

Red: one Python and one Node regression failed; green: both passed. Final full
suites: Python 1458 passed; Node 2399 passed, zero failed/skipped. Five standalone
variants rebuilt; all three golden --write corpora unchanged; diff check clean.

| sku | field | before | after |
| --- | --- | --- | --- |
| fractional 0% oracle | adjusted observation | 88.84031387546719 | 88.84031387546717 |
| legacy / optional / manual golden | all fields | unchanged | unchanged |
