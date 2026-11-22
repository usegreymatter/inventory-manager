# Cost & profit view

**Display only.** Valuations do not feed the order engine, change stock, select a
forecast, round purchase quantities or place orders. Existing purchase/forecast
code and numerical goldens remain unchanged.

## Inputs and import

`unit_cost` is what one unit costs you. The existing product > supplier > file
cost precedence is retained. Optional `sale_price` is what you sell one unit for;
its aliases are **price, selling price, retail price, sales price, list price**.
The canonical `sale_price` header also works. CSV and smart workbook import use
the same bounded number, currency-symbol, semicolon and decimal-comma handling
as unit cost. An ambiguous price is not silently interpreted. Missing/blank
prices stay absent; zero is a real supplied price.

No price means **cost-only**: there is no invented margin, lost profit or
selling value. Missing cost means no monetary metrics. Missing quantities and
unsupported risk remain absent, not zero. Money is in the file's currency;
there is **no currency conversion**. Only combine products valued in the same
currency and at a consistent unit/tax basis. Currency labels are presentation,
not exchange rates. Margin excludes tax, shipping, fees, overhead and discounts.

## Formulas

| Field | Formula / meaning |
| --- | --- |
| `money_tied_up` | `on_hand × unit_cost`, current snapshot acquisition cost |
| `incoming_value` | `(on_order + existing dated-supply ledger quantities after snapshot) × unit_cost`; unknown undated incoming omits the aggregate, not guessed zero |
| `order_value` | unchanged suggested order quantity × effective unit cost |
| `margin_unit` | sale price − unit cost; negative margins remain visible |
| `margin_pct` | `(sale price − unit cost) / sale price × 100`; absent at zero sale price |
| `stock_margin` | on hand × unit margin; potential gross margin, not earned profit |
| `stock_sale_value` | on hand × sale price; total-margin weighting basis |
| `weekly_cost` | displayed monthly demand × 7 / 30 × unit cost |
| `money_cover_weeks` | money tied up / weekly cost; omitted when weekly cost is zero or unknown |
| `lost_profit_est` | expected shortfall units before suggested arrival × `max(0, margin_unit)` |
| `expiry_value_at_risk` | `expiry_at_risk_qty × unit_cost`, only when expiry analysis supplies this field |

Incoming reuses the engine's read-only, additive supply ledger (confirmed exact
POs and first-of-month monthly receipts), rather than rejoining source PO rows.
As with order planning, do not supply the same PO both as undated `on_order` and
a dated receipt. The pure module accepts `incoming_qty` from that ledger and
otherwise falls back to `on_order` for simple records.

Weeks of cover in money is a **cost-weighted stock-to-demand ratio**, not a
calendar run-out prediction or extra order cover. It excludes incoming supply.
Totals divide the sum of stock values by weekly costs for the **same subset**
with known stock value and positive weekly cost. Total margin percent is
`sum(stock_margin) / sum(stock_sale_value) × 100` for priced stock; per-unit
margins are never summed across different products/units. Known-value totals
show covered/loaded product counts; partial totals do not pretend missing
values are zero. No denominator means no percentage or cover figure.

## Lost profit is an estimate, not a guarantee

We reuse the existing deterministic run-out sampler (1,000 paths), adding only
an opt-in **read-only collector** `include_shortfall: true`. On each existing
segment before suggested arrival, collect `max(0, segment demand − available
stock after segment receipts)`. Average the sum across the same paths. Do not
carry missed sales as negative-stock debt into later segments. Receipt timing,
lead multipliers, forecast, random seed, block draws, quantities and the existing
before/after probabilities are unchanged. The default risk API is unchanged.

