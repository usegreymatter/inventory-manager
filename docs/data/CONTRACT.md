# Local CSV data contract — version 1.0

Status: **offline contract and validator**, not a change to current engine/UI math. All examples under `samples/synthetic/` are invented building-materials data, not a pilot distributor's export. Nothing here reads Odoo, writes ERP records, places orders, manages accounts, or grants access.

## Compatibility and versioning

- The required input is still today's `stock.csv`: first five canonical columns **`sku,name,unit,on_hand,supplier_days`**, then at least three consecutive full `YYYY-MM` sales columns, in chronological order. `supplier_days` has a required header but may have empty values. `category`, `on_order`, `demand_change_pct`, `last_count_date` and complete `rcv:YYYY-MM` columns remain optional. No required field or existing meaning is renamed. The existing CLI accepts this file unchanged.
- Existing ERP header aliases/defaults live in `sources.normalize_erp_rows` and the existing browser importer; they are not modified. This validator checks **canonical bundles**, not every raw ERP alias. Normalize a raw ERP export using the existing adapter before applying this strict contract. Only explicitly supported optional columns belong in canonical `stock.csv`; unknown columns are interpreted as months. `demand_change_pct` is an explicitly supported Phase-2 extension, not an ERP field inference.
- Optional facts go into separate optional files. Unknown columns in an optional file produce `unknown_column` warnings and are ignored; they do not unlock a capability. Unknown extra filenames are not read. Missing file or omitted SKU means unknown, not an observed zero. Do not provide empty files to assert completeness.
- An optional `manifest.json` pins `contract_version: "1.0"`, `snapshot_date: "2026-10-31"`, `currency: "KWD"`, `source: "SYNTHETIC ..."`, `synthetic: true`. `source` is informational provenance. The snapshot must equal the final complete sales month-end, preserving today's loader. Currency is one uppercase three-letter code for the whole bundle, not converted or inferred. `synthetic` is a JSON boolean. The validator accepts only exact version `1.0`; future versions require an explicitly updated validator. Additive optional columns preserve old importers; semantics/breaking changes require a major version and adapter.
- Without a manifest, infer the snapshot from stock history and warn `legacy_snapshot`; quantity features remain usable, currency-dependent features stay locked. A malformed/unsupported manifest locks all readiness gates rather than silently falling back. A manifest is not evidence that independently exported tables share a snapshot: the operator must export/reconcile them to the same close-of-day cutoff.
- Dates are local business dates, `YYYY-MM-DD`. A snapshot is close-of-day; plans start the following day. The validator's deterministic default `today` is snapshot + 1 day; use `--today` explicitly in real workflows. It never uses wall-clock dates implicitly. Exports >45 days old warn. No intraday precision or partial last month is invented.

## Common syntax, limits and identity

UTF-8 (optional BOM), comma separator, CSV quoting and a single unique header row. Each file is a regular local file, not a symlink, at most **2 MiB** and **10,000 data rows**. Row widths must match exactly. The validator never follows paths from the manifest or opens arbitrary named attachments. Source inputs are read-only.

Identifiers/text are case-sensitive and preserved exactly. Surrounding whitespace is an error, not silently trimmed. SKUs must reference `stock.csv`; warehouse references must match `warehouses.csv`. No guessed IDs or default unit conversions. Blank optional cells mean unknown; explicit `0` means measured none. All nonblank numeric inputs use ASCII decimal syntax (scientific notation accepted), finite, non-negative, at most **1e12**. Lead days are at most **3650**; transfer/rule `lead_days` and in-stock days are whole numbers, supplier days may be fractional as today. Pack/MOQ/max/multiple quantities have at most six effective decimal places; pack sizes, conversion factors, relationship ratios and rule multiples must be strictly positive. Conversion factors and relationship ratios must also be at least **1e-12**, bounding reciprocal arithmetic. Text is data, never HTML or formulas; downstream spreadsheet exporters must apply formula hardening without changing machine identifiers.

