# Order building — phases 4, 5 and 6

Status: proposed specification, not an implemented engine or a migration of today's numbers.
Scope: offline exported data only; no ERP writes, automatic purchase orders, live Odoo,
accounts, hosting, role enforcement or deployment. The approved roadmap governs sequencing.
Phase 4 is item links; phase 5 is constrained order building; phase 6 is file review, Arabic
and rule diagnostics. The landscape's earlier “not for us” list is superseded by that roadmap
for item links and warehouse planning, not by permission to build a cloud product.

## 1. Contract, authority and units

Read `CONTRACT.md` in this directory for accepted input syntax and validation. This document
specifies future calculations; accepting a CSV does not activate those calculations in the
current product. `../terminology.md` remains the existing English terminology reference;
`AR-GLOSSARY.md` is a draft translation, not approved production Arabic.

Bundle inputs used here:

| Input | Use |
| --- | --- |
| `manifest.json` | Contract version, common snapshot date, currency, synthetic flag |
| `stock.csv` | SKU, name, base unit, gross on-hand, supplier days, undated on-order, monthly sales |
| `product_master.csv` | Supplier, unit, pack size, MOQ, maximum order quantity, unit cost, CBM, weight, ABC override, critical flag, lifecycle, replacement SKU |
| `warehouses.csv`, `warehouse_stock.csv`, `transfers.csv` | Locations, gross quantities, directed transfer routes and lead days |
| `stock_states.csv` | Disjoint damaged, reserved, quarantine and returns counts inside gross on-hand |
| `sales_history.csv` | Month, quantity, in-stock days, backorder and project flags, keyed by SKU and month |
| `receipts.csv` | Receipt/PO identity, SKU, warehouse, order/promised/received dates, quantity and supplier |
| `incoming_pos.csv` | Unique PO line, remaining quantity, destination, supplier, due date and status |
| `customer_orders.csv` | Unique order line, quantity, destination, delivery date, status and forecast-included flag |
| `relationships.csv`, `unit_conversions.csv` | Directed item ratios; explicit base/purchase/sales unit conversion |
| `reorder_rules.csv` | Rule identity, SKU, warehouse, min, max, multiple, route, trigger and lead days |

Every quantity is in that SKU's base unit unless a conversion is explicitly recorded. A ratio
is target base units per source base unit; it is not a same-unit assertion. CBM, kilograms and
unit cost are per base unit. Never sum bags and boxes as a quantity. Totals may sum CBM,
weight and same-currency value. A missing measurement is unknown, never zero.
`box -> m2 = 1.44` means 10 boxes = 14.4 m²; buying 14.4 m² converts to 10 boxes
before pack rounding. Do not treat 1 box as 1 m². No inferred batch/shade compatibility.

### Policy inputs not supplied by the CSV contract

The following are explicit offline scenario settings, saved with the proposal, **not new
required CSV columns or facts that can be inferred from the synthetic data**:

- Warehouse forecast shares by SKU, summing exactly to 1; or separately supplied, validated
  warehouse demand. SKU-only history cannot identify warehouse demand. No shares means
  site quantities, transfers and allocation are Locked; global planning can remain On.
- Link effective dates, analog selection/scale, successor conversion, substitute eligibility,
  pair priority and accepted source-order lines; companion coverage mode and bucket scope.
- Mapping of reserved quantities to confirmed customer-order line IDs. For a SKU/site with
  both reservations and commitments, missing mapping locks net quantity approval for that
  SKU/site; do not silently subtract both. All other reserved stock stays unavailable.
- Lead-time choice, review days, safety-stock method/buffer, demand overrides, and the
  protection/cover horizon already selected in phases 1–3. Service policy is a proposal.
  Receipt-completeness evidence per PO is required to estimate completed-PO lead spread;
  dated receipt lines alone cannot establish that a PO is complete.
- Supplier/shipment currency, destination, departure/arrival dates, supplier minimum value
  or quantity in a named common unit, volume/weight/value ceilings, cash budget, incremental
  warehouse free space, maximum forward cover and top-up window. These limits are not in
  `product_master.csv`; obtain or confirm them before enabling a constrained shipment.
- Allocation criticality override, customer priority (if any), user decisions, planning date,
  proposal validity deadline and signing-key reference. No customer priority is inferred.

Persist each setting with source, value and reason. Unknown authoritative input locks only
its dependent calculation. A user may explicitly mark a limit not applicable with a reason;
absence is not unlimited. Do not request these on the main screen.

## 2. Progressive disclosure and capability gates

The main screen remains product, one colour status, order quantity, order-by date and chart.
The “Why this number” drawer contains the trace and capability chips. Advanced inputs live
under “All settings”. No more than one new-feature dot per release. Do not show every chip
on every row: show relevant On chips and at most the first blocking Locked chip in the drawer.
All other gates remain inspectable in “Data health”. States are per feature and per affected
SKU/site, not a bundle-wide claim. On means the inputs passed, not a guaranteed outcome.

All chip copy below is one to three English words. Hidden renders no chip. Locked retains
an explanation and data source but applies no adjustment. On with zero effect still shows
zero in its trace; it must not invent a purchase. A conflict after valid inputs changes the
feature to Locked and preserves upstream numbers as a non-approvable diagnostic only.

