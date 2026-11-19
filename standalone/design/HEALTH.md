# Dataset health contract

`dataHealth(dataset, today = null, settings = {})` (browser script) and
`data_health(dataset, today=None, settings=None)` (stdlib Python) are pure twins.
They never change a forecast, quantity, selected method, or input object. No
clock, filesystem, network or live ERP reads occur. Supply `today` as YYYY-MM-DD
for stale-snapshot checks; omission uses `as_of` for deterministic replay.

Inputs are the existing A3/CLI dataset (`as_of`, contiguous `months`, `items` with
`sku`, `name`, `unit`, `on_hand`, `monthly_sales`). Evaluated items may additionally
carry `guidance.quantity` for order-size sanity. Optional order limits can be
item fields or `settings.product_overrides[sku]`: `minimum_order`, `pack_size`,
`max_stock`. Maximum is interpreted as a maximum order limit by this diagnostic,
not enforced by the calculation. Exact final semantics belong to the maths lane.

Additional opt-in health metadata, not new CSV import support:
- `partial_last_month: true` excludes the trailing sales month from gate counts.
  A snapshot before month-end also identifies a partial trailing snapshot month.
- `receipt_history: [{ordered_on, received_on, quantity}]` contains completed,
  positive, dated receipts no later than `as_of`. Both dates are required to
  establish lead-time observations. Monthly `historical_receipts` totals are not
  fabricated into dated receipts. Five observations per item clear readiness.
- `usable_on_hand`, or all of `on_hand`, `damaged`, `reserved`, identify usable
  stock readiness. Zero is valid data, not absence.
- Nonempty `committed_orders`, `substitutes`, `kit_components` arrays and a
  `warehouse_stock` array with more than one warehouse identify optional inputs.
- Positive monthly `receipts` or completed dated receipts identify receipt data;
  `on_order`/`open_receipts` without those identify a locked receipt capability.

Output is `{features: {key: {state, needs}}, warnings: [{code, sku, severity,
short_label}]}`. Warnings deduplicate `(code, sku)` in deterministic encounter
order. Dataset-wide warnings use an empty SKU. Labels are at most three words.
Stock/order above **24 times** mean complete-month demand produces Check units;
the exact 24× boundary and zero-demand histories are not flagged. Snapshot age
must exceed 45 days. Conflicting MOQ/pack/max limits include pack-rounded MOQ
that cannot fit the maximum.

Readiness is **not activation**: `on` says relevant metadata exists, not that
seasonal/intermittent forecasting, lead-time spread, linked-item demand, usable
stock deductions or multi-warehouse routing is implemented. These remain off in
Phase 1. No readiness state may change maths. Seasonality readiness requires all
item histories to contain at least 24 contiguous full valid months; lead-time
spread requires five dated observations per item. Intermittent identifies at
least one item with strictly more than 50% zero full months. With history but a
failed threshold the feature is locked; without history it is hidden. Optional
linked-item/warehouse inputs are hidden until present. This conservative global
map must be recomputed for a selected single-item dataset before making an
item-level claim.

Python tests contain threshold oracles and 323 deterministic JS/Python parity
cases, including seeded malformed values. Fixtures are synthetic only.
