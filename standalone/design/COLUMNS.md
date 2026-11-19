Lifecycle: living

# Worklist decision columns

Status: **rendered approval draft**. These are display-only metadata over the existing item and guidance. They do not alter quantities, forecasts, stock, receipts, CSV parsing or ERP data. Full QA is deferred until owner design approval.

## Definitions

History is aligned by `data.months[n]` / `item.monthly_sales[n]`, in the dataset's chronological order. Only finite observations whose month has completely ended on or before `data.as_of` are eligible. The snapshot's month counts when the snapshot is its final day. Missing observations are not interpreted as zero.

| Column | Definition and missing-data behavior |
| --- | --- |
| Monthly sales | Arithmetic mean of the last six eligible history observations; fewer when fewer are available. No eligible history → `—`. Render with up to one decimal and the item's unit, e.g. `12,545.8 m`. Sort uses the unrounded number. This is observed sales, not forecast demand. |
| Order value | Existing `guidance.quantity` × effective `unit_cost`. Cost uses the same resolver as settings: product override → supplier override → file. Missing/invalid cost or quantity → `—`; zero cost/value is valid. |
| Order lasts | Existing quantity ÷ `guidance.monthly_demand`; use Monthly sales only if the guidance rate is absent/nonfinite. A zero forecast is preserved, not replaced. Positive rate required, otherwise `—`. Render `~3.2 mo`. This is a rate-based approximation, not a projected run-out date. |
| Sales pattern | Population coefficient of variation (standard deviation ÷ mean) of the last 12 eligible observations. CV < 0.5 → Steady; 0.5 ≤ CV < 1.0 → Variable; CV ≥ 1.0 → Erratic. Fewer than four observations or zero mean → `—`. The engine's existing forecast accuracy grade is **not** a variability class, so it is not relabelled as one. |
| Excess value | `max(0, on_hand + on_order − (guidance.safety_stock + monthly_rate × (guidance.lead_days + ceil(months_of_cover × 30)) / 30)) × effective unit_cost`. Monthly rate follows Order lasts. Cover uses effective settings and the existing 30-day cover convention. Missing cost or required inputs → `—`; zero excess → `—`. This is a snapshot, constant-rate estimate over lead + cover, not the engine's dated/seasonal MRP calculation or an instruction to dispose of stock. |
| Last sold | Most recent eligible history month with sales > 0, formatted `Oct 2026`. `Never` means no positive sales in the **loaded complete history**, not an assertion about the product's lifetime. |

There is no currency setting in the current settings schema. Values therefore use **plain whole numbers** with the `Order value` / `Excess value` headings, not an invented KD label. All costs in a dataset must use one consistent currency. The formatter can honor a string `settings.currency` if the schema gains one; this change does not add a setting or import field.

## Summary strip

- Quantity to order: sum quantities for products in the existing **Order now** bucket, grouped by `item.unit`. Never add metres to pieces. Example sample output is `2,893 units · 30,868 m` at the capture date.
- Default product: show a monetary order total only when every Order now product has cost and quantity; otherwise keep quantities separate by unit. The synthetic demo alone opts into an `Order value (known costs) · cost missing for N products` subtotal, excluding uncosted products explicitly. Neither mode adds unlike units or treats missing costs as zero.
- Summary scope remains all loaded products, as with the original summary; row filters do not change it.

## Column layouts

- Simple: Product, Status, On hand, On order, Monthly sales, Order qty, Order value, Order by, Runs out.
- Detailed: all 17 columns.
- Custom: last edited visibility and order. Product is always first and cannot be hidden or moved.
- View → Customize columns and the desktop header's quiet `+` (44px, “Add or remove columns”) share the same checklist renderer. Product is disabled. Checkboxes update both editors, switch to Custom, and persist. View retains full drag/touch/arrow controls; the header popup is a compact checklist.
- Desktop (≥1024px) headers reorder by native HTML5 drag or pointer fallback after ~6px movement. A 2px accent edge previews insertion. Drops insert into the chosen sequence, retaining auto-hidden columns. Product is locked first. A normal click still sorts; focused header buttons support Alt+Left/Right with live announcements. Phone keeps its card rows and View customization, not desktop drag controls.
- Visible header and row cells follow `wl.columns` in order. Hidden-column order is kept separately in `wl.customOrder`; edits set Custom and persist `wl.customColumns`. Simple/Detailed do not erase the custom set. Reset restores Detailed without deleting the remembered custom set.
- Layouts, custom state and order are dataset-local in localStorage, in URL/view snapshots, and in saved views. Existing full Detailed layouts migrate to the new Detailed preset; legacy subset layouts remain Custom.
- Existing order-copy and CSV exports use their fixed purchase-order/CLI contract, not the visible-column list; they are intentionally unchanged.
- Phone rows retain the order quantity/date line and show compact Monthly sales + Order value on the secondary line when those columns are selected. Detailed tables scroll **inside** the table; a footer hint identifies additional columns.
- Assumed delivery markers in the list are shortened to `Assumed 14 d`, retaining the full explanation in the title, so they no longer squeeze out the SKU.

## Bounded verification

`node standalone/capture-columns.cjs` uses the installed Playwright and qa-chrome, blocks HTTP(S), captures 1440×900 and 390×844 sample-only screenshots, checks column visibility/order, Custom persistence, presets, native drag, pointer fallback, keyboard controls, reset, and page overflow/errors. Two sample SKU averages are independently calculated from `data/sample.json` and printed with their arithmetic in `.scratch/pp/columns-report.json`. Sample products contain no unit costs; missing values are deliberate, not fabricated prices.

`node --test tests/standalone.test.mjs tests/arctic.test.mjs` is the requested quick smoke only. Arctic tests additionally exercise display formulas with clearly synthetic costed items, missing/zero values, effective cost overrides, forecast fallback, CV thresholds and partial-month exclusion. No golden files or order/forecast math are changed.

Approval screenshots: `.scratch/pp/cols-simple-1440.png`, `cols-detailed-1440.png`, `customize-panel-1440.png`, `cols-390.png`.

Not checked: owner approval, full tests/lint, real iPhone/Safari/Firefox, Arabic UI, live inventory/ERP data, or a release/deployment.