| Feature | Hidden when | Locked chip; condition | On chip; condition |
| --- | --- | --- | --- |
| Supersession | No successor or discontinued SKU | Needs replacement; missing factor/date, invalid chain | Replacement history; acyclic, dated, convertible chain |
| New-product analog | No new SKU or selected analog | Needs similar item; unconfirmed scale/history | Similar item; selected comparable item and scale |
| Substitutes | No substitute links | Check substitutes; compatibility or allocation unresolved | Substitute plan; accepted, conserved assignment |
| Complements/kits | No companion links | Needs coverage; missing mode/ratio, cycles | Linked demand; explicit coverage and valid ratios |
| ABC | No costs and no ABC override | Needs costs; incomplete annual cost basis | ABC priority; full basis or explicit override |
| XYZ | No sales history | Needs history; fewer than 12 eligible months | XYZ pattern; 12 complete eligible months |
| Service presets | No ABC or explicit service policy | Check service; unknown class/criticality | Service target; known policy and critical override |
| Supplier grouping | No supplier labels | Needs supplier; unknown supplier on selected line | Supplier order; group identity complete |
| Shipment caps | No shipment selected | Needs limits; unknown active resource or breached cap | Shipment fit; all active caps verified |
| Shipment suggestions | No supplier order open | Needs headroom; missing cover/limits | Add to shipment; feasible positive top-up |
| Warehouse transfers | No warehouse detail | Needs site demand; missing shares/routes/reservation mapping | Transfer first; feasible directed timed move |
| Shortage allocation | No competing shortage | Check allocation; unknown dates/priorities | Shortage plan; deterministic conserved assignments |
| Quantity modifiers | No positive purchase need | Check order limits; MOQ/max/pack infeasible | Order limits; feasible positive order |
| Offline proposal | No plan selected | Resolve issues; blockers or missing signing key | Signed proposal; frozen plan and valid MAC |
| Offline approval | No proposal imported | Verify proposal; invalid/stale/unknown-key/mismatched plan | Verified approval; valid binding and freshness |
| Arabic/RTL | English selected | Arabic draft; language review pending | Arabic ready; human-reviewed strings and RTL checks |
| Reorder-rule check | No rule export and no explicit check requested | Needs rule data; incomplete semantics or export | Rule check; comparable rules and diagnostics |

No file alone switches Arabic to Arabic ready. The present glossary remains Arabic draft.
Missing a rule for a plannable SKU is a diagnostic when rule checking is On, not grounds to
hide that SKU. “Basic” identifies a simple fallback, not confidence or a service guarantee.

## 3. One ordered ledger (phases 1–6 invariant)

Use exact decimal quantities (for example standard-library `Decimal`); reject nonfinite or
out-of-contract bounds. Do not round intermediate forecasts, ratios, buffers or conversions.
Round a final purchase only; transfer/allocation cannot round a shortage upward into supply.
Daily planning dates are local business dates without invented times of day. Receipts become
available at the start of their stated due date; daily demand is consumed afterward. A
snapshot is close-of-day; planning starts on its next day. Retain date semantics in exports.
If planning is later than that next day, roll forward every intervening dated event exactly
once before planning; require a reconciliation or a fresh snapshot when actual intervening
movements are unknown. Do not relabel an old opening balance as today's physical stock.

```text
build(bundle, explicit_policy):
  validate bundle version, identifiers, dates, units, numeric bounds, FK/graph constraints
  bind snapshot, planning date, currency, input hashes and explicit policy
  eligible_history = correct_stockouts_then_exclude_project_months(history)
  # Correct only when backorder=false and in_stock_days is credible and >0.
  # Project=true excludes the entire month; excluded is not an observed zero.
  # Never combine sales_history quantity with the same stock.csv monthly quantity.
  attributed_history = phase4_history(eligible_history, lifecycle_policy)
  baseline = displayed_model_or_simple_fallback(attributed_history)
  # seasonality needs >=24 months; intermittent means >50% eligible zero months;
  # a complex method must beat the same rolling held-out simple baseline or fall back.
  baseline = apply_manual_demand_change_once(baseline)
  site_baseline = split_using_explicit_site_shares(baseline)  # never infer from stock
  customer_demand = net_commitments(site_baseline, confirmed_customer_orders)
  customer_demand = apply_companion_graph_once(customer_demand)  # phase 4
  # Keep FULL customer demand for ratios. Reservations affect inventory draws only.
  inventory_draw = customer_demand - mapped_reservation_relief_at_exact_order_events
  priority = abc_xyz_and_service(attributed_history, costs, overrides, active_scope)
  buffers = phase3_buffers_for_displayed_model(priority.service, lead, review)
  usable = gross - damaged - quarantine - returns - reserved
  timeline = usable + confirmed_dated_supply - inventory_draw
  allocation = protect_due_commitments_then_local_buffer(timeline)
  moves = plan_timed_transfers_of_unallocated_surplus(allocation)
  swaps = plan_accepted_substitutions_of_remaining_shortages(moves)
  residual_need = recompute_time_phased_purchase_need(swaps, buffers)
  orders = apply_moq_max_pack(residual_need)
  groups = group_and_fit_orders(orders, supplier_policy, cash, space)
  suggestions = enumerate_feasible_topups(groups)  # separate, opt-in; no silent additions
  trace = source -> history -> net demand -> links -> buffer -> transfers -> swaps
          -> unrounded need -> MOQ -> max -> pack -> caps -> unresolved shortage
  require all ledger invariants; emit read-only proposal or blocked diagnostic
```

