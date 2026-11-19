# Forecast laboratory — synthetic benchmark

**Refreshed for Phase 3 finite-tail semantics. Local synthetic experiment only; synthetic ≠ real.** Production adapters exist, but this runner benchmarks the lab `analyze` policy against its flat baseline, not the production champion, external archive hook or purchase policy.

## Reproduce

```sh
export TMPDIR="$PWD/.scratch"
mkdir -p "$TMPDIR"
python3 scripts/synth_demand.py --seed 20261112 --skus 500 --output .scratch/synthetic.json
/usr/bin/python3 scripts/benchmark_forecast_lab.py --seed 20261112 --skus 500 --output docs/forecast-lab/benchmark_results.json
python3 -m pytest -q
node --test tests/*.test.mjs
```

Checked-in evidence: `benchmark_results.json`. Exactly 500 distinct synthetic SKUs, 50 per pattern, 27,450 observed rows, and 1,400 disjoint three-month outer folds. Regular SKUs have 60 fixed monthly observations (2020–2024); new items have nine. Pair members count toward 500. The seed is fixed; no clock or live services are used.

## Evaluation design

- Outer prefix lengths are 51, 54 and 57 for regular SKUs, and 6 for new items. Each predicts three withheld months. Training uses observed rows strictly before the cutoff. Latent uncensored routine demand is read only after forecasts to score the holdout; projects/one-offs are excluded from the target.
- Historical preprocessing uses the actual `clean_demand` pipeline, including the 0.25 stockout floor, project exclusion, supersession and substitute moves. Maps are assumed known metadata. Substitution restores intended demand from the fulfilling substitute, conserving units. No custom median imputation replaces the lab pipeline.
- Optional **manual** +10% metadata is generated and contract-tested, but not applied in method-skill scoring: it is an operator assumption, not latent truth. Forecast scales are one here.
- Every method is paired with baseline on its exact eligible folds. WAPE = total absolute error / total actual units; MAE is in synthetic units. Croston/SBA need >50% zeros; seasonals need 24 training months. “—” means ineligible, not zero error. The strict all-method fold intersection is also in JSON; usually empty because Croston/SBA are ineligible on non-intermittent patterns.
- `similar` uses the first other same-pattern donor, no optimized scale or future data. Donor volumes differ. Production donor choice/scale is a business input, not something this benchmark validates.
- At each outer origin `analyze(prefix)` freezes selection before its held-out final 12-month calibration tail, then refits that method on prefix history. Its selection uses the Phase 3 scale-free gate (MASE, RMSSE, scaled CFE and prequential P80 coverage). Outer outcomes are unseen by selection. Scenario design and explicit pattern/link metadata remain synthetic and known. This is not a benchmark of the production calendar champion gate.

## Every method versus trailing-12 mean

WAPE percentages, rounded only for this table. Eligible-fold matched baseline and MAE differences follow. This flat baseline is **not** the existing engine’s seasonal/recent-three method; wins here do not prove improvements over today’s UI.

| Pattern | baseline | seasonal_naive | holt_damped | seasonal | croston | sba | similar |
|---|---:|---:|---:|---:|---:|---:|---:|
| intermittent | 164.75% | 169.58% | 164.45% | 168.21% | 171.68% | 168.02% | 123.41% |
| new | 12.38% | — | 18.50% | — | — | — | 70.36% |
| project | 9.76% | 13.68% | 11.47% | 10.45% | — | — | 79.16% |
| ramadan_shifting | 41.16% | 14.01% | 86.81% | 29.95% | — | — | 71.70% |
| seasonal | 42.64% | 13.69% | 63.10% | 11.43% | — | — | 69.46% |
| smooth | 9.60% | 13.30% | 10.70% | 10.56% | — | — | 58.93% |
| stockout | 10.15% | 15.21% | 11.59% | 11.69% | — | — | 42.59% |
| substitute | 9.31% | 13.22% | 10.81% | 10.54% | — | — | 91.81% |
| supersession | 9.37% | 12.97% | 10.33% | 10.44% | — | — | 104.61% |
| trending | 12.63% | 17.91% | 11.22% | 19.90% | — | — | 43.87% |

### Matched MAE: every method and pattern

Improvement = paired baseline MAE − method MAE; positive is better.

