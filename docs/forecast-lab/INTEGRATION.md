# Forecast lab: contract and future integration

## Status and authority

**Phase 3 production adapters are connected locally:** `engine.py`, CLI/bundle bridge, Desktop and generated standalone cores share guarded challenger selection, scale-free scoring, split-conformal diagnostics and optional lead-demand quantiles. This grants no purchasing, ERP, network or deployment authority. The lab's `analyze` remains an experimental API with a distinct selection policy; sections explicitly describing the proposed adapter below are historical design context, superseded by the Phase 3 contract here and `docs/history/changes/phase3.md`.

### Optional external archive (implemented)

Place `forecasts.csv` beside `stock.csv` in an explicitly selected canonical bundle.
Use `stock_runway.py --bundle DIRECTORY --today YYYY-MM-DD` or
`bundle_import.py DIRECTORY --today YYYY-MM-DD > local-bundle.json`; choose that
JSON in the existing Desktop/A3 file picker. A3 accepts `.json` as well as stock
CSV; browsers do not discover sibling files automatically. No external provider
is called. With no archive, input/output bytes remain unchanged.

Required unique headers: `sku,month,p50,p80,p95,source`. Target `month` is YYYY-MM,
all quantities share the SKU stocking unit, and p50 must be finite in [0,1e12].
One source per SKU. After ASCII-space-only trimming, source must match
`[A-Za-z0-9._ -]{1,40}` exactly; tabs, Unicode whitespace and controls reject.
Duplicate SKU/origin/month rows, unknown SKUs, malformed required values, symlinks,
>2 MiB or >10,000 rows discard the entire optional external archive, not the
valid stock bundle. The bridge sets `external_ignored: true`; both health ports
show warning `external_ignored` / **Import ignored**. Native nonblank upper
quantiles must be ordered and bounded. Optional `p80_flag`, `p95_flag` (or common
`flag`) values other than blank/`native`, e.g. `heuristic`, discard that tail
without parsing its numeric contents. Flags and source are preserved.

OWNER-APPROVED Phase 3: `origin` is the last completed training month and is
required for adoption and conformal calibration. Supply an immutable origin/target
archive; every origin must precede its target and match the evaluated prefix.
Missing/blank origins are diagnostic-only, never scored, adopted or calibrated.
Mixed archives never fall back to unvintaged rows. The drawer reports the actual
adopted internal method, not an untested import; if an import-only method row is
introduced it must say **Untested import**. Even explicit origin metadata cannot
prove training provenance. Synthetic oracle fixtures test mechanics, not skill.

External p50 enters the SAME prefix selection origins and next-three-month
windows as internal challengers. All champion folds and a full 12-month future
curve are required; missing folds cannot cherry-pick easy months. It must clear
the existing >=10% MASE gain, no-worse RMSSE/absolute scaled CFE, finite prequential
P80 checks and coverage gate against both production champion and flat mean.
Largest passing relative gain wins in existing fixed tie order, external last;
a failed or incomplete challenger cannot override the internal choice. No gate
waiver for a named provider. Only a selected p50 calendar curve drives planning.

Uploaded p80/p95 are NEVER summed into cumulative order bands, including native
marginal tails: they lack a joint cumulative calibration contract. All displayed
ranges use the existing held-out cumulative split-conformal residuals of the
selected method (including external archived predictions at calibration origins),
optionally same-class peer pooling. Flagged/non-native tails are thus replaced
with conformal intervals, not treated as calibrated service guarantees. A thin
sample with unattainable P95 suppresses the range; no finite tail is invented.

Implementation truth: `forecast_lab/__init__.py`; synthetic contract tests: `tests/test_forecast_lab.py`. Existing integration surfaces inspected: `engine.py` and `desktop/plugin.js`. Product direction: the approved `stock-runway-roadmap-2026-11-12.md` under the research control directory. Do not silently replace existing forecast, run-out, order-by, safety-stock or purchase fields.

## Input contract, calendar and units

