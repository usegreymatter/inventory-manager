Lifecycle: living

# Arctic product reports and product-type groups

Status: local prototype verified for suggested-order overlays and local email drafts with targeted Node and offline Chrome checks. Owner design approval and real-device testing remain pending.

## Sources and invariants

- `worklist-gm-b.js`: six display-only decision columns, order-value and unit-grouped summaries, and one persisted Customize panel (checkbox, drag/touch/keyboard reorder); definitions and layout semantics are in [COLUMNS.md](COLUMNS.md).
- `worklist-gm-b.js`: visible Status / Product type / Supplier grouping, dataset-local collapsed sections, cached group totals and viewport-only row DOM. Missing metadata options are omitted. `category` remains the compatible data/CSV key; visible copy says Product type.
- `product-page-gm-b.js` / `.css`: full-window read-only product report at `#product=<encoded SKU>`, existing guidance figures, existing chart, monthly history/projection ledger, effective input provenance, local product-override settings and order copy with an in-overlay clipboard fallback.
- `chart-focus-gm-b.js`: graph-only focus nested over the report; Escape returns to the report. Drawer expand opens the report, not graph-only focus. J/K traverse products in either layer; Up/Down retain native report scrolling and the focused ledger retains horizontal arrow scrolling.
- `build.py` includes the new presentation files only for option-gm-b. The shipped `standalone/stock-runway.html` must be byte-identical to `design/option-gm-b.html`.
- Do not independently calculate inventory, order quantities, forecasts or receipts in these renderers. Ledger values reuse the plotted history/projection; future stock is shown with the chart's zero floor. Suggested orders are not inserted into projected receipts. The explicitly labelled counterfactual below is display-only and does not replace the source projection. There is no ERP writeback.
- Import additions in `csv_import.py` and `desktop/plugin.js` preserve existing alias precedence. Product Category, Product Type, Type, Item Group, Item Category, Product/Product Category and categ_id resolve to `category`; Product alone still means product name.

## Bounded approval evidence

Run from the repo root with `TMPDIR=$PWD/.scratch` and `/usr/bin/python3`:

```sh
/usr/bin/python3 standalone/build.py
for template in baseline option-a option-a2 option-a3 option-b option-gm-a option-gm-b option-gm-c; do
  /usr/bin/python3 standalone/build.py --template "$template"
done
cmp standalone/stock-runway.html standalone/design/option-gm-b.html
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js \
CHROMIUM_EXECUTABLE=/path/to/chrome \
node standalone/capture-product-page.cjs
node --test tests/standalone.test.mjs tests/arctic.test.mjs
/usr/bin/python3 -m pytest -q tests/test_import*
/usr/bin/python3 scripts/verify_import_examples.py --baseline af2b1c7
```

The capture writes ten sample-data PNGs at 1440×900 and 390×844 to ignored `.scratch/pp/`: product-type groups with a collapsed section, product top, ledger, inputs and graph-only focus. Its report also records nested navigation, focus restoration, setting provenance and a synthetic 20,000-row **pre-evaluated UI** fixture. This does not benchmark full CSV evaluation/forecast throughput. All HTTP(S) requests are blocked.

Screenshots are design evidence, not owner acceptance. Do not run the full test/linter suite before the requested owner design gate. Real Safari/iPhone and Arabic UI are not covered by this bounded capture.

## Decluttered worklist approval draft

- First load: Status grouping, Order now when there are orders (otherwise All), Simple columns. Existing dataset preferences and URL/saved-view state take precedence over column defaults.
- Three summary actions: To order; Order value only when all orders have costs, otherwise quantities kept separate by unit; Running out within 7 days (including already out of stock).
- One toolbar: four scrolling status tabs, expanding search, View. Grouping, column presets/customization, supplier/type facets, save and saved views share View. The single header menu retains import/copy/export/settings, diagnostics, custom-settings and less-common status filters, plus view JSON transfer.
- A dataset-wide delivery-assumption note replaces row badges. Product report/panel provenance is retained. Search keeps focus across filtering; Escape clears and collapses the phone search.
- Bounded checks: `node standalone/capture-clean.cjs`, `node standalone/capture-columns.cjs`, and `node --test tests/standalone.test.mjs tests/arctic.test.mjs`. The former `capture-product-page.cjs` and `capture-table.cjs` routes were retargeted and syntax-checked; their larger batteries remain deferred until owner approval.
- At 1440×900 with a fresh browser context, controls above the table fell from **24 to 11**. Both counts use `document.querySelectorAll('button,a,select,input,summary')`, keep `checkVisibility()` elements with positive width/height, and require their rectangles to lie between viewport top and `#work-scroll` top. Table headings/rows and closed disclosures are excluded; the shared Settings link is included. This measures first-load clutter, not a claimed reduction in every task's click count.
- Approval images: `.scratch/pp/clean-1440.png`, `clean-view-open-1440.png`, `clean-390.png`. Local reports: `clean-report.json` and `columns-report.json`; original baseline: `controls-before.json` / `before-1440.png` in the same ignored directory. The clean capture still runs if baseline evidence is absent, and labels that missing comparison rather than inventing a count.

