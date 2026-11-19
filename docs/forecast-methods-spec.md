# Opt-in forecast methods: deterministic reference contract

## Scope and evidence boundary

`forecast_methods.py` and `forecast_methods.js` are standalone, opt-in libraries.
They do not import or modify `engine.py`, `plugin.js`, the UI, build pipeline, or
`forecast_lab`. Importing either module performs no I/O. The existing default
forecast, existing policy/adoption gates, and frozen November actuals are
unchanged. The engine/Desktop adapters and standalone build consume this library
only after an explicit method choice; importing it cannot replace `current` or enable automatic selection. No July–September holdout,
customer series, network access, dependencies or installation informed these
rules. Synthetic contract/parity checks establish implementation agreement, not
forecast accuracy or suitability for a business.

The damped Holt and Croston/SBA recurrences follow the existing offline
`forecast_lab` implementations, without importing its eligibility rules or
changing that lab. Other methods are deliberately small, explicitly specified
variants, not numerical equivalents of a third-party statistical package.

## Public interface

Python:

```python
from forecast_methods import forecast, classify, METHODS, METHOD_LABELS, PRESETS
forecast([10, 12, 9], horizon=12, method='ses')  # list of monthly quantities
classify([10, 12, 9])                         # dict below
```

JavaScript uses the identical argument order and defaults. CommonJS:
`const {forecast, classify} = require('./forecast_methods.js')`.
A direct browser script exposes `globalThis.StockRunwayForecastMethods`.

`forecast_with_metadata(values, horizon=12, method="ses")` is mirrored with the
same name/arguments in JavaScript. It returns `{forecast, classification, method,
fallback}` from the **same numerical path** as `forecast`: `method` identifies the
actual fitted recurrence (including internal multiplicative-seasonal SES
fallback), not an adapter eligibility guess; `fallback` compares the actual and
selected recurrence after resolving Auto. Adapters also report an explicit
Current fallback when cleaning/history eligibility is incomplete.
There is no runtime dependency, date/calendar lookup, randomness, persistent
state, learned model, or implicit data cleaning. Inputs must already represent
consecutive, equally spaced, observed monthly periods. Zero is observed zero,
not a missing/censored month. Neither API imputes missing observations.

`METHODS`, in stable order (intentionally excludes `current`):

```
auto naive seasonal_naive ma3 ma6 ma12 ses holt_damped
hw_additive hw_multiplicative theta croston sba tsb adida combination
```

`METHOD_LABELS` maps every method slug to its human-readable label.
`PRESETS` maps the lower-case slugs `distributor`, `retail`, `spare-parts`,
`restaurant`, `pharmacy`, `seasonal`, `ecommerce` to `{method, note}`. Methods are
respectively `auto`, `ses`, `sba`, `ma3`, `auto`, `hw_additive`, `theta`.
Presets are advisory starting points, not validated sector defaults. Pharmacy
notes make no clinical, expiry, availability or patient-safety claim. No preset
accounts for shelf life, regulation, clinical criticality or procurement policy.

### Validation and numerical contract

- `values`: Python list / JS array, length 0–1200, with finite numeric values in
  `[0, 1e12]`. Reject booleans, strings, nulls/None, negative quantities,
  NaN/infinity, nested values and JS sparse-array holes. Do not coerce or truncate.
- `horizon`: integer 1–120 (booleans rejected). Unknown methods are rejected even
  for empty/all-zero histories. Python raises `ValueError`; JS `RangeError`.
- A valid forecast always contains exactly `horizon` finite, nonnegative point
  estimates, clipped to `[0, 1e12]`. Empty or all-zero inputs give all zeros for
  every method. These are continuous quantities, not rounded purchase packs.
- Internally divide history by its maximum to protect sums/squares. Preserve a
  positive underflowed ratio as the smallest positive IEEE-754 subnormal
  (`5e-324`), so tiny positive events still count toward ADI/occurrence. This does
  not preserve meaningful amplitude precision across extreme dynamic ranges.
- Use sequential IEEE-754 additions and identical recurrence order in both ports.
  Damping powers are advanced by repeated multiplication, not platform `pow`.
  Public forecast values and numeric classifier diagnostics are rounded to nine
  decimal places using `floor(abs(x)*1e9 + .5)/1e9`, restoring the sign for trend.
  This is positive half-up, **not Python's built-in bankers' rounding**.
  Absolute decimal precision is necessarily coarser for large binary64 values;
  nine decimal digits are a quantization policy, not nine guaranteed exact digits
  at `1e12`. Tiny forecasts can round to zero. Classification thresholds use
  unrounded internal diagnostics, so displayed values at a boundary may conceal
  sub-decimal differences. No `sqrt` is required by the specified methods.
- Inputs are never mutated. Complexity is linear in history plus horizon with
  small fixed grids/seasonal period; no method searches arbitrary parameter sets.

## Method definitions and disclosed fallbacks