- All demand, forecast, error, stock and order quantities must use one consistent SKU stocking unit. Convert buying units explicitly at the boundary; never mix boxes and m². Lab quantities are continuous: no monthly ceiling, pack rounding or MOQ enforcement occurs here.
- `values` and `similar` are **lists** of at most 1,200 finite non-negative numbers, each at most `1e12`; booleans are rejected as quantities. Empty target history is allowed by the lab baseline, not evidence of demand and not equivalent to existing engine eligibility.
- **Caller obligation:** supply chronological, consecutive, completed full months, ending at a validated snapshot month-end. The numeric APIs have no month labels and cannot detect gaps, duplicate calendar months, partial months or misalignment. `clean_demand` validates month syntax and duplicate SKU/month pairs, but does not enforce contiguity or complete a calendar. A missing observation is not automatically a zero-sales month. Reject or explicitly resolve missing data before forecasting; do not compact gaps away.
- Donor history must consist of consecutive full months ending at the **same snapshot** as the target. The overlapping target/donor suffix must represent the same calendar months. A longer donor may include earlier months. Numeric validation does not verify this alignment. At backtest origin `o` with target length `n`, the donor prefix is `similar[:max(0, len(similar) - (n-o))]`; this removes donor months later than that historical origin. Do not pass a donor with a different end date or a future tail.
- `horizon` is an integer, not boolean, from 1 through 120, measured in future months. Existing Desktop `calculate` only accepts 1–12; the adapter must respect the tighter destination limit.
- `scale` is a non-negative multiplier from 0 through 100 (`1.5` means 150% of forecast). It applies to **all** forecast methods, including baseline, not only donors. Keep it separate from cleaning adjustments to avoid applying growth twice.
- `manual_pct` uses **percentage points: `10`, not `.10`, means +10%**; range −100 through 1,000. Probability inputs/outputs use fractions instead: `quantile(..., .8)`, coverage target `.90`, and WAPE `.10` means 10%. `relative_mae_gain` is also a fraction. `service_z` is a z-score, not a percentage; do not pass `95` or `.95` for a 95% target.
- Days are elapsed calendar days. Lab safety calculations use a 30-day month, not the calendar month lengths used by current physical-runout calculations.

## Exact public Python signatures

```python
quantile(xs, p)
clean_demand(rows, *, supersessions=None, transfers=None,
             manual_pct=None, suggest_outliers=False)
eligible(method, values, similar=None)
forecast(values, horizon=1, method='baseline', similar=None, scale=1)
backtest(values, method='baseline', horizon=3, similar=None, scale=1)
pattern(values)
safety_stock(errors, mean_monthly, lead_days=30, review_days=30,
             receipts=None, service_z=1.6448536269514722)
analyze(values, horizon=3, similar=None, scale=1, lead_days=30,
        review_days=30, receipts=None, service_z=1.6448536269514722)
analyze_sku(sku, values, **options)  # same options; adds preserved sku to result
```

`METHODS`, in evaluation/tie-breaking order:
`('baseline', 'seasonal_naive', 'holt_damped', 'seasonal', 'croston', 'sba', 'similar')`.
Underscore-prefixed helpers are implementation details, not an integration API.

### Browser/Node twin

`forecast_lab.js` has no imports or dependencies. CommonJS `require('./forecast_lab.js')` returns the API; loading as a browser script sets `globalThis.StockRunwayForecastLab`. Numeric/list return schemas match Python (Python `None` becomes JS `null`). Positional signatures match Python for `forecast`, `eligible`, `backtest`, `quantile`, `pattern` and `safety_stock`; only keyword-only/options APIs differ:

```js
clean_demand(rows, { supersessions, transfers, manual_pct, suggest_outliers } = {})
analyze(values, { horizon = 3, similar = null, scale = 1,
  lead_days = 30, review_days = 30, receipts = null,
  service_z = 1.6448536269514722 } = {})
```

`analyze_sku(sku, values, options={})` wraps `analyze`, adds the exact nonblank SKU identifier and returns its method, pattern and baseline/selected accuracy with the other fields. It performs no calendar grouping or hidden cleaning.

Undefined optional fields use the Python defaults; unknown options reject. Differential tests recursively compare complete output schemas, strings, flags, traces, selections and all numeric leaves at absolute tolerance `1e-9`. Browser-global loading is checked in `node:vm`, not an installed Desktop/browser integration. Python float totals use an explicit left-to-right fold to match JavaScript rather than version-dependent builtin `sum` behavior (changed in Python 3.12). Invalid calendar-date messages are normalized as `Invalid receipt date`. The parity suite has passed separately against locally existing Python 3.9.6 and Python 3.15.2; set `FORECAST_LAB_PYTHON=/path/to/python3` to choose the oracle without changing other test runtimes.

`quantile(xs, p)` sorts the empirical sample and linearly interpolates at index `(n-1)*p`; `p` must be finite in `[0,1]`. Empty samples return `None`. It does not independently validate every sample value: use validated lab quantities/errors. `forecast` returns a list of `horizon` non-negative numbers; `eligible` returns a boolean. Unknown methods and invalid supported inputs raise `ValueError`; these functions are not a complete hostile-object schema validator, so validate mapping/list shapes at the adapter boundary too.

## Cleaning schema and ordered semantics

Each input row is a dict:

