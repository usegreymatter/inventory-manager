Lifecycle: living

# Profit suggestion — synthetic validation results

## Status

**Experimental; not a universal service-level improvement. Default remains off.**
The single-cycle objective passed hand calculations, normal critical-ratio,
monotonicity and exact Python/JS checks. Independent daily simulation shows
substantial waste/profit gains for short-lived stock, **but worse fill for
7/14-day stock and intermittent parts**. Do not automatically replace current
quantities or approve an ordering policy from this report.

The suggestion has a 30-day review, whereas the current planner's cover arms
range from 0.25 to 2 months. These are intentionally different policy questions,
not a claim that simulation beats an identical-window optimizer. Monthly review
is particularly unsuitable for 7/14-day usable life. Consider more frequent
actual review rather than interpreting less waste as adequate service. No
engine tuning used the held-out demand generators.

## Independent stress execution

Harness: `<local-scratch>/v12/stress/run_all.sh`.
Baseline: public v1.1.0 snapshot in its `baseline/`. Candidate engine revision:
`d342c1e`. The candidate explicitly executed `profit_suggestion.qty` using
`--quantity-field profit_suggestion.qty --settings profit-settings.json --shelf-life`,
with settings exactly `{"profit_suggestion":true}`. All 37 independent harness
tests passed before each run.

12 families: ten perishable arms (7/14/30/90/365 days × FEFO/freshest), steady,
and intermittent parts. 30 paired seeds × four covers (0.25/0.5/1/2) ×
stockout-adjust off/on = **2,880 scenarios per policy**. Net profit is revenue
minus sold COGS, daily holding and expiry write-off; lost margin is diagnostic,
not subtracted again. Money is arbitrary synthetic units, not a real business
forecast. No terminal liquidation. Monthly reviews are not secretly daily
reorders, including for short-life products.

Brackets below are 95% CIs from 1,500 paired bootstrap resamples of seed-indexed
equal-weight family means. Family intervals resample its 30 seeds. Positive
profit/fill delta is better; negative write-off delta is better. Mixed-family
averages are a synthetic screen, not a sales-weighted real portfolio.

## All arms: candidate minus baseline

Fill differences are **percentage points**; money is annual synthetic currency.

| Cover | Stockout adjust | Net profit Δ [95% CI] | Fill pp Δ [95% CI] | Write-off Δ [95% CI] |
|---|---|---:|---:|---:|
| 0.25 | 0 | 1494.51 [1454.87, 1534.98] | 13.31 [13.07, 13.54] | -679.08 [-702.04, -658.38] |
| 0.25 | 1 | 1519.97 [1480.80, 1558.17] | 13.44 [13.18, 13.68] | -679.08 [-702.04, -658.38] |
| 0.5 | 0 | 1359.06 [1321.90, 1399.08] | 5.40 [5.17, 5.63] | -1003.76 [-1034.78, -976.82] |
| 0.5 | 1 | 1373.17 [1337.67, 1410.02] | 5.47 [5.24, 5.70] | -1003.76 [-1034.78, -976.82] |
| 1 | 0 | 1646.21 [1597.90, 1701.05] | -3.99 [-4.15, -3.85] | -1827.11 [-1878.30, -1783.28] |
| 1 | 1 | 1654.86 [1605.84, 1710.12] | -3.95 [-4.11, -3.82] | -1827.11 [-1878.30, -1783.28] |
| 2 | 0 | 3810.24 [3725.82, 3910.50] | 1.44 [1.09, 1.78] | -3702.90 [-3792.11, -3625.86] |
| 2 | 1 | 3856.38 [3775.01, 3948.48] | 1.99 [1.72, 2.26] | -3719.49 [-3808.86, -3642.54] |

## Default-cover arm: absolute outcomes

Current method, 2 months cover, adjustment off. The candidate still executes
the separate 30-day-review order-now action, not a changed default planner.

| Metric | Baseline [95% CI] | Candidate [95% CI] |
|---|---:|---:|
| Net profit | 949.69 [799.05, 1095.88] | 4759.93 [4634.83, 4887.29] |
| Fill % | 71.23 [70.88, 71.58] | 72.68 [72.45, 72.88] |
| Write-off value | 3774.69 [3696.66, 3864.86] | 71.79 [68.57, 74.78] |

## Default-cover arm: paired family differences

