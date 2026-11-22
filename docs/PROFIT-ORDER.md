Lifecycle: living

# Most profitable order — experimental, opt-in

This is a **separate order-now estimate**, not a replacement for the current
purchase amount, a supplier commitment, a fitted probability, or a guarantee of
business profit. Missing `sale_price` or `unit_cost` means no suggestion. Zero
price/cost are known values, not missing values. Invalid optional economics
withholds the suggestion without breaking ordinary purchase advice.

Enable the global `profit_suggestion: true` setting, or override that boolean
per product. In the CLI, `--profit-suggestion` enables it; JSON adds
`profit_suggestion` only when available. `--explain`/JSON explanations append a
sentence. Ordinary CSV columns do not change: use `--explain` for text or
`--json` for structured quantities. The Desktop and Arctic standalone detail
show `Most profitable: N (+/-x vs current) — reason`; the original quantity and
all purchasing/copy/export actions remain unchanged. The standalone setting is
under Settings → Advanced, with prices in product settings. Absent settings
stay absent: defaults and old export/golden outputs are unchanged.

## Two different questions, explicitly labelled

The current planner can schedule a future order and uses **months of cover**.
This simulation asks what to order **today**, delivered after nominal lead time,
for **one review period** (`review_days`, default 30). Its reason names both
horizons. A zero now can coexist with a positive future planned purchase; it
does not cancel that future purchase. Comparing the quantities is contextual,
not a claim that the current planner's future/longer-window order is suboptimal
for its own objective. The stress adapter deliberately executes the separate
order-now scenario at each monthly review using `profit_suggestion.qty`.

## Pure API

Python: `profit_order.suggest(item_inputs)`. JavaScript:
`PROFIT_ORDER.suggest(itemInputs)` in `desktop/profit-order.js` (also CommonJS).
The browser core embeds exactly that JS source; run
`python3 scripts/sync_profit_order.py --check` to verify the mirror.

Inputs:

- Required economics: `unit_cost`, `sale_price`, same currency per unit.
- `on_hand`, `incoming` (both default 0); undated incoming is assumed usable at
  the new order's arrival, not before. Confirm actual delivery dates.
- `lead_days` (default 0), `review_days` (default 30), each 0–3650.
- `annual_holding_pct` (default 20, range 0–100), `ordering_cost` (default 0).
  The engine adapter reuses existing `holding_pct` / `order_cost` settings.
- `MOQ` / `minimum_order` (default 0), `pack` / `pack_size` (default 1), up to six
  decimals. Every output is zero or at least MOQ, on the pack grid.
- Optional `usable_window_days` / `W`, or `shelf_life_days` minus
  `arrival_age_days` minus `min_remaining_life_days`. W ≤ 0 returns zero with a
  cannot-stock reason. `salvage_pct` is the percentage of **cost** recovered,
  default 0. Optional `shelf_cap_qty` is an absolute order ceiling, rounded down
  to pack; an MOQ/cap conflict yields zero, never a silent MOQ uplift.
- Optional dated `receipts: [{day, quantity}]`, offsets in days from today.
  Receipts are supply at the start of their event. Pre-arrival shortages do not
  become debt; shortages before a later receipt still matter. The adapter uses
  the engine's already validated dated supply, excluding receipts already
  reflected in today's stock balance. No receipt is moved early.

Demand input, one of:

1. `demand_paths`: nonnegative post-arrival review-total samples; optionally
   `{lead, demand}` pairs, or daily arrays spanning lead plus usable review.
   Aggregate totals are uniform within their pre/post interval; shorten W by
   truncating the usable part. Daily arrays use whole-day boundaries.
2. The **already produced** monthly `forecast` cloud centre and `history`, with
   deterministic `sku` + `as_of`; a scalar `forecast_mean` is also accepted.
   The adapter reads the existing item projection, not a newly fitted method.
   It shifts to the current planning month when the snapshot is older.

Returns `null`/`None` when economics are missing; otherwise:

```json
{
  "qty": 100,
  "expected_profit": 866.666667,
  "alt": [{"qty": 99, "expected_profit": 863.333333}],
  "reason": "Example only; actual alternatives depend on pack and costs.",
  "critical_ratio": 0.5,
  "method": "simulated"
}
```

Alternatives are the next two distinct evaluated candidates, not promises of
additional profitable options. `expected_profit` is **incremental modeled
profit attributable to the new order**, not profit from all existing stock.
The pure API rejects malformed inputs, non-finite numbers, negative quantities,
unsafe six-decimal quantity grids, and unbounded lists. The integration catches
invalid optional economics and omits the suggestion. Six-decimal integer tick
arithmetic is limited to 2^53−1; larger demands/MOQs are withheld rather than
returning duplicate or off-grid alternatives. Prices and forecast data are
never guessed from missing source values.

## Objective and critical ratio

For each path let D be potential incremental sales after usable existing
supply, with lost demand floored at zero after every supply event. An order q
sells `min(q,D)` incremental units. Approximate holding on incremental unsold
inventory is:

`h = unit_cost × annual_holding_pct / 100 × review_days / 365`.