| Field | Meaning / constraints |
|---|---|
| `sku` | Required nonblank string; identifiers are preserved, not trimmed or aliased silently. |
| `month` | Required `YYYY-MM`, year 1000–9999 and month 01–12. Proposed engine adapter must also respect the engine's supported calendar/headroom. |
| `demand` | Required finite non-negative quantity ≤ `1e12`. |
| `in_stock_fraction` | Optional number in `[0,1]`; strongest precedence. |
| `in_stock_days`, `days_in_month` | Optional alternative: days in `[0, days_in_month]`; denominator in `[1,31]`. Caller must check it matches the actual calendar. |
| `daily_stock` | Optional alternative: list of 1–31 observed non-negative daily stocks; fraction is count of values >0 divided by observed count. Caller must assess whether observed days adequately represent the full month. |
| `backorder` | Optional boolean, default `False`; `True` disables quantity uplift. |
| `month_end_stock` | A value equal to zero only flags possible stockout when stronger fraction evidence is absent; it never proves the number of unavailable days. Validate its quantity/type at the adapter boundary. |
| `one_off` | Optional boolean OR numeric exclusion quantity; default `False`. |
| `project_qty` | Optional non-negative exclusion quantity, default zero. |

Optional arguments:

```python
supersessions = {'OLD': 'NEW', 'OLDER': 'OLD'}
transfers = [dict(from_sku='NEW', to_sku='SUB', month='2024-01', quantity=30)]
manual_pct = {'NEW': 10}
```

Input rows are not mutated. The pipeline runs in this exact order:

1. **`stockout_correction`**: evidence precedence is `in_stock_fraction`, else `in_stock_days / days_in_month`, else positive-day fraction from `daily_stock`. Uplift is `demand / max(.25, fraction)`; **the floor is `.25`**, so the largest uplift is 4×. A supplied fraction below `.25` emits `stockout_floor`, even if backorders disable uplift. With `backorder=True`, demand is unchanged. With no fraction evidence and `month_end_stock == 0`, emit `possible_stockout` only; do not invent unavailable days.
2. **`project_exclusion`**: `one_off=True` removes the **entire corrected month**; `project_qty` is not additionally subtracted in this branch. `one_off=False` subtracts only `project_qty`. Numeric `one_off` subtracts **`one_off + project_qty`**, additively, from corrected demand. Exclusions use corrected-demand units, not raw observed-sales units. Reject an exclusion above corrected demand rather than silently clamp it.
3. Optional **outlier suggestions**, after exclusions and before SKU links: at least six rows for a SKU; flag a value strictly above `median + max(6 * 1.4826 * MAD, 3 * max(1, median))`. Emit `outlier_suggestion` only; never delete, winsorize or adjust automatically.
4. **`supersession`**: resolve chains to final targets, reject cycles/invalid targets, zero the source row, and add its demand to the final target's same month (creating that row if needed). Source rows remain present with zero demand. History is moved, not copied. Do not forecast both source and destination as independent active demand.
5. **`substitute_transfer`**: process transfers in supplied order. Both `from_sku` and `to_sku` must already be **final aliases**, not keys in the supersession mapping. They must be distinct, with an existing source/month and quantity no greater than current source demand. Debit source and credit/create destination in that same month. There is no implicit alias rewriting. Validate transfer month syntax at the boundary as well. Supersessions and transfers conserve demand before manual percentage changes.
6. **`manual_change`**: apply the final-SKU percentage with `demand * (1 + pct/100)`. It applies after transfers, including newly created destination rows. Do not attach a percentage to an obsolete alias expecting it to follow the history.

Return schema:

```text
{
  rows:  [{sku: str, month: str, demand: number}],  # sorted by (sku, month)
  trace: [{step: str, sku: str, month: str, before: number, after: number}],
  flags: [{sku: str, month: str, code: str}]
}
```

Trace entries include no-op stockout/exclusion/manual steps as well as actual changes; do not count trace length as adjusted-month count. Every logged adjusted value must be finite in `[0,1e18]`. Downstream `_values` still caps each monthly input at `1e12`; hold an aggregated row that exceeds the forecasting limit rather than assuming cleaning output is forecast-eligible. Cleaning output strips optional input metadata: retain the original evidence and trace separately for the drawer.

## Model definitions, fixed parameters and gates