Lead-time spread needs at least five independent completed PO observations, not five split
receipts on one PO. Aggregate each PO/SKU/site to its final receipt date after checking full
receipt status in explicit source metadata; absent completeness data locks the spread model.
Do not infer a complete PO from one positive receipt. The typed lead remains the Basic
fallback. Do not count the same lead uncertainty in both safety quantity and date buffer.

### Demand and supply netting

For each SKU/site/calendar-month bucket, split baseline B evenly by actual calendar days
unless a verified finer-grained forecast exists. Let C be the full quantities of confirmed,
undelivered orders whose `forecast_included=true`; A denotes the other confirmed orders.
The monthly demand before reservation relief is `max(B, sum(C)) + sum(A)`:
put C and A on their delivery dates, and distribute `max(0, B-sum(C))` over that bucket's
days in proportion to the daily baseline (uniform if it is zero). Future dated commitments
are not spread backwards. Subtract mapped reserved quantities only at their associated
commitment events; use the full order quantity when consuming B. Unmapped reserved stock
remains excluded from usable. Missing or inconsistent mapping blocks final approval.
Overdue undelivered commitments are due on planning day with an overdue flag, not dropped.

Only confirmed incoming remaining quantities with due dates on/after planning day enter the
supply timeline. Draft/cancelled lines do not. Confirmed overdue incoming is an unresolved
supply claim: show its remaining balance, do not invent a new date. Publish provisional
shortage with and without it; lock purchase approval on affected lines until a revised date
or cancellation is explicitly confirmed. Never add `stock.csv.on_order` to those same PO
lines: detailed dated incoming replaces, not augments, the aggregate. Reconcile differences.

Conservation checks per SKU/site/date: usable never includes a disallowed stock state;
each supply unit is allocated at most once; transfers debit origin on departure and credit
destination on arrival; accepted substitutes debit their actual SKU only; all unfunded or
late demand remains visible. The physical chart keeps original SKU demand and proposed
moves separate from actual receipts. An offline proposal does not change physical stock.

## 4. Phase 4 — item links

### 4.1 Successor and discontinued history

Do not rewrite source history. `replaced_by` defines a forward lifecycle edge; refuse self
links, cycles and multiple active successors in a scenario. Trace old IDs through an
acyclic chain to one final successor. Each edge requires an explicit effective month and
positive conversion factor in successor base units per predecessor base unit; multiply
factors along a chain, and reject inconsistent unit paths. No implicit 1:1 conversion.

```text
for original observation (sku, month, qty):
  dest = final_successor(sku) if policy enables carryover for that month else sku
  assign original observation once to dest at qty * chain_factor
for (dest, month):
  attributable_qty = sum(distinct assigned original observations)
  # Same-month own and predecessor sales are distinct observed deliveries, not two models.
  # If exports overlap/duplicate deliveries, require deduplication evidence; otherwise lock.
fit one model per dest on attributable history
set predecessor purchase need = 0 when lifecycle=discontinued
keep predecessor physical stock separate; consuming it requires an accepted swap
```

Missing launch/effective dates lock carryover, not the current-item Basic forecast.
Do not sum predecessor forecast plus successor forecast. An effective month means transfer
history attribution for the explicitly selected historical window, not move physical stock.

### 4.2 New items from a similar item

Do not interpret prelaunch zeros as real zero-demand months. Require a launch month, analog
ID, conversion and confirmed scale `s > 0`. The analog must have at least 12 eligible months,
compatible use, and no dependency cycle back to the new item. Borrow the analog's Basic
monthly rate unless seasonality separately passes the 24-month/backtest gate. Scale is a
business assumption, not learned from four sales observations.

```text
m = number of complete eligible months since launch (exclude project months)
new_rate = mean(own eligible postlaunch months) if m>0 else 0
analog_rate = selected_analog_rate * conversion * s
w = min(m/8, 1)                  # proposed transparent eight-month ramp
rate = w*new_rate + (1-w)*analog_rate
when m>=8: stop analog blending; retain normal method/backtest eligibility rules
```

The ramp is a proposed product policy. Keep uncertainty Basic until it can be backtested;
never label this borrowed rate as calibrated accuracy. No selected analog means use available
postlaunch history with Basic or hold if insufficient, not an automatically chosen neighbor.

### 4.3 Substitutes: fulfillment, not extra market demand

Expand `direction=both` into forward ratio r and reverse ratio 1/r; reject parallel
conflicting paths. Eligibility must be explicitly approved (size/shade/grade/customer terms).
Never infer acceptance from graph connectivity or substitute a complement. Plan only direct
approved edges in stable priority, then source SKU, target SKU order; no multi-hop swaps.

For shortage q in source base units, target surplus S and ratio r, transferable source
coverage is `x=min(q, S/r)`. If target issue units are indivisible, floor `x*r` to the
confirmed issue quantum and recompute x; issue quantum is not necessarily purchase pack.
Record source demand covered x, target stock consumed x*r and unmet q-x. Never allocate
S again. Demand moved into the target procurement ledger is tagged transferred, offset by
-x at source, and never fed back through the link graph in the same run. Prefer available
stock; proposed purchases to enable swaps require a separate explicit scenario.
Conservation is in source-equivalent units `x=(x*r)/r`, **not** a raw sum across unlike units.

### 4.4 Complements and kits: ratios with explicit coverage