Notation: `y[0..n-1]` is the normalized history; `h=1..H`; `mean([])=0`;
all clipping/rescaling/rounding occurs at the final public forecast boundary.
The first nonzero event exists whenever an intermittent method executes, because
all-zero history is handled at the public boundary.

| Slug | Definition / fallback |
|---|---|
| `naive` | Repeat the last observation. |
| `seasonal_naive` | Repeat the last 12 observations, starting with the observation 12 months before the next forecast. With fewer than 12 months, use naive. |
| `ma3`, `ma6`, `ma12` | Repeat the mean of the latest min(n, window) observations, including zeros. No recursive moving-average updates. |
| `ses` | Initialize level to y[0]. For each alpha in `{.1,.2,...,.9}`, evaluate one-step SSE on y[1..n-1] **before** updating `l += alpha*(y-l)`. Choose the smallest SSE; ascending alpha wins exact ties. Repeat its final level. No future/horizon-specific fitting. |
| `holt_damped` | Fixed alpha=.4, beta=.2, phi=.9. Initialize level=y[0], trend=y[1]-y[0]. Update `l=.4*y+.6*(old_l+.9*b)` then `b=.2*(l-old_l)+.8*.9*old_b`. Forecast `l + b*sum(phi**j,j=1..h)`. With n=1 use SES. |
| `hw_additive` | Damped additive Holt–Winters, period 12, alpha=.3, beta=.1, gamma=.2, phi=.9. Requires n>=24; otherwise SES. Initialization and recurrence below. |
| `hw_multiplicative` | Same fixed coefficients, multiplicative seasonal factors. Requires n>=24 **and every observation strictly positive**; otherwise SES (not additive). Also SES if initialized/updated normalized level or a consumed seasonal factor is <=1e-12, or updated level is nonfinite. |
| `theta` | Simplified non-seasonal Theta-style level+drift variant: fitted SES level plus `h * (OLS slope of y on observation index)/2`. This is not a full optimized/deseasonalized Theta package. |
| `croston` | Alpha=.1 for positive sizes and interarrival intervals. First positive at zero-based index f initializes size=y[f], interval=f+1. For later positives at i, `z+=.1*(y[i]-z)`, `p+=.1*(i-previous_positive-p)`. Forecast z/p. Trailing zeros do not decay it. |
| `sba` | Croston as above, multiplied by `1-alpha/2 = .95`. |
| `tsb` | Initialize size=y[f], occurrence probability=1/(f+1). For every subsequent month, update `p+=.1*(I(y>0)-p)`; on positive months only, `z+=.1*(y-z)`. Repeat p*z. Observed trailing zeros decay probability; hypothetical future months are not treated as observed zero. |
| `adida` | Fixed aggregation size `k=clamp(floor(ADI+.5),1,12)` (ties up). Drop n%k **oldest** observations, sum each remaining complete k-month block, fit SES to those sums, divide the final level by k, repeat. Uniform disaggregation; no seasonality within blocks. Can discard a positive event in the oldest partial block; disclosed rather than padded. |
| `combination` | Per-horizon median of unrounded SES, Theta and damped Holt forecasts; final clipping/rounding happens once. No learned weights. |
| `auto` | Invoke the fixed classifier table below and run exactly that method. No benchmark ranking, tuning, cross-SKU borrowing or post-hoc performance selection. |

### Damped seasonal recurrences

Initialize `l=mean(y[:12])`, `b=(mean(y[12:24])-l)/12`. Seasonal slots
`j=0..11` start as `s[j]=y[j]-l` (additive), or `y[j]/l` (multiplicative).
Process observations starting at index 12 (the second year), through the last
observation, using slot `j=i%12`:

- Additive: `l=.3*(y-s[j])+.7*(old_l+.9*old_b)`;
  `s[j]=.2*(y-l)+.8*old_s[j]`.
- Multiplicative: `l=.3*(y/s[j])+.7*(old_l+.9*old_b)`;
  `s[j]=.2*(y/l)+.8*old_s[j]`, with the SES guards above.
- Both: `b=.1*(l-old_l)+.9*.9*old_b`.

For horizon h, slot `(n+h-1)%12` combines additively/multiplicatively with
`l + b*sum(.9**j,j=1..h)`. At least two years is an eligibility guard, not evidence
of stable seasonality. Initialization uses both years already in the supplied
history; this API does not return leakage-safe historical fitted forecasts.

## Classifier and fixed auto rule table

`classify(values)` returns exactly:

```
{class, adi, cv2, history_months, seasonality_strength, trend, method}
```

- `history_months=n`, including observed zero months.
- ADI = n / positive-observation count. CV² = **population** variance of positive
  sizes divided by squared positive-size mean (zeros excluded from size
  variance, included in ADI). Implementation uses equivalent relative deviations
  `(size/positive_mean - 1)^2`. Both diagnostics are null without positive events.