| Method | Current exact behavior | Eligibility |
|---|---|---|
| `baseline` | Mean of the last up to 12 values, repeated; empty mean is zero. | Always. |
| `seasonal_naive` | Repeat the last 12 observed values in order, cycling for long horizons. | ≥24 target months. |
| `holt_damped` | Additive damped Holt, fixed `alpha=.4`, `beta=.2`, `phi=.9`; initial level `ys[0]`, initial trend `ys[1]-ys[0]`; future trend sums `phi**h`. Non-negative output. No tuning. | ≥3 target months. |
| `seasonal` | Use trailing `floor(n/12)` whole years; normalize each year by its own mean (zero-year indices are all 1), average aligned indices, multiply by last-12-month mean, start at the next-month index. No factor clamp or trend scaling. | ≥24 target months. |
| `croston` | Positive-demand size and interarrival interval smoothed with fixed `.1`; initial interval is first positive index + 1. Constant size/interval forecast; all-zero history yields zero. | ≥3 months and **strictly >50% zero** months. |
| `sba` | Same Croston rate multiplied by `.95` (`1-alpha/2`). | Same intermittent gate. |
| `similar` | Forecast donor with `seasonal` if donor ≥24 months, otherwise `baseline`; then apply `scale`. Target history is not used for the donor projection. | Donor ≥3 months; alignment remains caller responsibility. |

Seasonal **eligibility** at 24 observations is not enough for automatic selection: at each evaluation origin the training prefix must itself have ≥24 months, and at least four eligible origins must beat the benchmark. At exactly 24 months the seasonal candidate has no eligible historical training origins.

`pattern(values)` is descriptive, not a dispatch policy: `<12` → `new`; otherwise >50% zeros → `intermittent`; otherwise ≥24 and mean same-season absolute error < `.7 *` trailing flat absolute error (with flat error >0) → `seasonal`; otherwise first-six vs last-six mean difference > `.3 * max(1, overall mean)` → `trending`; else `smooth`. It is not an ADI/CV² classifier.

### Current engine is a different baseline, not a synonym

The lab's `baseline` is a flat trailing-12 mean. It is **not identical to the current engine seasonal method**, nor its thin-data behavior. `engine.demand_model` / Desktop `demandModel` enable seasonality at **12** months, use last-year calendar factors clamped to `.5–2`, and scale to the most recent three deseasonalized months. With fewer than 12 months, the current level is the last-three mean. `month_demand` / `monthDemand` ceil monthly demand (with integer roundoff correction). The lab's `seasonal` instead needs ≥24, averages normalized whole-year patterns, uses a trailing-year level and does not ceil.

Consequently a lab win against `baseline` proves only a win against that flat benchmark. It does **not** prove improvement over today's engine/plugin. Before any adoption, compare the displayed current-engine method on the same prefixes, calendar windows and final-order rounding. Keep the existing engine behavior as a separately named comparator; do not relabel it `baseline` in a parity report.

## Rolling-origin evaluation and selection

`backtest` returns:

```text
[{origin: int, actual: [number], prediction: [number], errors: [number]}]
```

Origins are zero-based prefix lengths in `range(max(3, n-12), n)`. Train only on `values[:origin]` and the aligned donor prefix. Actuals are the available suffix up to `horizon`; the last folds can be shorter than the requested horizon. Errors are **actual minus prediction**. Fold windows overlap; metric points are not independent observations.

Each metric dict is exactly `{mae, wape, points, origins}`. MAE is sum absolute error / number of forecast points (`None` if no points). WAPE is sum absolute error / sum actual demand, returned as a **fraction**, `None` if total actual demand is zero. No fabricated “100% accuracy” or division-by-zero substitute.

`analyze` considers eligible alternatives in `METHODS` order. For each candidate, compare baseline only on that candidate's origins, with the same requested horizon, scale and truncated final folds. Automatic selection requires:

- At least **four origins** (not four forecast points).
- Both candidate and matched-baseline WAPE defined.
- **Strict improvement in both MAE and WAPE**, each beyond `1e-12`.
- Largest relative MAE gain among passing candidates; a later candidate replaces the winner only when gain exceeds the prior gain by `1e-12`.

Zero-total actual demand, ties, no origins, insufficient origins or no dual-metric improvement retain `baseline`, `badge='basic'`. A selected alternative receives `badge='backtested'`, not “validated” or “high confidence.” Pattern `new` does not authorize bypassing the gate: `similar_proposal` may suggest a donor forecast but cannot silently become the order forecast. Direct `forecast(..., method='similar')` is an explicit projection, not proof that selection accepted it.

## `analyze` exact output schema