Treat complement/kit edges as demand associations, not manufacturing BOMs. Expand bidirectional
edges before graph validation; a bidirectional companion cycle is Locked. Require a DAG,
positive ratios and explicit coverage mode for each target bucket:

- `embedded`: the target's own forecast already covers linked sales; bucket target demand
  is `max(independent_target, sum(linked_requirements))`.
- `incremental`: the independent forecast explicitly excludes these linked sales; bucket
  demand is `independent_target + sum(linked_requirements)`.

Coverage mode is not encoded in `relationships.csv`; it must be confirmed in scenario policy.
Do not infer it from correlation. Process a topological order, preserve lineage and sum each
accepted edge exactly once. Source demand is final customer demand after commitment netting,
not purchase quantity, safety stock, pack rounding or a second substitute forecast. A demand
unit with an existing companion lineage cannot trigger that same edge again after a swap.
For a kit, reserve all components for a source unit together; feasible source fulfillment is
limited by `min(component_available / ratio)` plus source availability. A complement alone
does not block sale of the source; a kit does. Surface any component shortfall separately.

### Worked phase-4 scenarios (explicit assumptions)

The examples use frozen synthetic inputs from the task packet: contract version 1.0,
snapshot **2026-10-31**, planning date **2026-11-01**, currency **KWD**, `synthetic=true`,
and 12 months **2025-11 through 2026-10**. They are specification scenarios, not asserted
engine output. The generated bundle's facts and worked arithmetic are checked by
`tests/test_data_contract_docs.py` using the Python standard library. Receipt rows explicitly
assert `po_complete=true`; that assertion is synthetic, not live PO-status evidence. Extra target/protection, launch, compatibility and resource assumptions
are explicitly introduced in each scenario; scenarios are isolated, not cumulative.

| Frozen input | Monthly quantities | Gross on-hand | Unit cost | Base unit |
| --- | --- | --- | --- | --- |
| TILE-SAND | 120 in each of 12 months | 120 | 10 KWD | box |
| TILE-OLD | 24 in each of 12 months | 24 | 8 KWD | box |
| TILE-GREY | 60 in each of 12 months | 96 | 12 KWD | box |
| ADH-20 | 60 in each of 12 months | 80 | 3 KWD | bag |
| GROUT-5 | 30 in each of 12 months | 40 | 2 KWD | bag |
| EDGE-NEW | eight zeros, then 4,8,12,16 | 12 | 4 KWD | piece |

1. **Carryover:** assume TILE-OLD -> TILE-SAND is enabled with factor 1, effective November
   2026 and a 12-month lookback. OLD sold 24/month and SAND 120/month. Attributed SAND history
   is 144/month, not 120 plus a separate 144 forecast. OLD's 24 physical boxes do not appear
   in SAND stock; OLD cannot receive new purchases. Example excludes all other links.
2. **Analog:** assume EDGE-NEW launch July 2026, analog TILE-GREY, cross-unit conversion
   1 piece per analog box for modeling only and scale 0.2. Four postlaunch months 4,8,12,16
   average 10; analog 60/month gives 12; w=4/8 gives `0.5*10 + 0.5*12 = 11` pieces/month.
   This is a scenario assumption across unlike products, not a claim they are good analogs.
3. **Substitute:** assume 24 SAND boxes unmet and 36 GREY boxes of verified surplus after
   GREY's own protection; ratio 1. Consume 24 GREY, cover 24 SAND, leave 12 GREY surplus and
   zero SAND shortage. Conserved source-equivalent demand is 24, not 48.
4. **Companions:** assume source customer demand SAND=120, target ADH baseline=60 and
   GROUT baseline=30 for the same bucket. Ratios .25 and .125 require 30 ADH and 15 GROUT.
   Embedded mode leaves targets at 60 and 30; incremental mode yields 90 and 45. For an
   isolated kit example with 10 available GROUT bags, `10/.125 = 80` SAND boxes can be
   fulfilled even if 120 SAND boxes exist. Never compute companions from a 132-box order.

## 5. Phase 5 — real orders

### 5.1 ABC, XYZ and service policy

ABC ranks annual consumption **at cost**, not revenue or profit. Use the last 12 consecutive
complete months of eligible corrected demand times same-currency unit cost. Ineligible or
missing months do not become zeros: automatic ABC is Locked if the comparison population
has incomplete costs/history. Overrides can classify individual SKUs but do not repair
missing cost totals. For lifecycle-attributed history, count original demand once in the
active comparison population; show a bridge to the raw, unattributed cost basis.

```text
sort positive annual usage values descending, break ties by SKU
cumulative_before = 0
for item:
  A if cumulative_before < .80*total else B if cumulative_before < .95*total else C
  cumulative_before += item.value
zero-value items are C when total>0; if total=0 automatic ABC is Locked
effective_ABC = valid abc_override else calculated_ABC
```

The threshold-crossing item stays in the earlier class. XYZ is independent: use population
standard deviation divided by mean across 12 eligible monthly quantities; X if CV<=0.5,
Y if 0.5<CV<=1, Z if CV>1 **or** >50% zero months. All-zero complete history is Z with
No sales, not predictable X. Missing/prelaunch months lock XYZ instead of classifying them Z.
Thresholds are proposed defaults, not a statistical guarantee.

Proposed cycle-service targets below are assumptions for **chance of no stock-out over the
protection horizon**, not vendor fill-rate targets or confidence intervals. Critical=true
sets a minimum target .99, even for C/Z or a Lean scenario. An explicit higher target stays
higher; a lower override cannot silently defeat criticality. Unknown criticality locks presets.