Base unit = the stock/inventory unit for that SKU. Every quantity, pack, MOQ and max is in that base unit; cost, CBM and weight are **per base unit**, not per pallet or purchased carton unless that is the base unit. Never sum boxes and bags into an item quantity. `factor` converts source to target unit by multiplication. Units must be converted before final purchase rounding. Dates, totals and conversion ratios must be reconciled before a buyer relies on them. A valid bundle does **not** prove source accuracy or warehouse demand, shipment limits, reservation mappings, receipt completeness beyond the explicit assertion, or supplier compatibility.

Notation below: **R** = required header/nonblank cell if that file is supplied; **O** = optional header/value. Keys must be unique, except legacy receipt rows aggregate. All optional files may contain a subset of SKUs. A SKU supplied in `sales_history.csv` needs every wide sales month; a SKU supplied in `warehouse_stock.csv` needs every declared warehouse, including explicit zeros.

## Odoo evidence boundary

Sources D1–D6 below were opened in the supplied research (Odoo **20.0 docs**), not in this implementation lane. A pilot distributor's installed version, export templates and custom modules are **unverified**. A documented screen/label does not verify a technical model field or an instance's availability. All technical field suggestions below are **ASSUMED** unless explicitly noted as documented in that research. General list CSV export behavior was also **ASSUMED**, not tested. No proposed field expands today's read-only adapter allowlist.

### `stock.csv` — existing required file, unique `sku`

| Column | Meaning / requirement | Odoo source / evidence |
|---|---|---|
| `sku` R | Stable product/variant key, not a display description | Internal Reference; `product.product.default_code` ASSUMED export mapping (used by current fake-tested adapter, not live-verified) |
| `name` R | Human-readable product name | Product name, `product.product.name` ASSUMED |
| `unit` R | Inventory/base unit for all this SKU's quantities | Product Unit of Measure, `uom_id` ASSUMED; D6 documents packaging Reference Unit |
| `on_hand` R | Gross physical stock at snapshot, including separately declared unavailable states | Inventory → Reporting → Stock **On Hand**, documented D3; technical `qty_available` ASSUMED. Do not export **Free to Use** here and subtract reservations again |
| `supplier_days` R header / O value | Quoted order-to-delivery days; blank unknown, zero valid | Vendor pricelist **Lead Time**, technical `product.supplierinfo.delay` documented D5. No distribution inferred |
| `category` O | Product grouping label, not a forecasting signal | Product category, `categ_id` ASSUMED |
| `last_count_date` O | Last physical stock count, real YYYY-MM-DD business date; blank omits it. Health warns when older than 180 days relative to explicit today (snapshot fallback), invalid or future; no forecast/order quantities changed. | Buyer-provided count date, no inferred ERP field |
| `demand_change_pct` O | Buyer-entered signed percent, **-90..300 inclusive**; blank omits this SKU adjustment, explicit 0 adopts no change. Applied once after stockout/project cleaning and before forecast and safety estimates; raw history/backtests unchanged. Nonfinite, text, out-of-range JSON values HOLD purchasing; malformed CSV rejects import. | Manual planning assumption, not an inferred Odoo fact |
| `on_order` O | Undated incoming stock. Blank unknown; zero explicitly none | Stock report **Incoming**, documented D3; technical `incoming_qty` ASSUMED. Cannot coexist with positive overlapping detailed supply |
| `YYYY-MM` R, ≥3 | Completed monthly net sales in base units, nonnegative as today's engine. Customer returns must be reconciled before aggregation; do not clamp net-negative months silently | Sales/stock-move analysis; completed delivery/return quantities and move date ASSUMED. Month boundaries/source not covered by research |
| `rcv:YYYY-MM` O | Historical completed receipt total for each sales month. Supply every month exactly once, including zeros, or omit all | Supplier→internal completed moves ASSUMED. These are historical, never future supply |

### `sales_history.csv` — optional monthly adjustment metadata, key `sku,month`