```text
{
  method: one of METHODS,
  pattern: 'new' | 'intermittent' | 'seasonal' | 'trending' | 'smooth',
  badge: 'basic' | 'backtested',
  forecast: [number],                         # length horizon
  accuracy: {
    selected: Metric, baseline: Metric,
    relative_mae_gain: number,
    candidates: {method: {
      selected: Metric, baseline: Metric, beats_baseline: bool
    }},
    note: 'selection OOS; not independent final validation'
  },
  uncertainty: [Band],                        # marginal monthly demand
  aggregate_uncertainty: [Band],              # cumulative demand through h
  safety_stock: Safety,
  similar_proposal: [number] | None
}
Metric = {mae: number | None, wape: number | None, points: int, origins: int}
Band = {
  horizon: int, lower: number, upper: number,
  lean: number, recommended: number, stock_up: number,
  samples: int, label: 'rough empirical range',
  coverage: {rate: number | None, samples: int, target: .90}
}
Safety = {
  quantity: number | None, error_rmse: number | None,
  error_bias: number | None, error_samples: int, protection_days: number,
  demand_variance: number | None, lead_variance: number,
  lead_time: {
    enabled: bool, samples: int, mean_days: number | None,
    sd_days: number | None, slow_days: number | None
  },
  label: 'approximate cycle-service buffer'
}
```

Only currently eligible candidates appear in `accuracy.candidates`. Selected/baseline headline metrics describe the winner's matched origins; when baseline remains selected they describe all baseline folds. `similar_proposal` is populated whenever the full donor is eligible, even without target evaluation evidence.

## Uncertainty, cumulative demand and coverage

For monthly horizon `h`, collect the displayed method's h-step rolling-origin errors from folds long enough to contain that step. The band is `max(0, forecast[h-1] + empirical_quantile(error_h, p))`:

- `lower`: empirical **P05**; `upper`: **P95**, a nominal central 90% error-derived range.
- `lean`: **P50 — Lean**; `recommended`: **P80 — Recommended**; `stock_up`: **P95 — Stock-up**. `upper == stock_up`.
- These are error-adjusted demand scenarios, not pack-rounded orders or verified service probabilities. Lean need not equal the point forecast when errors are biased.

**`aggregate_uncertainty` must use cumulative errors, NOT sums of marginal quantiles.** For each complete h-step fold use `sum(fold.errors[:h])`, then add its empirical quantile to `sum(forecast[:h])` and clamp once at zero. This preserves the historical within-fold joint error sums. Summing monthly P80 or P95 bounds is not the implemented cumulative distribution and can badly misstate risk. For a whole-month purchasing window use the matching cumulative row. A fractional/calendar-day window needs a separately tested cumulative-error adapter; do not claim that multiplying a marginal quantile by days is calibrated.

Coverage is **prequential**: for an error at origin `o`, only older errors whose h-step outcomes have matured (`older_origin + h <= o`) can estimate bounds; at least four such past errors are required. Test inclusive P05/P95 containment; `coverage.samples` counts these checks, `rate` is hits/checks or `None` when no checks. `samples` counts errors used for the current empirical band, not coverage checks. The historical check is performed on error quantiles before non-negative demand clipping.

This does not remove **model-selection bias**: the final method was chosen using the same rolling-origin data later summarized for bands and coverage. Cleaning or donor decisions made using later knowledge may introduce further leakage. Errors overlap, samples are small, tails interpolate rather than establish rare-event frequencies, and regime changes invalidate exchangeability. Empty error samples currently collapse the band to the point forecast; this means **unknown uncertainty**, not certainty. Keep `rough empirical range` visible and show sample counts. Independent nested/held-out selection and prospective coverage are prerequisites for stronger claims. MAE/WAPE wins alone do not establish good intermittent-stock decisions.

## Safety stock: exact units and assumptions

The implementation is exactly:

```text
SS = z * sqrt(
    RMSE_month^2 * (E[L] + R) / 30
    + (mean_monthly / 30)^2 * sigma_L_days^2
)
```

`RMSE_month = sqrt(mean(error**2))`, not demeaned error SD and not raw sales SD. `error_bias = mean(errors)` is reported separately; persistent bias requires investigation, not a “noise” label. `analyze` supplies only the **one-step errors** of its displayed selected method and `mean_monthly = mean(future forecast)`. It does not pool all multistep errors for this buffer.

- `errors`: list of finite signed monthly errors in `[−1e18, 1e18]`; `mean_monthly`: `[0,1e18]`.
- `lead_days`, `review_days`: finite `[0,3650]`; `service_z`: finite `[0,4]`. Default z is `1.6448536269514722`, an approximate one-sided 95% normal **cycle-service** setting.
- `receipts`: `None` or list of `{ordered_date: 'YYYY-MM-DD', received_date: 'YYYY-MM-DD'}`. Dates must be real ISO dates; elapsed span must be 0–3650 days. These are completed historical PO-to-receipt observations, **not** a monthly receipt-quantity map or future open receipts. Validate as-of cutoff and deduplicate receipt/PO events before calling; the lab does not check those business rules.
- At **≥5 receipts**, `E[L]` becomes the mean observed span and `sigma_L_days` is **sample SD**, denominator `n-1`. `slow_days` is the interpolated P95 of spans. Supplied `lead_days` is then replaced for the buffer's typical horizon, not automatically for order-by dates elsewhere.
- With fewer than five receipts, `lead_time.enabled=False`, `mean_days`, `sd_days` and `slow_days` are `None`; use supplied `lead_days` and zero lead-time variance. Still show `samples` and that variability is unavailable; do not imply the supplier is perfectly reliable.
- No error observations → `quantity`, `error_rmse`, `error_bias`, `demand_variance` are `None`, not a zero buffer. Lead metadata and protection days may still be present.