| Pattern | Method | Eligible folds | MAE | Paired baseline MAE | Improvement |
|---|---|---:|---:|---:|---:|
| intermittent | baseline | 150 | 71.705 | 71.705 | +0.000 |
| intermittent | seasonal_naive | 150 | 73.807 | 71.705 | -2.101 |
| intermittent | holt_damped | 150 | 71.575 | 71.705 | +0.130 |
| intermittent | seasonal | 150 | 73.214 | 71.705 | -1.508 |
| intermittent | croston | 150 | 74.721 | 71.705 | -3.016 |
| intermittent | sba | 150 | 73.130 | 71.705 | -1.425 |
| intermittent | similar | 150 | 53.714 | 71.705 | +17.991 |
| new | baseline | 50 | 9.209 | 9.209 | +0.000 |
| new | seasonal_naive | 0 | — | — | — |
| new | holt_damped | 50 | 13.760 | 9.209 | -4.551 |
| new | seasonal | 0 | — | — | — |
| new | croston | 0 | — | — | — |
| new | sba | 0 | — | — | — |
| new | similar | 50 | 52.320 | 9.209 | -43.111 |
| project | baseline | 150 | 7.413 | 7.413 | +0.000 |
| project | seasonal_naive | 150 | 10.396 | 7.413 | -2.983 |
| project | holt_damped | 150 | 8.711 | 7.413 | -1.299 |
| project | seasonal | 150 | 7.938 | 7.413 | -0.525 |
| project | croston | 0 | — | — | — |
| project | sba | 0 | — | — | — |
| project | similar | 150 | 60.147 | 7.413 | -52.735 |
| ramadan_shifting | baseline | 150 | 24.818 | 24.818 | +0.000 |
| ramadan_shifting | seasonal_naive | 150 | 8.449 | 24.818 | +16.369 |
| ramadan_shifting | holt_damped | 150 | 52.340 | 24.818 | -27.522 |
| ramadan_shifting | seasonal | 150 | 18.059 | 24.818 | +6.758 |
| ramadan_shifting | croston | 0 | — | — | — |
| ramadan_shifting | sba | 0 | — | — | — |
| ramadan_shifting | similar | 150 | 43.231 | 24.818 | -18.413 |
| seasonal | baseline | 150 | 34.746 | 34.746 | +0.000 |
| seasonal | seasonal_naive | 150 | 11.158 | 34.746 | +23.588 |
| seasonal | holt_damped | 150 | 51.416 | 34.746 | -16.671 |
| seasonal | seasonal | 150 | 9.316 | 34.746 | +25.429 |
| seasonal | croston | 0 | — | — | — |
| seasonal | sba | 0 | — | — | — |
| seasonal | similar | 150 | 56.596 | 34.746 | -21.851 |
| smooth | baseline | 150 | 8.180 | 8.180 | +0.000 |
| smooth | seasonal_naive | 150 | 11.329 | 8.180 | -3.149 |
| smooth | holt_damped | 150 | 9.112 | 8.180 | -0.933 |
| smooth | seasonal | 150 | 8.997 | 8.180 | -0.817 |
| smooth | croston | 0 | — | — | — |
| smooth | sba | 0 | — | — | — |
| smooth | similar | 150 | 50.203 | 8.180 | -42.024 |
| stockout | baseline | 150 | 8.733 | 8.733 | +0.000 |
| stockout | seasonal_naive | 150 | 13.098 | 8.733 | -4.364 |
| stockout | holt_damped | 150 | 9.980 | 8.733 | -1.247 |
| stockout | seasonal | 150 | 10.063 | 8.733 | -1.330 |
| stockout | croston | 0 | — | — | — |
| stockout | sba | 0 | — | — | — |
| stockout | similar | 150 | 36.660 | 8.733 | -27.927 |
| substitute | baseline | 150 | 7.360 | 7.360 | +0.000 |
| substitute | seasonal_naive | 150 | 10.449 | 7.360 | -3.089 |
| substitute | holt_damped | 150 | 8.545 | 7.360 | -1.185 |
| substitute | seasonal | 150 | 8.334 | 7.360 | -0.974 |
| substitute | croston | 0 | — | — | — |
| substitute | sba | 0 | — | — | — |
| substitute | similar | 150 | 72.565 | 7.360 | -65.205 |
| supersession | baseline | 150 | 4.402 | 4.402 | +0.000 |
| supersession | seasonal_naive | 150 | 6.093 | 4.402 | -1.691 |
| supersession | holt_damped | 150 | 4.857 | 4.402 | -0.455 |
| supersession | seasonal | 150 | 4.908 | 4.402 | -0.506 |
| supersession | croston | 75 | 0.000 | 0.000 | +0.000 |
| supersession | sba | 75 | 0.000 | 0.000 | +0.000 |
| supersession | similar | 150 | 49.166 | 4.402 | -44.764 |
| trending | baseline | 150 | 20.709 | 20.709 | +0.000 |
| trending | seasonal_naive | 150 | 29.373 | 20.709 | -8.664 |
| trending | holt_damped | 150 | 18.398 | 20.709 | +2.312 |
| trending | seasonal | 150 | 32.646 | 20.709 | -11.936 |
| trending | croston | 0 | — | — | — |
| trending | sba | 0 | — | — | — |
| trending | similar | 150 | 71.949 | 20.709 | -51.240 |

## Nested selection: unseen outer demand