This is an annotated copy of raw monthly sales, **not extra demand**. Quantity must equal the corresponding wide `stock.csv` cell. Missing a SKU leaves that SKU's corrections locked; partial month coverage for an included SKU is an error.

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `sku` R | Product key | Internal Reference mapping ASSUMED |
| `month` R | One stock history month, `YYYY-MM` | Aggregated completed delivery date ASSUMED |
| `quantity` R | Same raw monthly quantity as stock; never add the two | Sales/stock-move export aggregation ASSUMED |
| `in_stock_days` O | Count of days physically available for sale, 0..calendar month length. Not derivable from month-end zero | Daily availability reconstruction/custom report ASSUMED; no documented direct Odoo field |
| `backorder` O | `true`: customers wait and fulfilled/backordered demand is recorded; `false`: lost sales when unavailable. Blank policy unknown | Buyer-confirmed business policy/custom flag ASSUMED, not stock status |
| `project` O | `true`: **entire month** is verified one-off/project demand, excluded from baseline, not changed into zero; `false`: ordinary month | Project/customer classification/custom flag ASSUMED. Mixed months need upstream separation or stay unadjusted |

Stock-out correction only when `backorder=false` and credible positive exposure days; no division by zero or blind correction of tiny exposure. Exposure floor/cap must be explicitly pinned by the future forecasting engine; `ORDER-BUILDING-SPEC.md` fixes the downstream ledger order. This validator only validates facts and readiness. Positive sales with zero in-stock days and `backorder=false` is inconsistent.

### `receipts.csv` — optional completed receipts, unique `receipt_id`

Not the existing CLI's future-month receipts file. Each row is one distinct completed partial receipt. Group PO/SKU/site to final received date **only if completeness is explicitly asserted**; five rows from one PO are not five observations. All received dates must be on/before snapshot and on/after PO confirmation.

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `receipt_id` R | Stable receipt-line event identifier; no duplicate event | Completed receipt move/line ID ASSUMED |
| `po_id` R | Purchasing-document key used to deduplicate partial receipts | Purchase order reference `purchase.order.name` ASSUMED |
| `sku` R | Product key | Product Internal Reference ASSUMED |
| `warehouse` R | Destination site | Receipt destination location → warehouse mapping ASSUMED |
| `po_date` R | PO **confirmation** date, not RFQ creation date | Purchase order `date_approve` ASSUMED; research did not verify receipt export |
| `promised_date` O | Original promised arrival for on-time comparison, never overwrite with actual | Expected Arrival concept documented D2; historical frozen promise/technical `date_planned` ASSUMED |
| `received_date` R | Actual completed physical receipt date | Receipt `stock.picking.date_done` / completed move date ASSUMED |
| `quantity` R | Completed quantity in base units, not full ordered PO quantity repeated per partial receipt | Completed stock move quantity ASSUMED |
| `supplier` R | Stable supplier key/label without sensitive contacts | Vendor `partner_id` on pricelist documented D5; receipt/PO linkage ASSUMED |
| `po_complete` O | `true`: upstream confirms the PO/SKU/site observation is complete; `false` or blank excludes it from lead-spread readiness. Use a consistent assertion on split receipts | Outstanding PO balance/status reconciliation ASSUMED; no directly verified field |

### `incoming_pos.csv` — optional open supply, unique `po_line_id`

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `po_line_id` R | Stable PO line, counted once | `purchase.order.line.id` ASSUMED |
| `sku` R | Product key | Product Internal Reference ASSUMED |
| `warehouse` R | Destination site | Picking type/destination mapping ASSUMED |
| `supplier` R | Supplier identifier | Vendor/PO relation ASSUMED (D5 documents vendor pricelist partner) |
| `remaining_qty` R | Undelivered, uncancelled balance after partial receipts, in base units | Ordered minus completed/cancelled quantity, e.g. `product_qty - qty_received`, ASSUMED; returns policy must be reconciled |
| `due_date` R | Latest explicitly confirmed expected arrival date | Expected Arrival and late-PO behavior documented D2; exact line field ASSUMED |
| `status` R | `confirmed`, `draft`, `cancelled`. Only confirmed contributes supply | PO states/routes mapping ASSUMED; confirmed Incoming concept documented D3 |