Assumptions: approximately independent, stationary forecast errors and lead-time uncertainty, no demand/lead correlation, stable units, representative receipts, and a normal/z approximation for the buffer interpretation. Scaling monthly error variance by days/30 is a **heuristic daily-scaling assumption with a 30-day month**; monthly data does not establish independent daily increments. Seasonality, autocorrelation, variable review timing, promotions, intermittent tails and structural changes can violate it. The formula estimates **cycle service**, NOT fill rate, OTIF, guaranteed availability or the fraction of units supplied. No fill-rate optimization is implemented.

## Proposed future engine and Desktop wiring — not active

1. **Boundary/data health:** preserve current validated snapshot/month labels and unit checks; materialize a full monthly calendar per final active SKU. Keep originals, cleaning choices and flags immutable for audit. Missing cleaning evidence must not imply stockout correction; missing receipt dates must disable spread, not block basic CSV use. Validate proposed changes against the approved roadmap's hidden/locked/on per-feature gates.
2. **One demand pipeline:** call `clean_demand` once, resolve final aliases once, select each active SKU's aligned values and donor once, then call `analyze`. Keep `similar_proposal` separate until the target-origin selection gate passes or an explicit, labelled human scenario is chosen. Do not apply `manual_pct` again through `scale`. Future committed/project demand is a separate dated add-back layer; it is not implemented by the historical exclusion API.
3. **Engine boundary:** introduce a separate lab adapter, with explicit method/version and calendar metadata, rather than changing `demand_model` silently. Existing `inventory_planning` uses raw-demand population SD for its buffer and current-engine demand for reorder point; neither is equivalent to lab `Safety`. Existing `safety_order_planning` and calendar/runout paths derive their own current model. Merely attaching `analyze` results cannot make them lab-driven: thread the same adopted demand series through projection, physical crossing, date and purchase windows in a separately authorized integration change.
4. **Quantity contract:** the existing rounding boundary is:

   ```python
   suggested_order_quantity(forecast_demand, on_hand, receipts, override=None,
       *, safety_stock=None, include_backup_in_orders=False, on_order=0)
   ```

   `forecast_demand` is the **one chosen demand target over the declared purchase window**, `receipts` a list of quantities included by the window policy, `override` contains optional `minimum_order` and `pack_size`. The function nets stock, on-order and receipt quantities, optionally adds the buffer, then applies MOQ/packs through exact-decimal/Fraction rounding. Invalid increments/unrepresentable final results return `None`; do not turn that into zero. Avoid subtracting the same incoming PO as both dated `receipts` and undated `on_order`. The lab itself supplies none of that receipt-allocation policy.
5. **Choose one risk policy, explicitly:**
   - **Empirical scenario path:** `forecast_demand = aggregate_uncertainty[h-1]['lean' | 'recommended' | 'stock_up']` for the matching whole-month window; pass `include_backup_in_orders=False` (and no added safety quantity). P80/P95 already include empirical error uplift. **Never add the separate safety-stock buffer on top of P80/P95** as an accidental second protection allowance. P50 is also an error-adjusted scenario, not necessarily the expected-demand path.
   - **Expected-demand + analytic buffer path:** use `sum(forecast[:h])` (or a verified calendar-window integration), and optionally pass `Safety.quantity` as `safety_stock` with `include_backup_in_orders=True` after checking it is available and matches the intended protection horizon. Do not also replace expected demand with P80/P95. Show this as an alternative risk policy, not another layer on the same scenario. Neither empirical demand scenarios alone nor the current buffer formula fully simulate uncertain delivery dates.
6. **Desktop parity:** current `calculate`, `demandModel`, `inventoryPlanning` and `snapshotSafety` remain untouched. A future bridge must deliver the same adopted lab numbers to Desktop using the unwired `forecast_lab.js` twin or a shared payload. Its lab parity tests do not prove end-to-end order wiring; Python/JS existing model parity is not lab parity. Keep `as_of`, projection dates and receipt timing explicit. Do not label existing `monthly_demand`, `projection`, `suggested_order` or `why` as lab outputs while their producers still use the old model.
7. **Why drawer, not a larger main screen:** retain product/status/order quantity/order-by/chart. Map outputs exactly as follows; preserve unrounded figures inside the drawer and round only the final purchase quantity.