| Pattern | Folds | Baseline MAE | Selected MAE | Selected WAPE | MAE change |
|---|---:|---:|---:|---:|---:|
| intermittent | 150 | 71.705 | 67.417 | 154.90% | -5.98% |
| new | 50 | 9.209 | 9.209 | 12.38% | +0.00% |
| project | 150 | 7.413 | 7.496 | 9.87% | +1.12% |
| ramadan_shifting | 150 | 24.818 | 23.834 | 39.53% | -3.97% |
| seasonal | 150 | 34.746 | 18.936 | 23.24% | -45.50% |
| smooth | 150 | 8.180 | 8.201 | 9.63% | +0.26% |
| stockout | 150 | 8.733 | 8.771 | 10.19% | +0.43% |
| substitute | 150 | 7.360 | 7.478 | 9.46% | +1.60% |
| supersession | 150 | 4.402 | 4.408 | 9.38% | +0.13% |
| trending | 150 | 20.709 | 19.014 | 11.59% | -8.18% |

The gate is a historical comparison, not a guarantee. Selection improves seasonal, invented shifting-event, trending and intermittent aggregate errors here, but slightly degrades smooth/project/stockout/substitute/supersession errors. New items retain baseline. Do not tune to turn synthetic rows green.

## Outer-holdout band coverage

P95 is unattainable with these per-SKU calibration counts: rank ceil((n+1)×.95) exceeds n. Null upper bounds suppress the interval, never become zero, infinity, a hit or a miss. Coverage and mean width are null when there are no finite intervals. The previous interpolated finite-coverage table is withdrawn, not a comparable coverage result.

| Pattern | Finite intervals h1/h2/h3 | Suppressed intervals h1/h2/h3 | Minimum samples h1/h2/h3 | Coverage h1/h2/h3 |
|---|---:|---:|---:|---|
| intermittent | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| new | 0/0/0 | 50/50/50 | 3/2/1 | null/null/null |
| project | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| ramadan_shifting | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| seasonal | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| smooth | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| stockout | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| substitute | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| supersession | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |
| trending | 0/0/0 | 150/150/150 | 12/11/10 | null/null/null |

Across 1,400 outer folds, all 4,200 marginal interval opportunities are suppressed; **zero finite P95 intervals**, not zero coverage and not perfect coverage. At least 19 residuals are needed for a finite one-sided P95. This runner does not pool peers; production diagnostics may pool eligible same-class SKU residuals.

Inner prequential coverage uses only matured previous errors. Lab Lean=P50, Recommended=P80 and Stock-up=P95 are demand scenarios, not fill-rate promises or orders. In production the Recommended label remains the actual planner quantity, not a claimed P80. Cumulative windows require quantiles of cumulative residuals, never sums of marginal tails or a second analytic safety buffer.

## Limits and future release gates

- **Synthetic ≠ real:** fixed slopes, Gaussian noise, invented event timing and explicit metadata are controlled fixtures, not representative distributor data. Ramadan-shifting is an invented 11.6-month cycle, **not actual Hijri calendar data**, a GCC forecast or a construction-market claim.
- Supersession includes 25 **retired** identifiers and 25 successors. Retired zero rows make aggregate scores easier; do not rank its MAE as business benefit. History moves to the successor, never to two active demand streams.
- MAE/WAPE may prefer near-zero forecasts on intermittent demand. `similar` can win synthetic intermittent folds because donor levels differ; that is not proof of fewer stockouts or better service. No fill-rate, cash, cost or order simulation is included.
- Inner samples are at most 12/11/10 h1/h2/h3 errors and often fewer. Overlapping windows, selection bias and regime changes weaken tail estimates; finite-sample suppression prevents an invented rare-event estimate.
- Dated receipt spread is validated with deterministic five-receipt golden tests, not supplier data or delivery-policy simulations. Safety stock uses the displayed method’s one-step OOS RMSE, mean lead plus review, and sample lead spread. Daily-scaling, independence and cycle-service assumptions and research references are in `INTEGRATION.md`.
- Adoption needs validated aligned full months and final aliases, the exact current-engine comparator, frozen independent export holdouts, calibration and inventory-policy checks, no scenario-plus-buffer double counting, final-only MOQ/pack rounding, shared engine/Desktop order goldens and owner approval.

## Refresh notes and verification scope

The original runner crashed on `float(None)` after split-conformal P95 suppression.
It now separates total, finite and suppressed points, validates non-null bounds,
and formats null rates without claiming coverage. Seed/SKU count and all raw
candidate MAE/WAPE metrics match the prior checked-in JSON exactly. Selected-method
metrics changed because the installed lab now uses the Phase 3 selection/calibration
split and scale-free gate; the runner was not retuned. No production forecast code
was changed by this benchmark refresh.

Fresh targeted verification: `tests/test_synth_demand.py`: 12 passed, including
mixed finite/null tails, invalid non-null bounds, preserved point-error metrics
and the real conformal runner. The 500-SKU command above completed successfully.
Full repository and offline A3 gates are recorded in `docs/history/changes/phase3.md`.

Not checked: live ERP, real-data accuracy, external-provider training provenance,
prospective coverage, supplier-history quality, inventory-policy cost/service,
Safari/Firefox, physical touch devices, deployment or remotes.