| ABC | X | Y | Z |
| --- | --- | --- | --- |
| A | .95 | .99 | .99 |
| B | .95 | .95 | .99 |
| C | .90 | .90 | .95 |

An explicit per-item service override replaces the matrix target for noncritical items;
effective target for a critical item is `max(.99, explicit_override_or_matrix_target)`.
Missing ABC without an explicit service override locks the preset; an explicit service
override can stand alone but still requires known criticality. Record the chosen source.
If XYZ is unavailable, use A=.99, B=.95, C=.95 as a visible Basic fallback. Need no forecasts
merely to show an ABC class. A chosen service target does not establish calibrated service;
phase-3 out-of-sample errors or a labeled Basic buffer are still required. Lean, Recommended
and Stock-up change cover/buffer scenarios explicitly, never reinterpret a band as a policy.

**Raw classification audit scenario:** with all 12 sample months deliberately treated as
eligible, no lifecycle carryover and no stockout/project correction, annual values are:

| SKU | Annual demand | Value KWD | Cumulative % | ABC |
| --- | --- | --- | --- | --- |
| TILE-SAND | 1440 | 14400 | 50.732807 | A |
| TILE-GREY | 720 | 8640 | 81.172492 | A |
| TILE-OLD | 288 | 2304 | 89.289741 | B |
| ADH-20 | 720 | 2160 | 96.899662 | B |
| GROUT-5 | 360 | 720 | 99.436302 | C |
| EDGE-NEW | 40 | 160 | 100 | C |

Total = 28384 KWD. Constant positive histories are X; raw EDGE CV=1.61245155 with 8/12 zeros
would be Z **only under this raw-history assumption**. With the confirmed July launch in the
analog scenario XYZ is Locked. GROUT is C/X but critical: .99 overrides the C/X .90 target.
These are not classifications computed from a possibly corrected `sales_history.csv`.

### 5.2 Transfers before purchases; allocation when short

Allocate available supply to dated demand before creating any purchase, transfer or substitute
suggestion. No allocation represents a stock write. Use one shared dated ledger per scenario.
Priority is (1) earliest due confirmed commitments, then critical, explicit customer priority,
ABC A/B/C and stable order-line ID; (2) remaining baseline by date, critical, ABC and SKU/site;
(3) safety-stock replenishment. Missing customer priority gives equal priority, not a guess.
Critical is a tie-break within a due date, not permission to steal already reserved units.

```text
reserve mapped customer stock for its exact order line; never allocate it to others
allocate unreserved usable and timely confirmed receipts by the priority above
for each unfilled demand event in priority order:
  donors = same-SKU sites with directed route arriving by event.date
  sort donors by earliest arrival, then shortest lead, then site ID
  for donor in donors:
    surplus = largest removable quantity such that donor's dated commitments,
              baseline and safety floor remain met at EVERY future date in horizon
    x = min(surplus, remaining_shortage)
    debit donor on proposed departure; credit receiver on proposed arrival
    reserve x for this event; do not cascade/re-export this newly received transfer
  record remaining shortage; propose substitutes next, purchases last
```

Donor protection covers the full modeled horizon, not just today's balance. Lead zero is
same-day; missing reverse route is not permission to reverse a route. Transfer in-transit
stock is neither origin nor destination available stock until arrival. Re-evaluate shortage
before new purchases; a late transfer cannot cover an earlier gap. If cash/caps later leave
purchase short, retain the same priority to apportion accepted supply and expose all residual
unmet demand. Splitting indivisible units uses floor and stable-priority remainder distribution,
never duplicate units. Unmet is not removed from forecast or called fulfilled.

**Transfer scenario:** SAND gross MAIN/EAST/WEST = 24/84/12. MAIN damaged=6 and reserved=6:
usable MAIN=12, total usable=108. Assume EAST must retain 48 over the whole horizon, WEST
has no surplus, MAIN's pre-receipt target is 72, and a day-2 transfer arrives before need.
EAST surplus=36; transfer 36 -> MAIN available=48, residual target shortage=24 before later
receipts. On 2026-11-25 a confirmed MAIN PO of 48 can cover a later shortage, not a day-2 gap.
The assumed 72 target is **not** derivable from warehouse stock alone. Reserved mapping is
required before combining this scenario with customer orders. Total physical units remain
120; total usable across sites remains 108 after arrival, not 144.

**Allocation scenario:** assume 48 usable SAND boxes after transfer and two same-day,
unreserved confirmed commitments of 36 and 24; first line wins the deterministic tie-break.
Allocate 36 and 12, leave 12 unmet. This is an isolated scenario, not the sample's two
orders (which have different dates/sites). Procurement quantity may be zero while a timed
shortage persists; show the gap instead of labeling the plan healthy.

### 5.3 Positive need -> MOQ -> maximum -> pack, without violating a maximum

Let a be the proposed purchase arrival date and h the explicit purchase-cover end date.
For each date t, let P(t) be the projected unreserved balance before this new purchase,
after confirmed incoming, inventory draws, transfers and accepted swaps; let F(t) be the
chosen safety floor. Then `unrounded_need = max(0, max(F(t)-P(t) for a<=t<=h))`.
Include both start-of-day and post-demand events in the max; a receipt can cover that day's
demand but not the preceding day's deficit. If h<a the scenario is invalid. Deficits before
a remain separate attention rows: even a larger purchase at a cannot retroactively fix them.
A cover-end total alone is insufficient. Existing phases 1–3 determine the displayed order
date/arrival/horizon; do not substitute a new date formula or a different cover rule here.