| Lab output / adapter evidence | Drawer or order use |
|---|---|
| `method`, `pattern`, `badge` | Method name, descriptive pattern, basic/backtested label; not a guarantee. |
| `accuracy.selected`, `.baseline`, `.relative_mae_gain`, `.candidates` | Matched-origin comparison, WAPE displayed as fraction ×100%, MAE units, origins/points, why fallback won. Include selection-bias note. |
| Cleaning `trace` and `flags` | Named waterfall: observed demand → stockout uplift → project exclusion → supersession/transfer → manual adjustment; no-op steps are not adjustments. |
| `forecast` | Adopted monthly continuous point forecast and expected-demand window; same series must drive displayed chart/date/order calculations. |
| `uncertainty` | Monthly P05/P95 chart band, labelled rough, with sample counts and prequential coverage. |
| `aggregate_uncertainty` | Matching cumulative P50/P80/P95 demand scenario selected for order target; never sum marginal quantiles. |
| `safety_stock` | Alternative analytic buffer, RMSE/bias, lead/review days, receipt count/SD and assumptions; show whether included, not available or deliberately excluded to avoid double counting. |
| `similar_proposal` | Labelled donor suggestion with donor identity/alignment/scale; not accepted order demand by default. |
| Stock/eligible incoming/MOQ/pack adapter fields | Exact netting waterfall: chosen window demand (+ buffer only in analytic policy) − usable stock − incoming counted once → positive need → MOQ/pack → final quantity. These fields are not lab output. |

No PO creation, ERP write-back, network dependency, automatic project deletion, new settings on the main screen or unconditional behavior change is part of this document.

## Golden numeric examples and local verification

The following expectations were derived by executing Python against the current lab/engine, not by hand arithmetic. They are synthetic contracts, not live ERP validation. Assert integer/structural results exactly and floating results with a documented tight tolerance (e.g. `pytest.approx`), not display-rounding equality.

| Input / operation | Expected result |
|---|---|
| A Jan demand 100, 15/30 in-stock days, project 20; B Jan 10; supersede A→B; transfer B→C quantity 30; B manual +10 | Sorted cleaned rows: A `0.0`, B `176.0`, C `30.0`. Correction precedes exclusion, links precede percentage. |
| Jan demand 10, fraction `.01` | `40` with `stockout_floor`. |
| Jan demand 10, fraction `.5`, `backorder=True` | `10`. |
| Jan demand 10, only `month_end_stock=0` | `10` with `possible_stockout`. |
| `forecast([12]*12, 3)` | `[12, 12, 12]`. |
| `forecast(list(range(1,25)), 2, 'seasonal_naive')` | `[13, 14]`. |
| `analyze([0]*36, horizon=3)` | `method='baseline'`, `badge='basic'`, forecast `[0,0,0]`; headline baseline MAE `0.0`, WAPE `None`, origins `12`, points `33`. |
| `analyze([10]*36, horizon=3)` | Baseline/basic, forecast `[10,10,10]`; no strict improvement possible. |
| `analyze([], similar=[10]*24, scale=1.5)` | Baseline/basic, pattern `new`, forecast `[0,0,0]`, donor `similar_proposal=[15,15,15]`; no promotion without target evidence. |
| Constant 36-month history, horizons 1/2/3 | Band error samples `12/11/10`; prequential coverage samples `8/6/4`. |
| `safety_stock([2,-2,2,-2], 30, 30, 30, service_z=2)` | RMSE `2.0`, bias `0.0`, protection `60.0`, demand variance `8.0`, lead variance `0.0`, quantity `5.656854249492381`. |
| Same errors/mean/lead/review/z; receipts ordered Jan 1 and received Jan 11/21/31/21/21, 2024 | Five spans enable lead spread: mean `20.0`, sample SD `7.0710678118654755`, P95 span `28.0`; protection `50.0`, demand variance `6.666666666666667`, lead variance about `50.0`, quantity `15.055453054181621`. |
| Same receipts truncated to four | `lead_time.enabled=False`; use supplied lead, not sample mean/SD. |
| No errors: `safety_stock([],30,30,30)` | `quantity=None`; do not present as measured zero risk. |