Overdue confirmed supply warns `overdue_incoming`. It is **unresolved**, not zero or implicitly arriving today. Future engine must show scenarios and hold purchase approval until reconfirmed; do not double-order a late PO. `stock.csv.on_order>0` plus confirmed detailed supply for that SKU errors `incoming_overlap`: remove/reconcile the aggregate, not sum both. No automatic overlap inference from matching quantities.

### `customer_orders.csv` — optional committed demand, unique `order_line_id`

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `order_line_id` R | Stable undelivered customer-order line | `sale.order.line.id` ASSUMED; no customer identity required |
| `sku` R | Product key | Internal Reference ASSUMED |
| `warehouse` R | Fulfilment site | Sale order warehouse / outgoing picking mapping ASSUMED |
| `quantity` R | Remaining confirmed customer quantity, after delivered/cancelled quantities, base units | **Outgoing** confirmed SO/MO concept documented D3; `product_uom_qty - qty_delivered` ASSUMED |
| `delivery_date` R | Agreed outstanding delivery date | SO commitment / scheduled outgoing date ASSUMED; do not infer from invoice date |
| `status` R | `confirmed`, `draft`, `cancelled`; only confirmed counts | Sales state mapping ASSUMED |
| `forecast_included` R | `true`: consume that month/site's baseline first; `false`: verified incremental demand beyond baseline. Neither means already delivered | Explicit planning classification ASSUMED; no verified native field |

Never add all customer orders to all forecast demand. Future netting is `max(baseline, included commitments) + incremental commitments`. Reservations must be mapped to order lines in explicit planning policy or approval remains locked; the CSV alone cannot prove whether a reservation is the same demand.

### `warehouses.csv`, `warehouse_stock.csv`, `transfers.csv`

| File / key / column | Meaning | Odoo source / evidence |
|---|---|---|
| warehouses / `warehouse` R, key | Stable site key | `stock.warehouse.code` / ID ASSUMED |
| warehouses / `name` R | Site display name | `stock.warehouse.name` ASSUMED |
| warehouse_stock / `sku` R, key part | Product key | Internal Reference ASSUMED |
| warehouse_stock / `warehouse` R, key part | Site identifier | Internal location hierarchy rolled up to one warehouse ASSUMED; do not count a child twice |
| warehouse_stock / `on_hand` R | Gross stock at this site. All sites must sum exactly to global on_hand | Stock report On Hand concept D3; `stock.quant.quantity` by location mapping ASSUMED |
| transfers / `from_warehouse` R, key part | Sending site | Resupply route origin ASSUMED |
| transfers / `to_warehouse` R, key part | Receiving site, must differ | Resupply destination ASSUMED |
| transfers / `lead_days` R | Whole calendar days from dispatch to usable arrival for this directed route | Inter-warehouse route lead time/manual logistics estimate ASSUMED |

No reverse route is inferred. No site demand is inferred from stock proportions. Site forecast shares, shipping calendars and transfer cost/eligibility are explicit future planning policy; readiness of these CSV facts is not a transfer authorization.

### `stock_states.csv` — optional disjoint unavailable quantities, key `sku,warehouse`

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `sku` R | Product key | Internal Reference ASSUMED |
| `warehouse` R | Site whose gross quantity contains these states | Internal location mapping ASSUMED |
| `damaged` R | Physically present but unsellable damage | Dedicated damaged location/custom condition classification ASSUMED; already scrapped/moved-out goods must not be subtracted again |
| `reserved` R | Stock unavailable to uncommitted demand | **Free to Use** excludes reserved concept D3; technical `stock.quant.reserved_quantity` ASSUMED |
| `quarantine` R | Physically present, awaiting quality release | Quarantine location/custom quality status ASSUMED |
| `returns` R | Physically present customer returns awaiting inspection, not a future return forecast | Return/inspection location/custom state ASSUMED |