- `trend` = OLS slope per monthly index divided by the whole-history mean;
  zero for empty/all-zero input. It is a relative per-month slope, not a
  categorical direction, growth guarantee or forward compound rate.
- `seasonality_strength=0` with n<24 or no positive events. Otherwise remove the
  whole-history OLS linear slope, group residuals by index modulo 12, and compute
  `clamp(1 - sum((residual-phase_mean)^2)/sum((residual-residual_mean)^2),0,1)`.
  If normalized total variation <=1e-20, use zero. This is an in-sample,
  detrended phase-variance heuristic, **not STL**, a significance test or a
  validated seasonal detection guarantee. Two-year noise can appear seasonal.

Apply the following rules in priority order (not tuned to a benchmark):

| Priority | Condition | class | method |
|---|---|---|---|
| 1 | n<12, including empty/all-zero short history | `new` | `ses` |
| 2 | No positive observations, n>=12 | `inactive` | `naive` |
| 3 | At least 4 positive historical months and trailing zero run >= max(6, ceil(3 × ADI before that run)); OR n>=18, >=6 positives in preceding 12 months and latest-six mean <=25% of preceding-12 mean | `dying` | `naive` |
| 4 | n>=24 and seasonality strength >=.6 | `seasonal` | `hw_additive` |
| 5 | ADI<1.32 and CV²<.49 | `smooth` | `ses` |
| 6 | ADI<1.32 and CV²>=.49 | `erratic` | `combination` |
| 7 | ADI>=1.32 and CV²<.49 | `intermittent` | `sba` |
| 8 | ADI>=1.32 and CV²>=.49 | `lumpy` | `adida` |

Dying demand uses the **latest observed level**, not old seasonal slots or slow-decaying historical positive sizes. The former three-month decline flag was removed: ordinary intermittent zero runs are not obsolescence. These fixed sustained-decline/relative-zero-run heuristics remain experimental and can confuse stock-outs with declining demand. They were not selected on the protected holdout.

The four bottom classes are the Syntetos–Boylan threshold taxonomy. The `dying`
rule is a disclosed decline heuristic, not proof of obsolescence; stock-outs,
exclusions, closures and reporting gaps can create the same history. Short
history takes precedence over decline/seasonality. `new` describes history
length, not product launch age. Diagnostics are returned even when another
priority wins. No rule asserts a specific method is best for a class.

## Opt-in safety stock basis (engine/Desktop adapters)

`Sales variation` is the unchanged default. `Past forecast misses (experimental)` uses only the product’s own eligible history and the selected method, refitted at each strictly earlier prefix. Take the latest at most 24 complete rolling errors for `ceil((lead+review)/30)` months. If fewer than 8 complete cumulative errors exist, or the window exceeds the library’s 120-month cap, use rolling one-step errors; if fewer than 8 errors remain or the history is locked/ineligible, disclose fallback to Sales variation. Signed error is actual minus forecast (positive is underforecast).

Sort errors and use rank `min(n, ceil((n+1)*requested_service_level))`, clamp the chosen error at zero, and multiply by `sqrt(protection_months/error_window_months)`. Combine observed receipt lead variance in quadrature with the existing z coefficient, then apply existing planning ceilings. Report sample count, window, requested level, capped rank and nominal order-statistic coverage `rank/(n+1)`. The nominal statistic assumes exchangeability and does **not** establish actual coverage: overlapping windows, short histories, changed regimes and sqrt-time scaling can invalidate it. No cross-SKU pooling or guaranteed service claim.

Only this explicit setting changes the buffer. The same existing planner consumes it for trigger and purchase quantity. Current forecasts, default safety stock, input-size caps and historical imports are unchanged. Method/classification fits are pass-scoped and keyed by item, as-of, method and exact cleaned values; edited values and date changes invalidate. JS phase means use identical per-phase addition order without twelve repeated array filters.

## Verification and limits

Focused commands (stdlib Python; existing Node executable only):

```sh
/usr/bin/python3 -m unittest discover -s tests -p test_forecast_methods.py -v
node --test tests/forecast-methods.parity.test.mjs
node --check forecast_methods.js
git diff --check
```

The parity suite uses a fixed-seed synthetic generator and boundary fixtures,
with at least 500 histories, **every** method and the complete classifier.
It compares the public nine-decimal results by exact deep equality, not a
permissive tolerance, and prints actual vector/point counts. It also checks
metadata equality, validation, input immutability, deterministic repeatability,
browser-global packaging and auto delegation. Python tests independently check
recurrences, thresholds, seasonal phase, fallbacks and numerical bounds.

These checks do not validate holdout accuracy, real-data calibration, runtime
performance on a full catalog, lost-sales adjustments, uncertainty, service
levels, financial value, expiry management, clinical safety, or ordering policy.
The library does not calculate inventory, lead time, safety stock or orders.
No engine/plugin/UI/build integration or live activation is part of this packet.