```text
if unrounded_need <= 0: q=0                     # do not apply MOQ to zero
else:
  m = max(unrounded_need, moq)
  capped = min(m, max_order_qty) if maximum specified else m
  q = ceil(capped/pack_size)*pack_size
  if q exceeds maximum:
    q = floor(max_order_qty/pack_size)*pack_size
  if q<=0 or q<moq: LOCK conflicting limits
  else:
    residual = max(0, unrounded_need-q)
    emit q, residual, each intermediate, and any cap/pack-induced excess
```

`max_order_qty` is a hard per-SKU total in this proposal, not a loophole to split duplicate
lines. A legal capped quantity below need is a partial proposal, never complete coverage.
Packing cannot exceed max, cash or space. No automatic max increase, MOQ waiver or line
splitting; changing constraints is a new scenario with explicit reason and reapproval.
EOQ is an optional candidate comparison, not a minimum, and must pass the same constraints.

**Examples:** SAND pack=12, MOQ=24, max=120. Need 13 -> MOQ 24 -> max 24 -> pack 24.
Need 119 -> 120. Need 121 -> capped 120 -> 120 and unmet 1. With scenario max=25,
need 25 -> initial packed 36 -> legal packed 24, unmet 1. With MOQ=25, pack=12 and max=30,
no positive feasible quantity exists: 24 violates MOQ and 36 violates max; Check order limits.

### 5.4 Supplier grouping, container/cash/space caps and top-ups

Group by exact `(supplier, currency, destination, departure_window)`; no fuzzy supplier merge
and no cross-supplier container by default. Multiple destinations require a separately declared
consolidation scenario. Cost is unit cost only unless an explicit validated landed-cost policy
is supplied; do not claim freight/duty are included. Current stock value is not cash budget.

```text
for each group:
  active_limits = shipment CBM, weight, value, cash, incremental destination free space
  headroom(resource) = declared_limit - already_committed_to_this_proposal(resource)
  # cash/space budgets may be shared by groups: debit a GLOBAL ledger, never once per group
  select legal SKU pack blocks by shortage priority, not maximum container fill
  first block for a SKU must meet MOQ; subsequent blocks are one purchase pack
  accept only if all active resource ledgers stay >=0 and per-SKU max is respected
  preserve unfilled urgent demand; if first MOQ block does not fit, skip and explain
  check supplier minimum value/common-unit quantity; short group stays Locked
  # Never silently manufacture demand to satisfy supplier minimum.
```

This is a deterministic heuristic, not optimal bin packing or an economic optimum. Group
processing order is earliest uncovered need, critical, ABC, then group key; document any
unserved higher-cost MOQ block. Free-space check conservatively assumes all proposed inbound
coexists: subtract confirmed inbound and proposed transfer inflows from declared incremental
space; no credit for speculative sales or transfer departures. Weight and volume are separate
caps. Value and cash are separate if a landed-cost model makes them differ.

“Add to shipment” suggestions require an already open group, reliable costs/CBM/weight for
all candidate packs and all active caps. Candidates must be active SKUs of that supplier/site,
positive expected demand, and order-by date within the confirmed top-up window. Sort by
`(earliest order-by, critical first, ABC A/B/C, SKU)` using ascending stable keys. Never use
raw shortage quantities to rank different SKUs: units and economic importance may differ.
For a not-yet-ordered candidate, its first block is
`ceil(MOQ/pack)*pack` (at least one pack), not one pack below MOQ. For an existing ordered
candidate, its next block is one pack. Enumerate legal incremental pack blocks up to
maximum forward cover/per-SKU maximum and test every cap including global cash
and space. Suggest the first feasible block, recompute headroom after each user acceptance,
and stop at no feasible block. Do not add discontinued, no-sales or unplannable stock just
to fill a container. A full container is not the objective; an accepted suggestion is a new
proposal revision and invalidates its old approval.

**Shipment scenario:** assume SYN-TILE group MAIN, urgent SAND=48 and GREY=24 boxes,
both legal. Unit cost 10/12 KWD, CBM .02 each, weight 20 kg each: base total 768 KWD,
1.44 m³ and 1440 kg. Scenario caps: value=1000 KWD, cash=1000 KWD, volume=1.8 m³,
weight=1800 kg, remaining incremental space=1.8 m³ after other inbound. Assume SAND
has eligible forward demand for one more 12-box pack and does not exceed forward cover.
Top up SAND by 12 -> 888 KWD, 1.68 m³, 1680 kg: feasible. Another 12 -> 1008 KWD,
1.92 m³, 1920 kg: rejected by cash/value, volume, weight and space. With cash=850 KWD
the first top-up also fails (888>850). No container-size or cash figure is a sample fact.

## 6. Phase 6 — file proposal/approval, Arabic and rule checks

### 6.1 Tamper-evident offline proposal/approval, NOT access control

Export a UTF-8 JSON envelope, never an executable file or a PO sent to a supplier. Canonical
payloads use a restricted schema: string-keyed objects, arrays, strings, booleans and null;
quantities/percentages are canonical decimal strings and dates ISO strings. Reject JSON
numbers in payloads, duplicate object keys, nonfinite values, unexpected keys and oversized
files before hashing. Canonical bytes are `json.dumps(payload, sort_keys=True,
separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('utf-8')`. Version the
schema; arrays have documented stable ordering (lines by type/SKU/site/line ID, input files
by normalized relative path). Decimal text has no exponent, redundant trailing zeros or
negative zero. Do not normalize identifiers. No Unicode normalization of payload strings.