These counts must be **mutually exclusive** and sum ≤ matching warehouse gross on-hand. Upstream classifies overlaps once, e.g. damaged wins over return-pending. `usable = gross - damaged - reserved - quarantine - returns`. All declared site rows (including zero states) are needed for usable-stock readiness; absent states do not assert clean stock. Reserved commitments require separate mapped relief at fulfilment, not double subtraction.

### `product_master.csv` — optional controls, unique `sku`

Only `sku` is mandatory. An absent field never becomes a supplier MOQ, unlimited cap or unit cost of zero. Constraints can be partly known; full constrained readiness requires all three controls.

| Column | Meaning / capability | Odoo source / evidence |
|---|---|---|
| `sku` R | Product key | Internal Reference ASSUMED |
| `supplier` O | Selected/default supplier → supplier groups | Vendor pricelist `partner_id` documented D5; selected supplier rank/selection ASSUMED |
| `unit` O | Must equal stock base unit → unit sanity | Product `uom_id` ASSUMED |
| `pack_size` O | Positive purchasable increment in base units → final rounding | Packaging Quantity / Reference Unit documented D6; technical packaging linkage ASSUMED |
| `moq` O | True minimum positive purchase accepted → MOQ floor | Buyer-confirmed supplier agreement/custom field ASSUMED. D5 `min_qty` is a **price-break quantity**, NOT verified as true MOQ |
| `max_order_qty` O | Hard maximum quantity on one proposed purchase line, not target inventory | Buyer policy/custom field ASSUMED; Odoo rule Max is NOT this field |
| `unit_cost` O | Current per-base-unit planning cost, single bundle currency → ABC, cash/value | Stock report **Unit Cost** documented D3; technical `standard_price` and valuation/purchase-cost equivalence ASSUMED |
| `cbm` O | Cubic metres per base unit → shipment/space check | Product Volume technical `volume` ASSUMED; landed-cost volume evidence was snippet-only, not field verification |
| `weight_kg` O | Kilograms per base unit → weight cap | Product Weight technical `weight` and configured kg conversion ASSUMED |
| `abc_override` O | Exact `A`,`B`,`C`, explicit owner importance override | Manual/custom classification ASSUMED; no native ABC verified |
| `critical` O | `true` or `false`; criticality independent of monetary value → service floor | Buyer/custom critical flag ASSUMED |
| `lifecycle` O | `active`,`new`,`discontinued` → lifecycle gates | Owner lifecycle/custom mapping ASSUMED; archived active flag is not automatically discontinued |
| `replaced_by` O | Successor SKU; directed acyclic chain → history carryover | Custom product replacement relation/manual mapping ASSUMED |

A replacement link is not permission to combine stock/history: require explicit conversion and effective date in planning policy. A new item needs launch/analog/scale choices; they are not guessed from prelaunch zeros. MOQ > max, or no pack multiple between MOQ and max, is an `order_conflict`, not silent clipping. See the precise pipeline in the order spec.

### `relationships.csv` — optional item links, key `source_sku,target_sku,kind`

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `source_sku` R | Demand-bearing/source item | Product relation mapping ASSUMED |
| `target_sku` R | Alternative or attached item, different from source | Optional/accessory/alternative product or BOM/custom relation ASSUMED; no verified export |
| `kind` R | `substitute`, `complement`, `kit` | Explicit buyer/BOM classification ASSUMED; a sales accessory is not automatically mandatory kit demand |
| `direction` R | `forward` or, for substitutes only, `both` | Manual compatibility policy ASSUMED |
| `ratio` R | Target base units per source base unit; positive. A both-way substitute reverse uses reciprocal ratio | Unit-aware buyer specification / BOM ratio ASSUMED |

Kits/complements form one acyclic directed graph; self-links/cycles error. One source/target companion pair cannot be declared both kit and complement, preventing duplicate attachment. Explicit parallel substitute directions must agree after reciprocal expansion; conflicting ratios error. Substitute links can be bidirectional but must not recursively create demand. Technical/colour/shade compatibility, attach scope, existing companion coverage and accepted substitution remain explicit scenario settings. Demand transfer conserves source-equivalent units; attached suggestions never silently duplicate an existing order.