## Suggested-order graph and local email drafts

- `chart-focus-gm-b.js` reads only computed guidance: quantity, order-by, lead days and safety stock. A positive quantity with a valid date/lead adds **Order today / Order by**, **Arrives** and **Safety stock** annotations, including graph-only fullscreen. Default lead times explicitly say **assumed**. Quantity zero or absent produces no order, arrival, safety or counterfactual overlay.
- Arrival is `order_by + lead_days`, with `now` resolved to the existing decision date `currentToday`. It is a suggested arrival, never a confirmed receipt. Dates use the same start-of-day calendar position as the existing Today divider, `(day - 1) / days_in_month`; month labels remain centred in their monthly buckets. The core enforces month-end snapshots; mid-month snapshots are not a supported input.
- **If you don't order** retains the original projected SVG geometry (including its existing first-stockout stop), rendered solid for this comparison. **If you order** is a separate dashed, zero-floored display path. It reuses each existing monthly projection segment's net-stock slope, `next.stock - previous.stock`, i.e. the chart's own forecast demand minus existing monthly receipts—not a new average-demand model. Monthly receipt totals retain the original straight-segment chart convention; this is not an exact daily receipt simulation.
- At arrival, interpolate the existing un-floored monthly segment, floor available stock at zero, then add the already-computed `guidance.quantity` exactly. Continue with the same remaining segment slopes. Any unfulfilled demand before arrival is not invented as a backorder. Neither the source series, guidance, receipts, quantity rounding, MOQ nor packs are changed. The original ledger remains **without** the new order. Do not extrapolate a new dashed path beyond the existing forecast horizon.
- `presentation-gm-b.js` accepts a display-only peak to fit the extra quantity and safety stock. It rescales geometry only. Annotation lanes above the plot and a small safety-stock key prevent labels from crossing the stock lines; the scenario legend stays on one line.
- Hand check, sample `SEAL-WHT-300`, decision date 2026-11-17: order today + assumed 14 days = **2026-12-01**. November opening stock 548 minus existing forecast demand 830.0833333333334 gives -282.08333333333337; available stock at arrival is `max(0, -282.08333333333337) = 0`. Add computed order 2,893: **0 + 2,893 = 2,893 units**. The browser report prints independent arithmetic for this SKU and demo `TLS-STA-03-103`.
- **Draft email** sits beside supplier-group Copy order, in the existing selected-row action strip, and in the product report's existing action area. It includes only the same attention rows with positive quantities as order copy; mixed selections produce one editable draft per supplier with a supplier selector. Per-line requested delivery uses each row's own order-by and lead days. Computed quantities already respect MOQ/pack.
- The body is editable, with greeting, SKU/name/quantity/unit/delivery lines, confirmation note and `[Your name]`. Copy includes the subject and edited body. A native dialog traps focus; Escape/Close returns to the initiating action. Switching suppliers preserves edits within that dialog. Closing discards drafts; draft contents are not persisted or transmitted.
- **Open in mail app** is a user-activated `mailto:` link with encoded recipient, subject and edited body. Nothing opens or sends automatically. Supplier email is read from an existing `data.suppliers` name-keyed record or array record's `email`, then from an item's existing `supplier_email`. Without an email the recipient is blank. **No supplier – assign first** gets an editable/copyable draft but no mailto link. CSV email aliases were deliberately skipped to keep parsing and the embedded core untouched. Long supplier drafts can exceed mail-client URL limits; Copy remains the fallback.

### Reproducible local checks

Use the build matrix above, then:

```sh
/usr/bin/python3 standalone/build.py --data data/demo-1000.json --out standalone/stock-runway-demo-1000.html
node --test tests/standalone.test.mjs tests/arctic.test.mjs
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js \\
CHROMIUM_EXECUTABLE=/path/to/chrome \\
node standalone/capture-orders.cjs
# With the same browser environment:
node standalone/capture-columns.cjs
node standalone/capture-clean.cjs
node standalone/capture-demo.cjs
```

`capture-orders.cjs` exposes module state only in ignored synthetic/sample probe copies, blocks HTTP(S), and freezes the decision date. It checks 1440/390 default and demo renders, positive/zero orders, graph fullscreen, actual clipboard contents, exact supplier line counts, every selected supplier's draft count, URL-decoded mailto subject/body and unassigned-supplier exclusions. It never follows mailto. Where every healthy sample item still has a future positive order, a clearly named `QA-NO-ORDER` zero-quantity UI clone replaces one healthy row solely for the negative test; shipped data is untouched.

Evidence: `.scratch/pp/orders-report.json`, `node-tests.log`, `columns-report.json`, `clean-report.json`, `demo-report.json`; screenshots `graph-order-1440.png`, `graph-order-fullscreen-1440.png`, `email-draft-1440.png`, `graph-order-390.png`. Screenshots were inspected and annotation collisions corrected. Not checked: owner design approval, real Safari/iPhone, Arabic UI, mail-client launching/delivery or long-mailto compatibility, live inventory, hosted deployment, or the full repository Python/linter suite. No external email or order was sent.

