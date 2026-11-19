# Device-local orders and Excel export

Lifecycle: living. Arctic (`option-gm-b`) only. No engine, forecast, CSV parser,
CLI order, or golden changes.

## Local tracking contract

- `local-orders-gm-b.js` wraps `standaloneRows` with a copied input dataset.
  Local orders become confirmed `planning_facts.incoming_pos` records; all
  projection, status, quantity, safety and late-PO holds remain the shared core's
  calculations. File objects, on-hand counts and ERP state are never changed.
- One active record per SKU: `{sku, qty, unit, ordered_on, expected_on, supplier,
  note}`. Quantity is the already-rounded suggestion; expected date is the device
  order date plus the evaluated lead time. Note is currently blank/reserved.
- Storage identity is a code-point-sorted SKU/unit catalog plus optional
  `dataset_id`, fingerprinted with the existing non-security dataset hash helper.
  Reordering rows or changing stock/as-of does not lose the catalog's marks.
  Changing the catalog or units selects a different identity; records under the
  former key are not deleted. Separate businesses with identical catalogs should
  supply distinct `dataset_id` values when using JSON data.
- Read/validation errors block writes rather than overwriting unrecognized saved
  orders. Read-before-write checks reject a stale tab; storage events reload other
  tabs. This is browser-local convenience storage, not transactional ERP storage.
- Existing undated on-order stock or monthly receipts are not silently converted
  into invented exact dates. The core's mixed-incoming-data hold remains active
  when combined with local dated POs; the product report explains this. Resolve
  the source data before relying on the purchase quantity.
- Expected dates earlier than today remain tracked as **Late**; the core's late-PO
  purchase hold stays active. Focus/midnight refresh uses the current device date.
- **Undo** removes only the local mark. **Mark received** confirms before clearing
  local tracking, explicitly asks for a fresh stock import, and does not increment
  on hand. Receipt recognition is not a fabricated stock movement.
- Reimport reconciliation is advisory only (`imported on_order >= local qty` or
  `as_of > expected_on`). Nothing clears automatically. A group review action
  clears only matching records, never unrelated marks in that supplier group.
- Entry points: email after copy/open; supplier overflow; selection bar; product
  report. No Ordered tab: use View → Ordered by you / Late orders. The summary
  always qualifies local tracking as “marked on this device — not in your ERP.”

## Workbook contract

`xlsx-gm-b.js` writes minimal OOXML in a STORE ZIP with CRC32, UTF-8 names,
relationships, two sheets and bold header styles. Cells are numeric when the
source is numeric; ISO dates are text. Formula-like strings remain inline text,
XML controls are stripped before escaping literal OOXML `_xHHHH_` sequences.

- **Purchase order**: eligible positive suggestions grouped/sorted by supplier;
  SKU, name, quantity, unit, effective unit cost, line value, requested delivery.
- **All products**: every evaluated product, current visible column sequence and
  current sort. Virtualization and selected order rows cannot omit products here.
- Requested delivery means order date + lead time, not a confirmed commitment.
  Existing CLI-parity CSV `arrives_by` remains blank intentionally.
- Email export retains the original draft's rows after marking; its purchase
  quantities do not unexpectedly become the recomputed zero suggestion.

## Supplier minimums and weekly summary (advisory)

- Settings → Suppliers saves optional `min_order_value` / `min_order_qty` in a
  dataset-scoped local key. File `suppliers` records can supply the same fields;
  a saved blank disables the field. No order settings or planner inputs change.
- The advisory uses the supplier's full positive Order now + Soon order, not the
  current search/status filter. Costs missing are explicitly qualified; quantity
  totals only make sense for comparable stock units, as explained in Settings.
- Next orders are existing rounded guidance, earliest run-out first, respecting
  packs/MOQ. No sales, held/needs-data, overstock or >12-month cover cannot be
  pulled forward. Missing-cost candidates cannot be valued. A real zero cost can
  satisfy a quantity-only gap. Impossible limits retain an explicit shortfall.
- **Add to this order** stores ephemeral export-only clones. Copy, email and the
  Purchase order sheet label them `(added to reach minimum)`. **Review additions**
  lists every proposed line; **Remove additions** reverses acceptance. Product
  guidance and All products quantities remain unchanged. Recalculation clears
  acceptance even outside supplier grouping; view filters do not change the plan.
- Email's **Mark suggested lines as ordered** deliberately excludes the advisory
  additions. They are not silently converted into confirmed local receipts.
- View → **Weekly summary** reads all evaluated rows, not the active filter. Its
  order-now count/value match the worklist. Run-out-within-14-days is relative to
  the stock snapshot (including already-out products); late local orders use the
  decision date. Missing costs and unknown incoming stock remain qualified.
- Screen sections show 20 rows; print, Copy text and Excel contain complete lists.
  A4 print hides the app chrome. No summary is sent and no new writer is added.
- Additional proofs: `node --test tests/supplier-minimums*.test.mjs
  tests/weekly-summary.test.mjs` and `node standalone/capture-round3.cjs`.

## Verification and boundaries

Run from the repository with `TMPDIR=$PWD/.scratch`:

```sh
node --test tests/standalone.test.mjs tests/arctic.test.mjs tests/local-orders.test.mjs
/usr/bin/python3 -m unittest discover -s tests -p test_xlsx_export.py -v
(cd tests && /usr/bin/python3 -m unittest test_demo_catalog)
node standalone/capture-local-orders.cjs
node standalone/capture-orders.cjs
node standalone/capture-columns.cjs
node standalone/capture-clean.cjs
node standalone/capture-demo.cjs
```

Browser scripts use `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`, accept local
sample/synthetic data only, and block HTTP requests. Local-orders acceptance
checks group/selected/product/email actions, real localStorage persistence,
Undo, received confirmation, a page.clock late transition, reconciliation,
long-SKU pill visibility at 390px, desktop overflow, and downloads read back by
Python zipfile + ElementTree. It compares two SKUs against independently built
dated inputs: quantities change from 222/217 to 0/0 with identical guidance,
buckets and projections; Undo restores them.

**CSV boundary:** the unchanged CSV parser supports stock/on-order and historical
receipt columns, not future dated PO rows. Therefore the parity test parses the
stock CSV, then independently adds the equivalent dated planning input before
using the unwrapped planner. This proves parsed-stock + dated-input parity, not
an unsupported future-PO CSV import. The two cases are not interchangeable.

Not verified: real ERP writes (not implemented), real Excel/LibreOffice opening,
openpyxl (not installed), Safari/iPhone, Arabic UI, or owner design acceptance.