### `unit_conversions.csv` — optional, key `sku,from_unit,to_unit`

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `sku` R | Product-specific conversion | Product/unit mapping ASSUMED |
| `from_unit` R | Source unit label | Unit name, technical `uom.uom.name` ASSUMED |
| `to_unit` R | Target unit label | Reference/base/purchase unit ASSUMED; D6 documents Reference Unit concept |
| `factor` R | `target_quantity = source_quantity * factor`. Example box→m2 = 1.44 | Packaging Quantity/Reference Unit D6 concept; actual `uom` factor direction varies by Odoo version and is ASSUMED until export-tested |

Every conversion graph must include the stock base unit; all reciprocal/transitive paths must agree (validator relative Decimal tolerance `1e-20` for repeating reciprocals). Avoid source ERP raw factors without checking direction. Distinct unconnected unit components are not permission to convert them; future planner requires a verified path for each actual conversion.

### `reorder_rules.csv` — optional read-only rule check, unique `rule_id`

| Column | Meaning | Odoo source / evidence |
|---|---|---|
| `rule_id` R | Stable exported rule identifier | `stock.warehouse.orderpoint.id` ASSUMED |
| `sku` R | Product reference | Reordering Rules **Product**, D1; technical relation ASSUMED |
| `warehouse` R | Comparable site scope | Rules **Location**, D1; location→warehouse rollup ASSUMED. Different sublocation scopes must not be merged blindly |
| `min_qty` R | Rule trigger minimum forecasted stock | **Min** documented D1; `product_min_qty` ASSUMED |
| `max_qty` R | Rule stock target, not maximum PO-line size | **Max** documented D1; `product_max_qty` ASSUMED |
| `multiple` R | Positive order multiple in base units | **Multiple** documented D1; `qty_multiple` ASSUMED |
| `route` R | Exported route identifier/label, preserve it | Route/hidden columns documented D1; exact route mapping ASSUMED |
| `trigger` R | Canonical `auto` / `manual` only after verified mapping | **Auto/Manual** behavior documented D1; technical field/value mapping ASSUMED |
| `lead_days` O | Rule/vendor replenishment time in whole days for comparison | Vendor Lead Time and Days to Purchase concepts D2; comparable combined rule field ASSUMED |

Validator checks numeric range, reference syntax, min≤max. Semantic checks (weak min, pack/MOQ, missing/duplicate site rules, stale lead, route/trigger relevance and version-aware exceptions) are **specified**, not executed, in the order spec. Source rule with multiple=0 needs a verified explicit default conversion rather than guessing 1.

### `legacy_receipts.csv` — optional existing future monthly format

Exact header **`sku,month,quantity`**, all R; same existing CLI `--receipts PATH` interface, irrespective of filename. `sku` is a known product; `month` is after the last sales month and within the next 12; `quantity` is confirmed future supply in base units. Odoo source is future incoming aggregation ASSUMED (Incoming concept D3). Rows are additive per SKU/month; monthly aggregate must remain ≤1e12. This lane's validator reserves this filename to distinguish it from richer completed `receipts.csv`. Do not provide it together with detailed `incoming_pos.csv` or positive undated on_order for the same SKU. A month-only event is not an exact arrival day: retain Basic timing disclosure. Historical `rcv:` columns are a different, non-overlapping time scope.

## Data-readiness capability map

`validate_bundle(directory, today=None)` returns JSON-compatible `{contract_version, valid, snapshot_date, decision_date, errors, warnings, counts, features}`. A diagnostic is `{code,file,row,field,sku,message}`; row 2 is the first data record, null row means file/bundle-level. `valid=false` if any error; warnings never silently repair values. CLI prints JSON and exits **0 valid / 2 invalid**. All diagnostics are local; no file writes or ERP calls.