A probability of running out alone **cannot determine shortfall units**. The
cost view only uses the explicit `expected_shortfall_before` sampler output;
if it is unavailable, withholds risk or rejects the scenario, lost profit is
omitted. Unsupported experimental-method calibration and held products do not
get an invented estimate. The standalone worklist reuses already computed risk
outputs; amounts may appear after its idle risk batches finish. Showing the
lost-profit custom column also enables those batches. Product detail computes
risk using the existing product adapter. CLI/desktop use the same snapshot-based
risk specification (first day after stock snapshot, not an imaginary fresh
stock count). Thin history, assumed lead spreads, first-of-month monthly receipts
and demand model limitations still apply. See `risk.py` for those assumptions.

### Hand-worked example

60 units on hand, 10 undated incoming, order suggestion 20, unit cost 4, sale
price 10, monthly demand 30, expiry analysis at-risk quantity 3, and an existing
risk output reporting expected shortfall 5 units:

- Tied up = 60 × 4 = **240**; incoming = 10 × 4 = **40**; order = 20 × 4 = **80**.
- Unit margin = 10 − 4 = **6**; margin = 6 / 10 × 100 = **60%**.
- Weekly stock cost = 30 × 7 / 30 × 4 = **28**; cover = 240 / 28 ≈ **8.57 weeks**.
- Lost profit estimate = 5 × 6 = **30**; expiry value at risk = 3 × 4 = **12**.

For the shortfall collector itself, constant demand 30 in November, stock 5,
10-day lead from November 1, and fixed lead multiplier 1 give demand 10 before
arrival: `max(0, 10 − 5) = 5` units in each path, hence mean shortfall 5. This
is not the probability (which is 1 here) multiplied by demand.

## Surfaces and integration hook

- CLI costs are **off by default**, including when `--json` or `--explain` is
  used and when a CSV already contains `unit_cost`. Opt in with `--costs` or a
  settings JSON object containing `"show_costs": true`. The setting must be a
  JSON boolean; `false` keeps costs off, and explicit `--costs` overrides it.
- With costs on, `--json` adds available metrics and `cost_explanation` to each
  exported product, retaining the existing JSON-array shape. CSV adds metric
  columns and `cost_explanation`; `--explain` additionally includes the existing
  quantity explanation. `--costs` alone is enough to request cost columns.
- Cost totals, including coverage counts, are JSON on **stderr**, even with
  `-o`. They cover only exported products with known inputs, not products hidden
  by the order-status filter. No known cost metrics means no cost-total line.
- With costs off, new monetary fields, columns, explanations and cost totals
  stay absent. Existing v1.1 CSV/JSON/explain output bytes remain unchanged for
  the regression examples. The CLI's import disclosure continues treating a
  sale-price column as ignored unless costs or the separate profit suggestion
  is enabled; this presentation does not change imported stock or quantities.
- Example (local files only):
  `python3 stock_runway.py stock.csv --today 2026-11-01 --all --json --costs`.
  Equivalent saved visibility: `{"show_costs":true}` with `--settings costs.json`.
  Costs remain display-only and do not implicitly enable profit suggestions.
- Offline Arctic page: Custom view column options, all-loaded-product totals
  strip, full product report and side panel. Unknown metrics display `—` or are
  omitted. Simple view's original columns are unchanged.
- Hermes Desktop: all-product totals and selected-product cost/profit detail.
- Expiry hook reads `expiry_at_risk_qty` from guidance, falling back to the item
  only when guidance does not supply it. No expiry analysis, no expiry value;
  this view never estimates shelf life or modifies expiry/order constraints.

Desktop's single-blob loader uses generated inline display modules **after**
the protected core; it has no relative imports. Keep mirrors synchronized with
`python3 scripts/sync_cost_view.py` (`--check` verifies freshness). The offline
capture script builds HEAD into `.scratch/cost-ui/head.html` before probing it,
so a stale committed download cannot pass UI acceptance.

The pure Python and JS cost modules are tested on 1,200 deterministic random
products, plus zero, missing, invalid, negative-margin and weighted-total cases.
All UI user text uses React text children or DOM text nodes, not HTML insertion.