This offline design can use Python standard-library SHA-256/HMAC-SHA-256. HMAC is a shared-key
message authentication code, **not a personal/public-key signature or identity proof**.
“Signed proposal” is UI shorthand explained in the drawer. A digest alone is not a signature.
No cryptography is implemented by this documentation task.

```text
proposal_payload = {
  schema_version, proposal_id, revision, previous_digest_or_null,
  snapshot_date, planning_date, expires_on, currency, synthetic,
  input_files:[{path, sha256_of_exact_file_bytes}], policy, model_version,
  demand_trace, purchase_lines, transfer_lines, substitution_lines,
  resource_totals, unresolved_gaps, blockers, proposer_label
}
proposal_digest = SHA256(canonical(proposal_payload)).hexdigest()
proposal_mac = HMAC_SHA256(local_key, ASCII_BYTES("SR-PROPOSAL-v1\n") + canonical(proposal_payload))
proposal_envelope = {payload:proposal_payload, digest:proposal_digest,
                     mac:proposal_mac_hex, key_ref:local_reference}
# key never goes in export, logs or chat; key_ref is not a password or an account.

verify_proposal(envelope, chosen_local_bundle, explicit_today):
  parse_restricted_schema; recanonicalize; recompute digest
  require known local key and constant_time_compare(recomputed_mac, supplied_mac)
  require exact chosen bundle byte hashes, policy/model version and synthetic flag match
  require planning_date <= explicit_today <= expires_on
  require snapshot not stale under saved freshness rule and no unresolved blockers
  recompute plan from bound inputs/policy; compare exact normalized lines/totals/trace
  return verified_for_file_review or Locked with exact reason

approval_payload = {schema_version, approval_id, proposal_digest, proposal_id,
                    revision, decision, approved_on, expires_on, reviewer_label,
                    accepted_gaps, approval_scope:"offline-review-only"}
# decision is exactly approve or reject; rejection never unlocks a purchase.
# expires_on cannot exceed proposal expiry; accepted_gaps references specific gap IDs.
approval_mac = HMAC_SHA256(local_key, ASCII_BYTES("SR-APPROVAL-v1\n") + canonical(approval_payload))
# Approval envelope uses the same {payload,digest,mac,key_ref} pattern.
verify_approval():
  verify its schema/digest/MAC; require decision=approve and matching proposal digest/revision
  require proposal.planning_date <= approved_on <= explicit_today <= both expiries
  require valid proposal verification
  require every blocking gap resolved; accepted nonblocking partial-service gaps explicit
  display Verified approval and scope, never an executed-order status
```

Record a local seen-approval digest list to detect repeats **within the same local installation**;
no global anti-replay, revocation or trusted clock is claimed. Unknown key, altered bytes,
stale dates, mismatched bundle or unavailable recomputation means Verify proposal, not a
verified result. All edits, including top-ups and overrides, create a new revision/digest
and require another approval. A proposal may show a partial legal quantity, but insufficient
supply needs explicit gap acceptance; unit/mapping/constraint errors cannot be waived into a
valid calculation. Snapshot freshness rule is explicit policy, not an assumed date threshold.

Anyone holding the shared key can create both MACs and change reviewer labels. Someone can
replace exports or bypass this UI entirely; local users control keys, files, clock and program.
This is tamper-evident file review only, **not access control**, identity verification,
separation of duties, a trusted audit log or manager authorization. Do not sell it as support
for 1,000 managers. Do not add ERP write permissions, key exchange or account management.

**Numeric binding example:** proposal revision 1 contains SAND=48 and GREY=24 with total
768 KWD (shipment scenario above). A valid approval binds that exact proposal digest.
Accepting SAND top-up creates revision 2, SAND=60, total 888 KWD; revision-1 approval is
invalid for revision 2 even if the filename and proposer/reviewer labels are unchanged.
Actual digest strings are generated by an implementation, never illustrated with invented
cryptographic output. Changing only one quantity without refreshing the MAC must fail.

### 6.2 Arabic and RTL acceptance

Use stable string IDs and one string table across page, drawer, CLI/chat, exports and tool
cards. `AR-GLOSSARY.md` covers the chips and conceptual terms below as draft Modern Standard
Arabic suitable for later Kuwait operator review. Keep standard English abbreviations in
help text; locale does not alter keys, units, policy values or calculation semantics.

Use logical CSS properties, RTL text/layout and isolated LTR spans for SKUs, dates, decimals,
CSV headers and units. Chart time stays LTR with Arabic labels; do not reverse numeric axes
or the underlying month order. Test keyboard navigation, screen-reader names, truncation,
mixed Arabic/English product names, Arabic file names, CSV export and 390/1440 light/dark
layouts. Chip word limits apply to English source copy, not Arabic spacing rules. Human
linguistic review plus actual RTL UI checks are required before Arabic ready; none are
claimed by this spec. Translation must not turn probability into a guarantee.

### 6.3 Read-only reorder-rule health check