Local check executed with bytecode and pytest cache writes disabled:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider tests/test_forecast_lab.py
```

Observed: **17 passed, exit 0**. This does not test a future adapter, final-order lab wiring, Desktop rendering or real-data accuracy. Future adoption requires shared engine/Desktop golden fixtures for contiguity/alias failures, corrected demand, cumulative errors, risk-policy exclusion, fractional windows, stock/incoming netting and final MOQ/pack quantities, plus a before/after comparison against the current engine method.

## Research references — inherited evidence, not freshly verified

Research root: maintainer research notes (not published).

Read local notes: **`lane-1-planning-specialists.md`** (L1) and **`lane-3-practice-pain-trust.md`** (L3). The links below are references recorded there, **not external sources reopened or freshly verified for this document**. Preserve their evidence grades; vendor statements, snippets and individual complaints are not independent performance proof. The specific lab thresholds/parameters are local engineering choices, not claimed vendor replicas.

- **Stockout correction/backorder caveat:** L1 S2, Inventory Planner [Stockouts](https://help.inventory-planner.com/en/articles/2242706-stockouts), recorded vendor docs, partially truncated; L3 S5, Afresh [censored demand](https://medium.com/afresh-engineering/accounting-for-censored-demand-in-sales-forecasting-bdc77192802d), limited opened text. These motivate evidence-based correction, not the exact local `.25` floor.
- **Project handling/model families/baseline challenge:** L1 S27, Prediko [Demand Forecasting & Planning](https://www.prediko.io/forecasting-demand-planning), vendor guide. L3 S11, [Forecast Value Added Analysis](https://demand-planning.com/2018/02/12/what-is-forecast-value-added-analysis), partial trade-publisher source. Do not borrow reported vendor WAPE as a lab result.
- **Explain order arithmetic/keep demand distinct from order:** L1 S13, GMDH [Inventory Planning in General](https://gmdhsoftware.com/documentation-sl/ordering-plan-calculation-general), partially opened vendor docs; L1 S3, Inventory Planner [vendor attributes](https://help.inventory-planner.com/en/articles/4388315-adjusting-replenishment-for-vendor-attributes). Motivation for an exact why waterfall, not evidence this adapter exists.
- **Error-derived bands and error-based buffers:** L1 S15, GMDH [Confidence intervals](https://gmdhsoftware.com/documentation-sl/confidence-intervals); L1 S12, [Safety Stock Calculation](https://gmdhsoftware.com/documentation-sl/safety-stock-calculation), vendor docs with truncation noted. GMDH's fit-error/normal recipe differs from this lab's rolling-origin empirical quantiles.
- **Risk horizon and cycle service vs fill rate:** L3 S2, Vandeput [Four Biggest Mistakes](https://nicolas-vandeput.medium.com/the-4-biggest-mistakes-when-using-the-safety-stock-formula-1f3cc93bcb1), recorded opened; L3 S3 LinkedIn material and S4 demandplanning.net RMSE discussion were **snippets only**. L1 S23 [EazyStock whitepaper](https://eazystock.com/wp-content/uploads/2024/05/US_WP_How-to-calculate-safety-stock-for-inventory-management.pdf), partial vendor source, records combined demand/lead variance. L3 explicitly did not verify that exact combined formula on an opened page. Our formula above is grounded in current local code, not a claim of fresh external validation.
- **Coverage/uncertainty caution:** L3 S10, [FPP prediction intervals](https://otexts.com/fpp2/toolbox.html), recorded **snippet only**; L3 S7, Svetunkov [SBC is not for you](https://openforecast.org/2025/06/04/sbc-is-not-for-you), recorded opened academic commentary. Neither source validates these small-sample bands or selection procedure.

Python/JS lab parity was subsequently verified with seven Node tests and 1,452 complete-output comparisons at absolute numeric tolerance 1e-9. This includes a browser-global VM load, not an actual browser UI.

Not checked: live ERP/data, prospective calibration, independent real-data final model validation, current external source contents, Desktop rendering, production wiring or deployment. Forecast lab remains unconnected.

Phase 2 feature 3 update (2026-11-13): only `clean_demand` exposure correction is now
connected through the validated opt-in history adapter documented in
[phase2.md](../history/changes/phase2.md). The actual Python/JS cleaning source is used;
raw observations and calendar eligibility remain distinct. The proposed forecast
method-selection/uncertainty integration above is still NOT connected. Projects,
manual changes and other cleaning options are not enabled by this adapter.

Phase 2 feature 4 update: the validated adapter now also maps complete explicit
project flags to the lab's whole-month exclusion, retaining independent calendar
eligibility. Eligible-history outlier suggestions are diagnostic only and cannot
alter the adopted quantities. Manual changes and forecast method selection remain
NOT connected. See [phase2.md](../history/changes/phase2.md) for the current implemented scope.