If W is within the review horizon, unsold units expire, with write-off
`w = unit_cost × (1 − salvage_pct / 100)` per unit. If W is absent or exceeds
review, ending stock remains an asset: w = 0. A long-lived unit is **not**
written off merely because this review ended. Thus:

`profit(q,D) = (price − cost) × min(q,D) − (h+w) × max(q−D,0)
               − ordering_cost × [q>0]`.

Holding is an **end-stock approximation**, not integrated daily unit-days.
Shelf shortening never reduces h (it still uses the same review horizon), so
shorter life cannot spuriously increase an order by lowering holding expense.
The write-off model is a single-cycle model; it does not track future review
sales or the age/expiry of existing lots. Lane E owns lot clearance/usable stock
and passes its shelf cap when present. Existing-lot FEFO/freshest behavior,
random lead times, discounting, taxes, currency conversion and disposal expenses
are not optimized here. Dated receipt netting assumes uniform demand within the
path's pre/post interval; it is not a calibrated daily-demand model.

With positive unit margin m and no fixed cost/MOQ/pack/cap constraint, the
continuous optimum has `F(q*) = m / (m+h+w)`. For expiring stock with no salvage,
this is `(p−c) / (p−c+c+h) = (p−c)/(p+h)`. For durable stock, write-off is zero
and the ratio is `m/(m+h)`: ending stock retains its purchase-cost value.
The reported critical ratio is an unconstrained diagnostic; fixed ordering
cost can favor no order, and constraints can move q away from that quantile.
No positive-margin assumption is silently made: nonpositive margin chooses 0.

For positive orders the empirical objective is concave and piecewise linear.
The search evaluates pack-grid neighbors around its empirical critical
fractile plus MOQ, cap and zero boundaries; it is equivalent to enumerating the
whole valid grid but never loops to trillions of units. MOQ is evaluated even
when above the largest sampled demand. Equal six-decimal expected profit picks
the smaller quantity. Exact critical-ratio plateaus use the lower fractile.
Output profits/ratios use shared half-up six-decimal rounding.

### Hand-worked discrete example

Let D = 80, 100, 120 with equal probability; no existing supply; c=10, p=20,
30-day review and W=30; holding=0, fixed cost=0, pack=1, MOQ=0. m=w=10,
so critical ratio=0.5.

| q | Profit if D=80 | D=100 | D=120 | Expected profit |
|---|---:|---:|---:|---:|
| 80 | 800 | 800 | 800 | 800 |
| 100 | 800−200=600 | 1000 | 1000 | 866.666667 |
| 120 | 800−400=400 | 1000−200=800 | 1200 | 800 |

Hence q=100. With only D=80 and 120 equally likely, every q from 80 to 120
has expected profit 800: the lower-quantity tie rule selects 80. A fixed order
cost exceeding positive-order expected profit instead selects zero.

### Closed-form normal sanity check

Use `Normal(100,20)` truncated at zero (negligible negative tail), c=10,
30-day review/W, 20% holding, no existing supply/fixed cost, pack=1. Then
h=0.164383562. The test uses 200 deterministic stratified normal quantiles,
not an unseeded Monte Carlo test. Tolerance is two units (sampling + grid).

| p | Critical ratio | Normal inverse-CDF q* | Simulated grid q |
|---|---:|---:|---:|
| 12 | 0.164414414 | 80.470488 | 80 |
| 20 | 0.495923913 | 99.795652 | 100 |
| 40 | 0.746930423 | 113.297228 | 113 |

## Sampling, determinism and cost

The Python module imports **read-only** `_seed` / `_next` from `risk.py`; JS
mirrors the existing private `risk.js` FNV-1a-over-Unicode-code-points and
xorshift32 helpers, without changing the risk API or bytes. Circular history
blocks are three months, normalized by history mean and scaled to the supplied
forecast. Empty/all-zero history uses factor 1. Planning months are 30 days,
matching the planner's cover convention, not risk.py's exact calendar event
model. Nominal lead is used; supplier lead variation is not estimated.

There are **96 generated paths per SKU**, with at most **200 supplied paths**. Supplied clouds above 200 are evenly
subsampled deterministically; no extra forecast model is trained. Each path
consumes its lead draw and all demand-block draws through the **full review
horizon**, regardless of shorter W. This keeps paths paired across margin,
holding, salvage and shelf-life experiments. Shrinking W must not shift the
random stream. Inputs and the global random generator are never mutated.

Run focused validation:

```sh
node --test tests/profit-order.test.mjs tests/profit-order-ui.test.mjs tests/profit-integration.parity.test.mjs
python3 -m unittest discover -s tests -p test_profit_order.py -v
python3 scripts/sync_profit_order.py --check
```

The focused suites include closed form, hand calculations, brute-force grid
checks, fractional MOQ/cap boundaries, critical-ratio plateau, dated receipt
gaps, long-life assets, block-boundary shelf monotonicity, invalid/missing data,
1,627 pure parity cases and 100 integrated parity cases. Browser proof is
`node scripts/verify_profit_browser.cjs` after building the page into
`.scratch/profit-order.html`; provide existing local Playwright/browser paths
through its environment variables, never install dependencies for this check.
Performance and independent stress findings are in [PROFIT-ORDER-RESULTS.md](PROFIT-ORDER-RESULTS.md).