Input is `reorder_rules.csv`: `rule_id,sku,warehouse,min_qty,max_qty,multiple,route,trigger,lead_days`.
Require unique IDs, known SKU/site, same base-unit interpretation, finite nonnegative min/max,
positive multiple, and valid nonnegative lead. Route/trigger strings are exporter-specific:
require explicit mapping to buy/transfer/manufacture/MTO/unknown and auto/manual/unknown.
Do not guess Odoo version, source location hierarchy, rule scope, price-break MOQ semantics,
scheduler timing or security lead time. Unknown semantics lock comparison, not source import.
User/source metadata must confirm the export is a complete rule set for the compared sites;
otherwise absence is unknown, not a missing-rule diagnosis.

```text
for each normalized rule:
  emit error for min>max, invalid/unknown units, impossible pack/MOQ/max
  detect duplicate active (sku,warehouse,route,trigger) scopes; never sum their limits
  if route not comparable buy/transfer: label outside comparison; do not recommend min/max
  compute ROP = forecast_demand_over_confirmed_rule_lead + chosen_safety_stock
  compute target = forecast_demand_over_lead_plus_review + chosen_safety_stock
  # Same phase-3 model and buffer, no second lead-time buffer or commitment subtraction.
  # Commitments affect dated feasibility; thresholds are recurring demand policy quantities.
  warn if min_qty < ROP; warn if max_qty < target; do not auto-change either
  warn if max_qty-min_qty cannot yield a legal MOQ/pack block under per-order cap
  warn if multiple is incompatible with purchase pack; find exact common decimal quantum
  compare exported lead_days with selected typed/observed lead; explain independent-PO count
  warn on discontinued purchases, superseded rules, or absent supplier/transfer route
  show auto/manual scope; 0/0/1 or MTO is deliberate special policy until confirmed otherwise
for each active plannable SKU/site in declared complete export scope:
  if no comparable rule: emit missing-rule diagnostic
```

Also show zero-demand rules holding excess, critical items with weak protection, overdue-PO
exposure and missing/stale evidence. A min/max pair is not proof the ERP uses the same lead,
forecast window, location aggregation or rounding. Rule maximum is a target stock level,
**not** `product_master.max_order_qty`, which caps this proposal's purchase. Check multiples
with exact decimal arithmetic; integer-only modulo would misdiagnose fractional packs.
Diagnostics are suggestions with source rule ID and our assumptions, never an import file,
API update or claim a live Odoo rule was tested.

**Rule scenario:** assume SAND daily demand 4 boxes, rule lead 30 days, review 30 days,
safety stock 24 boxes, sample rule `SYN-RULE-1` min=12, max=120, multiple=12, route=buy,
trigger=manual. ROP=`4*30+24=144`; target=`4*60+24=264`: min is short by 132 and max by 144. Product order
cap 120 does not make target 264 an invalid stock target, but replenishment may require
several cycles. This is an explicit 30-day-rate scenario, not the product's calendar-month
forecast; do not infer a rate of exactly 4/day from every 120-sales calendar month.

## 7. Required verification before any implementation release

Golden tests must exercise this order of operations, not just independent feature formulas:

- Original observations attributed once; successor cycles, missing factors, overlap evidence,
  no successor stock teleportation; new-item prelaunch zeros excluded and analog ramp stops.
- Embedded vs incremental companion totals; cycles Locked; reciprocal substitute ratios;
  swaps conserve source-equivalent fulfillment; each supply unit issued once; kit bottleneck.
- Confirmed orders consume baseline once; reservation mapping avoids double subtraction;
  project exclusions are not zeros; dated incoming replaces aggregate and overdue blocks approval.
- ABC boundary-crossing ties, absent costs, launch-aware XYZ, all-zero Z, C/critical override;
  cycle service is not fill rate or forecast confidence.
- Transfer donor floor at every future date, asymmetric routes, arrival after shortage, shared
  donor contention, partial allocation and no same-run transshipment or false healthy state.
- Zero need ignores MOQ; feasible max/pack reduction; impossible MOQ/pack/max locks; residual
  demand retained; fractional unit conversions; no intermediate demand rounding.
- Multiple supplier groups share cash and space; missing CBM is not zero; min supplier value,
  rejected top-ups, forward-cover ceiling, discontinued exclusion and every independent cap.
- One-byte change, quantity change, wrong key, stale snapshot, expired approval, unknown schema,
  duplicate JSON keys, wrong bundle, wrong revision, replay-local-only and rejection paths.
- Rule min/max vs per-order max distinction, fractional multiples, MTO exclusion, incomplete
  export scope and missing-rule cases; no live ERP calls or writes.
- Every English chip has a draft Arabic entry; Arabic ready remains gated on human/RTL proof.

Documentation-only verification does not prove the planning engine, HMAC verifier, UI or
real ERP behavior. No implementation, browser, translation sign-off or production approval
is part of this two-document delivery.

### Source and design boundaries

Design authority: approved Stock Runway roadmap dated 2026-11-12, phases 4–6. Research inputs:
`CONSOLIDATED-findings.md` and `lane-2-smb-erp-inventory.md` in the same dated landscape research
folder. Their vendor comparisons are reported research, not reproduced live-system evidence.
ABC/XYZ thresholds, service matrix, eight-month analog ramp, allocation priority, pack-cap
resolution and greedy shipment policy above are **proposed design choices**. A pilot distributor's ERP
version, export completeness, sea freight, supplier/container policies and unit compatibility
are unconfirmed. This spec does not silently promote those assumptions into business facts.