Each feature returns `{state,chip,items:{sku:{state,needs,error_codes}}}`. Aggregate state is `on` if at least one item is data-ready, otherwise `locked` if relevant partial data/errors exist, else `hidden`. Always use the **item gate**, not aggregate state, to apply an adjustment. Baseline/seasonality/classification are discoverable even with thin data. Optional-file errors lock that feature, not unrelated baseline math. Manifest/stock errors affect all dependent gates. Unknown optional columns warn only.

**Important two-stage gate:** validator `on` means **CSV inputs ready for that feature's preflight**, NOT engine implemented or owner-facing feature On. `ORDER-BUILDING-SPEC.md` defines stricter final gates requiring scenario settings, provenance and feasible calculations. In particular shipment caps, site demand shares, allocation priorities/reservation mappings, compatibility/attach coverage, successor effective dates, calibrated backtests, signing keys and Arabic review are not inferred by this validator. A future UI must combine CSV gate AND policy/runtime gate; missing policy means Locked. This new module is not wired into any current app surface, intentionally avoiding concurrent engine/UI edits.

| Feature key / short chip | CSV readiness (additional policy/runtime requirements in spec) |
|---|---|
| baseline / Basic | Valid current stock prefix and ≥3 full months |
| seasonality / Seasonality | ≥24 full months; method must also beat held-out baseline before use |
| stockout_correction / Stockout adjustment | Complete annotated months with known in-stock days/backorder policy; apply only lost-sales policy |
| project_exclusion / Project sales | Complete explicit project flags; never replace missing months with zero |
| lead_spread / Lead-time spread | ≥5 distinct POs explicitly `po_complete=true`, selected supplier; final-date grouping and comparable receipt scope required |
| dated_incoming / Incoming orders | Valid PO identities, quantities, dates, states, destination references; overdue warning requires reconfirmation before approval |
| committed_demand / Customer orders | Valid remaining customer lines, dates, inclusion classification and destinations |
| usable_stock / Usable stock | Reconciled gross per-site matrix and complete disjoint stock-state rows |
| classification / ABC / XYZ | ≥12 calendar months, complete comparison-population costs, known item critical flag, currency; actual eligible-month XYZ/ABC/service policy is phase 5 |
| supplier_groups / Supplier group | Selected supplier per SKU |
| container_fill / Container fill | Supplier, cost, CBM, weight, pack and currency; caps/ship dates/space/cash must still be supplied |
| order_constraints / Order limits | Pack, MOQ, maximum known and not structurally contradictory |
| transfers / Transfer first | Warehouse gross/states/route lead facts; site demand and eligibility still required |
| allocation / Allocate stock | Customer lines, warehouse stock and a complete site-state matrix; final priority/reservation matching still required |
| substitutes / Alternatives | Valid substitute links; acceptance/compatibility and physical availability still required |
| complements / Add together | Valid complement ratios; actual covered demand must be netted |
| kits / Kit parts | Valid directed acyclic kit ratios; mandatory/covered policy required |
| supersession / Replaced product | Valid acyclic `replaced_by`; date/conversion/attribution policy required |
| unit_conversion / Unit conversion | Consistent explicit graph; actual used units must have a path |
| rule_health / Rule health | Parsed rules and site references; semantic comparison must be enabled separately |

Offline proposal/approval, new-product analog selection, confidence/calibration and Arabic/RTL are **not unlocked by a CSV file**. See the order spec's Hidden/Locked/On chips. Retain main screen product/status/quantity/order date/chart; map diagnostics into Data health / Why this number rather than adding dashboard columns.

## Deterministic sample and verification

```sh
/usr/bin/python3 scripts/make_samples.py
/usr/bin/python3 data_contract/validate.py samples/synthetic --today 2026-11-01
TMPDIR="$PWD/.scratch" /usr/bin/python3 -m pytest tests/test_data_contract.py -q
```