| Family | Net profit Δ [95% CI] | Fill pp Δ [95% CI] | Write-off Δ [95% CI] |
|---|---:|---:|---:|
| intermittent_parts | -136.57 [-397.78, 79.70] | -2.30 [-3.75, -1.09] | 0.00 [0.00, 0.00] |
| perishable_14_fefo | 8347.42 [7751.34, 8927.01] | -12.41 [-13.38, -11.69] | -8815.60 [-9412.40, -8208.87] |
| perishable_14_freshest | 8505.81 [7953.70, 9097.88] | -12.45 [-13.02, -11.97] | -8991.00 [-9618.27, -8406.27] |
| perishable_30_fefo | 4834.11 [4518.24, 5170.48] | 31.27 [28.35, 34.15] | -3415.47 [-3627.80, -3229.67] |
| perishable_30_freshest | 4658.02 [4327.71, 5005.65] | 29.45 [26.89, 32.04] | -3305.27 [-3526.73, -3099.60] |
| perishable_365_fefo | 35.14 [29.18, 40.59] | -0.21 [-0.34, -0.10] | 0.00 [0.00, 0.00] |
| perishable_365_freshest | 42.75 [34.45, 51.15] | -0.10 [-0.28, 0.07] | -1.20 [-5.53, 2.27] |
| perishable_7_fefo | 9671.42 [9073.63, 10250.78] | -6.78 [-7.11, -6.47] | -9937.80 [-10536.27, -9331.67] |
| perishable_7_freshest | 9619.40 [9116.02, 10094.49] | -7.75 [-8.24, -7.30] | -9932.33 [-10425.40, -9411.27] |
| perishable_90_fefo | 34.92 [25.52, 43.57] | -0.21 [-0.42, -0.02] | 0.00 [0.00, 0.00] |
| perishable_90_freshest | 37.40 [9.21, 66.04] | -1.04 [-1.36, -0.71] | -36.13 [-56.73, -14.53] |
| steady | 73.07 [49.50, 94.99] | -0.15 [-0.34, 0.03] | 0.00 [0.00, 0.00] |

Largest default-arm fill regression: 14-day freshest-first (-12.45 pp; CI entirely
negative). Intermittent parts has a negative profit delta with CI including
zero, and a fill CI entirely negative. Steady demand has modest profit gains
and a small fill decrease with CI including zero. Waste savings dominate
aggregate gains: **the aggregate does not clear a service acceptance gate**.

## Evidence handles

Synthetic files outside the repository:

- `.../v12/stress/results/lane-o-baseline.json`
- `.../v12/stress/results/lane-o-profit-96.json`
- `.../v12/stress/results/lane-o-profit-96-compare.json`

The comparator verified the exact paired scenario universe and unchanged
simulator/adapter/evaluator fingerprints. Recorded candidate product digest:
`6f1e18b857bf487381304ef6a620af4fac0eab901eeedf046492f21e39be9417`. That digest covers the harness's
recorded product files; the Git revision above also binds the new pure module.
The earlier developmental `lane-o-profit` run predates review fixes; the
`lane-o-profit-final` run used the superseded 200-path budget. Neither is final
evidence. The final 96-path default-arm mean net profit differs from the
200-path run by +0.023%; this was a latency change, not held-out model tuning.

## Focused and real-browser checks

- 15 Python tests including 200 exhaustive-grid comparisons, normal closed form,
  fractional MOQ/cap boundaries, ties, dated-receipt gaps and shelf monotonicity.
- 1,627 pure Python/JS cases (clouds, daily paths, null/invalid inputs, receipts,
  unsafe precision), plus 100 integrated forecast/guidance parity cases.
- Exact embedded source: `python3 scripts/sync_profit_order.py --check`.
- Isolated Chrome Beta 159.0.8154.13 at 1440 and 390 CSS px: native switch,
  default/off absence, detail and side-panel lines, original amount unchanged,
  reload persistence, no document horizontal overflow. Zero page exceptions,
  zero HTTP(S) requests. `.scratch/profit-browser-report.json` and
  `.scratch/profit-{1440,390}.png` retain the evidence.
- Real CLI on a synthetic CSV: JSON on/off and CSV `--explain` all exited 0;
  ordinary order stayed 260, separate suggestion 111, absent when off.

## Performance

96 generated paths per SKU, at most 200 supplied paths. Focused Node
pure-module demo-1000 time: 36.71 ms.
That throughput fixture normalizes intentionally held/missing-stock rows to
exercise 1,000 calls; it does not claim those rows passed import validation.
Actual whole-engine benchmark (`scripts/benchmark_profit_order.py`): five
paired off/on runs over all 1,000 items, 980 eligible suggestions, **median added
219.42 ms** (declared median acceptance limit: 300 ms; exit 0). Paired added times
were 219.42, 199.25, 409.01, 1665.41 and 153.67 ms. Thus the median gate passes,
but not every timing observation was below 300 ms; the worst was 1665.41 ms.
No hard worst-case interactive latency guarantee is established. Full samples
are in `.scratch/profit-perf-final.json`. The initial un-memoized 200-path
whole-engine median was 712.45 ms; request-scoped exact-spec memoization plus
the 96-path cap fixed the measured median budget without altering defaults.

## Remaining gates

The normal full suites are recorded in [PROFIT-ORDER-VERIFICATION.md](PROFIT-ORDER-VERIFICATION.md).
Generated HTML stays untouched by contract, so generated-byte/source-pin guards
remain expected failures until integration rebuild. No golden expectations were
rewritten. No default purchase quantity was intentionally changed.

Not checked: live inventory or money, real ordering, Safari/iPhone, existing-lot
age-specific FEFO optimization, random supplier lead times, or combinations
with separately merged preset/expiry/automatic-method/cost-view lanes. Hosted
app unchanged. This is not owner approval to ship or accept service regressions.