The generator anchors snapshot to 2026-10-31 and never calls a clock or RNG. It writes only the selected `--output` directory (default `samples/synthetic`), overwriting its own named outputs. It does not remove unknown files. Six clearly named synthetic SKUs; MAIN/EAST/WEST warehouses; one discontinued predecessor, one new product, a both-way substitute, tile→adhesive/grout ratios, box→m² conversions, five completed variable-lead POs, open/included/incremental orders, and damaged/reserved/quarantine/return-pending stock. Known overdue incoming is deliberate test data. Nothing constitutes a purchase suggestion from a production forecast.

## Reference evidence from supplied research

Research: `lane-2-smb-erp-inventory.md`, sections “What Odoo exports” and Sources; `CONSOLIDATED-findings.md`; approved Stock Runway gradual roadmap. Docs below establish screen/concept semantics only as qualified above; no new network fetch or instance proof was performed here.

- **D1 / S1:** [Reordering rules, Odoo 20.0](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html).
- **D2 / S2:** [Lead times](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/lead_times.html).
- **D3 / S13:** [Stock report](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/stock.html).
- **D4 / S4:** [Replenishment report](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/report.html).
- **D5 / S6:** [Import vendor pricelist](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/purchase/products/pricelist.html). Research verifies `partner_id`, `product_tmpl_id`, `delay`, `min_qty`; import documentation does not itself prove an export template.
- **D6 / S14:** [Packaging](https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/product_management/configure/packaging.html).

Not checked: live Odoo/export availability or version, operational data accuracy, current UI integration, full engine phase 4–6 implementation, cryptographic identity/access control, native Arabic review or RTL rendering.

## Phase 2 milestone implementation note (2026-11-13)

The explicit opt-in loader now wires `incoming_pos.csv` through per-SKU strict
preflight to Python tools/CLI and a browser JSON bridge. `received` is also accepted
as an excluded terminal incoming status; it never contributes supply. The remaining
balance of a positive confirmed PO before `max(today,snapshot+1)` is unresolved,
excluded from trusted projections, and locks purchase approval. See
[phase2.md](../history/changes/phase2.md) for cutoff, bridge schema, exact date simulation
and current verification boundaries. Other readiness features remain preflight only.

The same explicit Phase 2 path now adopts `customer_orders.csv` as dated demand:
confirmed included quantities consume monthly forecast allocation once; verified
incremental quantities add demand on their dates. Overdue undelivered balances move
to the planning cutoff and its month, with a warning. Runtime readiness additionally
requires explicit zero-reservation observations at committed sites; unknown/positive
reservations HOLD approval until a future mapped-relief policy is implemented.
The existing stock-state/gross validation remains in force. No new CSV columns or
reservation-mapping file are inferred. See [phase2.md](../history/changes/phase2.md) for exact
allocation, sequencing, provisional quantities, bridge types and milestone limits.

### Feature 3 implementation boundary (2026-11-13)

The explicit opt-in bundle/bridge now wires complete per-SKU `sales_history.csv`
exposure and backorder facts to the actual cleaning lab and adopted model. Only
explicit lost sales uplift; quarter-exposure floor/fourfold cap. Zero exposure with
zero sales is censored and excluded from denominators; original month labels and
raw history remain. Missing/invalid supplied facts or fewer than three eligible
observations HOLD guidance. No annotation file preserves existing outputs exactly.
See [phase2.md](../history/changes/phase2.md) for raw/adopted trace schema, calendar fallback,
actual source paths and verification boundaries. Project/manual/outlier/method
selection gates remain unimplemented in this feature.

### Feature 4 implementation boundary (2026-11-13)

Complete explicit `sales_history.project` booleans now activate whole corrected-month
exclusion through the existing lab. The adapter tracks eligibility independently of
the lab's numeric zero, retains all calendar labels and requires three eligible
observations. Partial/unknown flags HOLD the pipeline; absent flags preserve feature3.
Project-only facts can filter raw history without inventing missing exposure policy;
declared-but-incomplete exposure stays held. Eligible-history outlier flags are
suggestions only, never automatic exclusions. See [phase2.md](../history/changes/phase2.md)
for typed bridge metadata, gates, diagnostic population and before/after examples.
Manual percent and future method selection remain outside this feature.
