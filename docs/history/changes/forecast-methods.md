# Round 2 — opt-in corrections and equal-budget diagnostic

**Current stays unchanged. Synthetic evidence only; no production default promotion.** This section supersedes the Round-1 Auto conclusions below; the older report is retained as an archive, not overwritten as if it were final-code evidence. No July–September 2026 holdout was fitted, scored or tuned in these development runs. The five repository sample rows remain pre-July only.

## Diagnosis and fix

On the frozen 3,000-series design, old Auto classified the 900 dying-process origins as 600 dying / 300 smooth. Its short-term decline flag expired during long observed-zero runs; even where the flag fired, TSB retained old positive-demand sizes and decayed slowly. This is **both classification and method mismatch**. The 17 supported-calendar holds are a separate planner symptom on the 5k cold-load fixture, not 17 omitted benchmark cases: neither old nor fixed Auto had a hold in the 600-case fixed-origin benchmark. No failed planner cases are dropped.

Auto now uses sustained recent-six versus preceding-twelve decline, or a zero run at least max(6, ceil(3 × pre-run ADI)) with four positive historical months, before seasonal routing. Dying uses naive (latest observed level), never seasonal-naive or stale positive sizes. The old three-month trough rule is removed: it mislabelled 144 seasonal origins and many normal sparse zero runs. All 900 seasonal origins now retain seasonal routing. Fixed Auto identifies 899/900 dying origins; it still mislabels 32/900 intermittent and 62/900 lumpy origins, so this remains an experimental heuristic, not proof of obsolescence. A first naive zero-run attempt was rejected by independent review for excessive false positives; the final sparse-history regression test covers that failure.

### Paired Auto before → fixed (3,000 series; 9,000 prefix origins; 600 inventory cases)

| Process | MASE before → fixed | RMSSE before → fixed | Fill before → fixed | Avg inventory before → fixed |
|---|---:|---:|---:|---:|
| overall | 1.0305 → 0.8696 | 1.3115 → 1.1911 | 0.9087 → 0.9069 | 149.7961 → 141.4244 |
| smooth | 0.7504 → 0.7504 | 0.7556 → 0.7556 | 0.9580 → 0.9580 | 103.4158 → 103.4158 |
| erratic | 0.8287 → 0.8278 | 0.9110 → 0.9117 | 0.8732 → 0.8640 | 287.0670 → 278.9982 |
| intermittent | 1.0122 → 1.0097 | 0.7405 → 0.7428 | 0.8278 → 0.8214 | 109.1592 → 109.4434 |
| lumpy | 1.1725 → 1.1513 | 1.6156 → 1.6183 | 0.6345 → 0.6045 | 102.9681 → 99.2859 |
| seasonal | 1.7185 → 1.0352 | 1.8049 → 0.9980 | 0.9931 → 0.9931 | 176.9196 → 166.9381 |
| new | 2.2346 → 2.2346 | 2.7825 → 2.7825 | 0.7788 → 0.7788 | 93.1079 → 93.1079 |
| dying | 0.7977 → 0.0001 | 0.7761 → 0.0033 | n/a → n/a | 75.5239 → 16.5684 |
| trend | 0.5766 → 0.5766 | 0.6469 → 0.6469 | 0.9265 → 0.9265 | 203.4707 → 203.4707 |
| structural_break | 0.6078 → 0.4988 | 0.5912 → 0.4234 | 0.9742 → 0.9742 | 226.8922 → 224.3015 |
| censored | 0.6059 → 0.6115 | 0.5195 → 0.5281 | 0.8865 → 0.8833 | 119.4365 → 118.7142 |

Default Current and **all 15 explicitly named non-Auto method rows** are numerically identical to the before run in every process, including inventory outcomes. Auto’s dying inventory falls 75.5239 → 16.5684 (Current 17.9570); MASE 0.7977 → 0.0001353 (Current 0.0307). Dying targets are all zero: fill rate and percentage bias are unavailable, not perfect. Lumpy fill falls 0.6345 → 0.6045 at the unscaled policy; no universal improvement is claimed.

## Equal-inventory comparison and efficient-frontier experiment

Run `/usr/bin/python3 -m forecast_lab.equal_budget --count 3000 --inventory-per-class 5 --output .scratch/round2/equal-budget.json --markdown .scratch/round2/equal-budget.md`. The frozen generator is unchanged. To bound the more expensive 34-configuration budget sweep, its **separately predeclared first five SKUs per process** (50 SKUs, 150 paired origins) are used rather than the 20-per-class ordinary accuracy/inventory subset. Do not compare the two subsets’ pooled inventory totals as if they were identical. The five-row pre-July sample is reported separately.

Every library method plus Current is compared with **both** safety bases (34 configurations), at 0.8x/1x/1.2x Current average end-of-day inventory value. A single nonnegative safety-buffer multiplier is shared by all cases within each method/group/budget. Bisection changes only the existing production buffer; the existing planner still owns trigger, timing and rounded quantity. The cached-buffer seam is independently tested equal to unmodified production at multiplier 1. Actual targets, gaps, multipliers, no-execution holds, sampled monotonicity and denominators are preserved in JSON.

Matched means inventory gap <=0.5%; zero-buffer floors, multiplier-128 ceilings, discrete/date-switch gaps and observed non-monotonicity are **unmatched/inconclusive**, not hidden wins. No negative safety stock, extra disposable stock, favourable dropped cases or post-hoc per-SKU multipliers manufacture an equality. A pure safety multiplier cannot achieve every budget; in particular Auto/new is above its feasible floor, and dying has no demand and no way to force the chosen buffer into an executed order. Best-other selection is in-sample across many configurations and is **selection-biased diagnostic evidence**, not a validated recommendation.

| Class | Current fill / days / value | Auto-fixed fill / days / value | Best matched other, selected in-sample (fill / days / value) |
|---|---|---|---|
| overall | 82.40% / 9.17 / 134.87 | 86.93% / 6.72 / 134.62 | auto+misses: 86.71% / 7.82 / 134.61 |
| censored | 82.23% / 17.00 / 102.82 | 82.86% / 15.20 / 103.02 | theta+misses: 83.57% / 15.80 / 103.32 |
| dying | n/a / 0.00 / 20.40 | n/a / 0.00 / 20.01 [UNMATCHED] | n/a (no matched demand-bearing comparator) |
| erratic | 75.84% / 4.93 / 367.34 | 77.76% / 3.33 / 367.90 | hw_additive: 85.07% / 5.20 / 368.12 |
| intermittent | 48.12% / 6.87 / 79.96 | 73.44% / 2.87 / 79.78 | croston+misses: 77.23% / 2.73 / 79.96 |
| lumpy | 38.71% / 8.00 / 52.72 | 54.62% / 4.20 / 52.74 | seasonal_naive: 62.92% / 4.47 / 52.64 |
| new | 58.75% / 34.67 / 45.19 | 69.37% / 27.13 / 55.79 [UNMATCHED] | ma6: 60.22% / 34.07 / 45.19 |
| seasonal | 89.06% / 4.40 / 112.16 | 97.27% / 1.27 / 112.16 | seasonal_naive: 99.51% / 0.47 / 112.02 |
| smooth | 96.76% / 2.33 / 131.39 | 97.11% / 2.27 / 130.91 | seasonal_naive: 97.96% / 1.80 / 131.93 |
| structural_break | 81.93% / 7.27 / 212.21 | 96.88% / 1.33 / 211.75 | ma3+misses: 99.62% / 0.20 / 213.13 |
| trend | 93.43% / 6.20 / 224.53 | 92.82% / 6.73 / 223.75 | hw_additive: 94.60% / 5.13 / 225.49 |



### Overall three-point budget frontier

| Target vs Current | Configuration | Fill rate | Stock-out days/case | Actual inventory | Matched |
|---|---|---:|---:|---:|---|
| 0.8x | current | 0.7830 | 11.3133 | 108.1918 | True |
| 0.8x | auto | 0.8425 | 8.3267 | 107.5423 | True |
| 0.8x | current+misses | 0.7886 | 11.7667 | 108.0592 | True |
| 0.8x | auto+misses | 0.8493 | 8.5867 | 107.6186 | True |
| 1.0x | current | 0.8240 | 9.1667 | 134.8728 | True |
| 1.0x | auto | 0.8693 | 6.7200 | 134.6189 | True |
| 1.0x | current+misses | 0.8068 | 10.8067 | 134.2438 | True |
| 1.0x | auto+misses | 0.8671 | 7.8200 | 134.6091 | True |
| 1.2x | current | 0.8609 | 7.3267 | 161.8563 | True |
| 1.2x | auto | 0.8968 | 5.1133 | 161.4988 | True |
| 1.2x | current+misses | 0.8301 | 9.9733 | 161.5315 | True |
| 1.2x | auto+misses | 0.8829 | 7.0400 | 161.4354 | True |

At 1x overall, Auto-fixed improves fill **82.40% → 86.93%** and reduces stock-out days **9.17 → 6.72** within the stated inventory tolerance. Per-class matched Auto gains both service metrics in censored, erratic, intermittent, lumpy, seasonal, smooth and structural-break cases in this subset; trend is worse, new is unmatched, and dying service is unavailable. The best-other column sometimes raises fill while worsening days (e.g. erratic additive seasonal smoothing); that is a tradeoff, not dominance. Full 34-method, 11-group, three-budget curves are in the reproducible JSON, not just the selected winners.

### Does forecast-miss safety stock reach the requested service with less stock?

**Not established; no general stock-saving win.** This is a fixed-origin one-order ledger, not a cycle-service calibration study. A requested 95% cycle service level is not 95% unit fill. At multiplier 1, Auto Sales variation yields fill 0.8908 / inventory 154.5760; Auto Past forecast misses yields fill 0.9160 / inventory 232.3163. More stock buys higher service here, not less stock. At equal spend, Auto+misses fill 0.8671 / days 7.82 versus Auto Sales variation 0.8693 / days 6.72: the experimental basis does **not** dominate. It can help some classes/methods (see table), but its requested target is not validated. Past forecast misses stays opt-in; Sales variation stays the unchanged default.

## Experimental buffer, performance and forward protocol

One new setting in the existing Forecast method group: **Safety stock basis → Sales variation (default) / Past forecast misses (experimental)**. It persists, resets, imports/exports and names the actual basis/fallback on the product page. The [shared specification](../../forecast-methods-spec.md) defines own-history rolling cumulative errors, min-eight fallback, capped finite-sample quantile, sqrt-time approximation, receipt lead variance and exact Python/JS contract. It explicitly does not promise calibrated service.

The November protocol is [DRAFT, owner approval pending](nov-2026-preregistration.md), with ten frozen candidate/basis configurations and hashed local scorer. November alone gives an accuracy checkpoint; the three-month decision replay remains PENDING until complete November–January actuals exist. A separate synthetic fixture exercises both paths. No real export was opened.

Performance and final gate receipts are recorded in [verification](forecast-method-verification.md). No cold-load speedup is inferred from merely adding cache keys: timings must support it.

### Raw receipts

- `.scratch/round2/before.json` SHA-256 `ff54c2d065ec8c4066c9a93daaadeb08b56feacec2530bd84a42654979de45f6`.
- `.scratch/round2/after.json` SHA-256 `0e0b141ad48add2378f0735312cee6e49fae63629074de4a6a7def6afe4e0bd9`.
- `.scratch/round2/equal-budget.json` SHA-256 `7cf859e1691e7984485e224086e38bba96a497364deef7c2ecb46a17bbb4416e`.
- `.scratch/round2/diagnosis.json` SHA-256 `ac6e098b7f7b625ce407b3ff05d134ad2d3e0e868c7b818afeab1537e6ea8bf0`.

Not checked: live ERP/plugin, real devices or customer inventory, July–September holdout, forward actuals, calibrated cycle service, operational monthly replanning, actual-stock/cost replay adapter or any deployment.

---

# Archived Round 1 — forecast method comparison: offline diagnostic

## Scope and interpretation

This is a deterministic synthetic diagnostic, **not production validation**. BEFORE is the actual current `engine._forecast` default: steady histories use the engine's 12-month mean, other histories its clamped calendar-seasonal / recent-three-month hybrid. AFTER evaluates every `forecast_methods.METHODS` entry, including Auto and combination, on identical origins. The Current default is frozen; alternatives are explicitly opt-in in the engine, Desktop, standalone and CLI. No July–September 2026 holdout tuning occurred.

Reproduce from this worktree, without installs or network:

```sh
/usr/bin/python3 -m unittest discover -s tests -p test_methods_benchmark.py
/usr/bin/python3 -m forecast_lab.benchmark_methods --count 3000 --inventory-per-class 20 --output "$TMPDIR/methods-benchmark.json" --markdown "$TMPDIR/methods-benchmark-tables.md"
```

## Formulas, Auto rules and integration limits

The shared [method specification](../../forecast-methods-spec.md) is the authoritative formula/parameter and rule table for both languages: SES SSE-grid fitting, damped Holt/Holt–Winters, simplified Theta level-plus-drift, Croston/SBA/TSB, ADIDA, the median combination, ADI/CV² and seasonal/trend diagnostics. All methods use chronological monthly observations and deterministic nonnegative nine-decimal outputs. Seasonal smoothing needs 24 months; thin/unsafe multiplicative fits explicitly report SES fallback. Auto is a fixed class-to-method table, not benchmark-optimized selection.

The same selected curve drives projection, run-out, deadline and purchase windows; existing replenishment formulas do not change. The first forecast year repeats beyond 12 months. Incomplete/locked observation histories retain Current and give a fallback reason rather than compacting missing months. Existing Current-calibrated ranges/risk are withheld for alternatives, not silently relabelled. Optional industry suggestions set a method only, not expiry/service/MOQ policy. See [controls](forecast-method-controls.md), [5k performance](forecast-method-performance.md), and [verification](forecast-method-verification.md).

## Frozen synthetic design

Seed `20261118`; 3,000 unique series, 300 per generator class. Each series has its own `random.Random(seed * 100003 + series_index)`, so larger runs preserve existing draws. Levels are Uniform(20,200). Default noise is nonnegative Gaussian with SD 10% of level. Generator process labels never enter fitting/selection.

- **smooth:** Gaussian level process.
- **erratic:** lognormal sizes, log-SD 1, mean-adjusted to level.
- **intermittent:** Bernoulli(.25) occurrence times Uniform(.8,1.2) × level; true zero-demand months.
- **lumpy:** Bernoulli(.2) occurrence times mean-adjusted lognormal sizes, log-SD 1.2.
- **seasonal:** Gaussian level times `1 + .8 sin(2π(t+phase)/12)`; independent random calendar phase.
- **new:** 12 observed months, level multiplier `.4 + .10t`.
- **dying:** decay begins after month index 30 and reaches zero at index 50.
- **trend:** level multiplier `.4 + .025t`.
- **structural_break:** level jumps at index 48 by either ×.25 or ×2.5, chosen per series.
- **censored:** smooth latent demand; independently, 30% of months have availability 0, .25, or .5, yielding observed sales below latent demand. Availability is NOT passed into fitting or used to impute demand. Score against latent demand: models are intentionally exposed to a missing-demand problem. This does not prove stockout inference works.

Regular series have 60 months, dated January 2020–December 2024 (the protected 2026 holdout is absent). Three nonoverlapping three-month target windows use train prefixes of 51/54/57 months. New series use prefixes of 3/6/9 months. 9,000 origins, 27,000 forecast target points per method. Every method is requested with a 12-month future curve from the prefix only; the first three months are scored. Library-defined short-history fallbacks count as the requested method, not proof that a full seasonal model was estimable. All parameters and process definitions are fixed in source; no ranking-driven tuning.

## DRY scoring and unavailable denominators

`forecast_lab.score_folds` owns scaling: lag 12 for ≥24 training months, otherwise lag 1, fallback to lag 1 if seasonal differences are all zero. Only the prefix enters the scale. MASE is point-weighted mean absolute scaled error; RMSSE is the square root of point-weighted squared scaled error. The harness explicitly excludes zero-scale points, even exact-zero-error forecasts, rather than assigning perfect scaled scores. Tables disclose total/scaled/unavailable points; JSON retains actual-demand denominators.

Bias is `100 × Σ(prediction − actual)/Σactual`: positive means overforecast. A zero actual-demand denominator is unavailable, not zero. Signed unit bias and MAE are also in JSON. Overall scores mix generator classes; do not read them as sales-weighted production estimates. Inventory service and forecast errors are separate outcomes, not interchangeable evidence.

## Inventory experiment: same production replenishment policy

Predeclared tractable subset: first 20 generated series **per process**, all three origins; 600 paired inventory cases per method, independent of results. Every case starts with stock equal to the training-prefix trailing-12 mean, cost 1 generic currency unit, no open supply, 14-day deterministic lead, two months of cover, zero extra buffer, default backup-stock inclusion. These are synthetic assumptions, not inferred historical stock/cost/supplier facts.

The engine's `order_guidance` computes the **single** purchase date, quantity, safety-stock policy, decimal MOQ/pack rounding and order-up-to window. No second order formula exists in the harness. Candidate curves temporarily replace only `_guidance_demand` during the serial planner call, leaving the production policy intact; current uses its unmodified callback. This separates method sensitivity from integration; the shipped opt-in adapter uses the same first-year periodic curve. Independent review compared this seam with actual method-driven `order_guidance`: 1,000 candidate cases had identical quantities, order dates and safety stock. The first forecast year repeats for the planner's annual-calendar search beyond 12 months (required by its existing periodic annual-skip assumption); no future actuals enter this extrapolation. This private seam is test-covered but is not a supported public integration contract. A production calendar-boundary hold is counted explicitly: the scenario executes no order, does not invent a successful recommendation, and keeps that case in the paired denominator.

The three-month daily ledger executes that one recommendation, with supply arriving before same-day demand. Held-out monthly latent demand is uniform within each real calendar month; lost sales do not become backorders. No replenishment replan during the target window, stochastic lead delay, cash limit, perishability, substitution, MOQ/pack variation, or cost variation. Fill rate is total fulfilled units / total latent units (unavailable for no demand); stockout days count days with strictly positive unmet demand, not merely zero stock; average inventory value is average **end-of-day** on-hand at unit cost 1. Pooled fill rate, stockout days per case and average value are reported with calendar-day/case denominators. This is a fixed-origin one-order sensitivity test, not a rolling operational policy validation.

## Repository sample is separate and holdout-safe

`data/sample.json` describes fully synthetic quantities and historical receipts, generated by `scripts/generate_sample.py` (seed 731209), not a raw ERP ledger. Only columns before **July 2026** are loaded into evaluation rows; July, August, September and October quantities are not used as training or targets. Eligible full targets end by June 2026. No full-sample classification, stock reconstruction, stockout correction, library fitting or parameter tuning is performed. The current snapshot stock and synthetic receipt history are ignored. Sample inventory uses the explicitly synthetic scenario above, not claimed historical fill rates. Sample results are not combined with the 3,000-series benchmark.

## Execution and results

Executed twice with `/usr/bin/python3` (stdlib, no installs/network): **3,000 series, 9,000 origins, 27,000 forecast points per method**. All 17 comparator/method rows have identical target denominators; zero unavailable scales in this generated draw. The zero-scale exclusion is separately regression-tested. Synthetic runtime 44.249s and 43.859s; numeric group results are exactly identical across both runs (elapsed metadata excluded). Sample: **5 series, 5 pre-July origins, 15 target points**, training November 2025–March 2026 and targets April–June 2026; runtime 0.027s.

Verification: **13/13 focused stdlib tests passed**; `git diff --check` passed before the final results append. Programmatic result audit checked every method/group denominator, exact repeatability, expected series/origin/inventory counts and sample target dates.

In these synthetic processes, Auto reduces aggregate MASE by **21.65%** (1.3153 → 1.0305), improves simulated fill rate by **7.14 percentage points** (0.8373 → 0.9087), and increases average inventory value by **22.79%** (121.9909 → 149.7961). This is a service/stock tradeoff, not a free improvement. Combination MASE is 1.2012 and fill rate 0.9015. One combination/lumpy inventory case produced the engine's supported-calendar hold on a tiny positive annual curve; it is counted as no order executed, not dropped or relabelled successful. No other planner holds occurred.

The tiny repository sample does **not** reproduce the headline gain: current MASE 1.6321 vs Auto 1.6395 vs combination 1.7649; simulated fill rate 0.9355 vs 0.9102 vs 0.8699. Do not tune to these five cases or change the default based on this report. No July–September holdout evaluation or tuning occurred.

### Receipt and limits

- Final raw JSON: `.scratch/methods-verification/benchmark-final.json`; SHA-256 `8eb7629e1b0f470796ad601ddd3024272e37fd3993052f5223ea6803cb8e2add`. Final synthetic runtime **42.174s**. Every documented group/method table matches this final-code run exactly.
- Source fingerprints for this final verification:
  - `forecast_lab/benchmark_methods.py`: `43b80e6ceb538c1375d12ba32dc6c7bf42a3a70f5453ff596332c129fc67ec29`
  - `forecast_methods.py`: `70f13a34cf9fd5981d36cf2d3ac77663cbced7b08693c933a95445a9a24fe32e`
  - `forecast_methods.js`: `a1cb5937b9d84223e3270f28e1dcfd00fb302342257908a2e93239b7f4522ba0`
  - `engine.py`: `1ac053b7a8bf9340c08d572662df733d188d5089a7f000780fc9cc541767c0be`
  - `forecast_lab/__init__.py`: `334d1ddb4159e82d0bd2da3c4592e256fd69bf4a20cb06759cf1d28460a581c7`
- Historical import/backend baseline hashes remain unchanged. Only the authorized pure-block hash and its explanatory comment changed in `docs/import-logic-baseline.json`. The intentional settings extension is separately pinned in `docs/forecast-methods-baseline.json`; mutation checks remain active and the planner reference is immutable commit `e3f3b81`.
- Results below are BEFORE/AFTER comparisons, **not** uncertainty intervals, significance tests, real supplier-service measurements or future business performance claims. Forecast evaluation uses all 3,000 series; inventory uses the predeclared 200-series subset (600 origin cases/method).
- Independent Opus review: SHIP with a method-label correction; final second check: SHIP after exact fallback metadata and cache fixes. Synthetic evidence is not a promotion gate.
- Not checked: live/hosted integration, monthly replanning, real demand uncensoring, calibrated uncertainty for the alternatives, the reserved July–September 2026 sample holdout, real devices or industry suitability.

# Synthetic results

### overall

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 1.3153 | 1.7165 | -14.8397 | 0.8373 | 9.1067 | 121.9909 | 0.0000 |
| auto | 1.0305 | 1.3115 | -2.5513 | 0.9087 | 5.3750 | 149.7961 | 0.0000 |
| naive | 1.3224 | 1.7733 | -5.9714 | 0.8709 | 8.4267 | 138.8224 | 0.0000 |
| seasonal_naive | 1.5059 | 1.5983 | -8.1014 | 0.8160 | 8.7567 | 139.2048 | 0.0000 |
| ma3 | 1.4848 | 2.0519 | -6.7883 | 0.8683 | 8.4217 | 138.1424 | 0.0000 |
| ma6 | 1.7228 | 2.3026 | -8.6167 | 0.8458 | 9.1033 | 136.1149 | 0.0000 |
| ma12 | 1.6955 | 1.9973 | -10.1558 | 0.8298 | 9.2000 | 133.1144 | 0.0000 |
| ses | 1.2580 | 1.7308 | -5.8187 | 0.8932 | 6.3533 | 145.5216 | 0.0000 |
| holt_damped | 1.4645 | 2.0908 | -3.4261 | 0.8900 | 7.0583 | 144.8571 | 0.0000 |
| hw_additive | 1.0219 | 1.2689 | -2.8874 | 0.9081 | 6.1450 | 147.5408 | 0.0000 |
| hw_multiplicative | 1.0255 | 1.3318 | 5.4298 | 0.9143 | 5.4833 | 158.7146 | 0.0000 |
| theta | 1.1894 | 1.6576 | -4.3843 | 0.9038 | 5.7183 | 147.1482 | 0.0000 |
| croston | 1.9719 | 2.2555 | -8.7177 | 0.8109 | 9.9767 | 136.1595 | 0.0000 |
| sba | 2.0250 | 2.3145 | -13.2818 | 0.7892 | 11.1017 | 128.4758 | 0.0000 |
| tsb | 1.9175 | 2.2404 | -10.8590 | 0.8093 | 10.1500 | 132.6956 | 0.0000 |
| adida | 1.2523 | 1.7289 | -6.0890 | 0.8938 | 6.2717 | 144.8386 | 0.0000 |
| combination | 1.2012 | 1.6700 | -4.7833 | 0.9015 | 5.8550 | 146.5153 | 1.0000 |

Denominators: 9000 origins; 27000 target points; 27000 scaled points; 0 unavailable-scale points; 600 inventory cases / 55000 calendar days.

### censored

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.6261 | 0.5484 | -22.6848 | 0.8748 | 11.3833 | 116.2483 | 0.0000 |
| auto | 0.6059 | 0.5195 | -22.3465 | 0.8865 | 10.7667 | 119.4365 | 0.0000 |
| naive | 0.7951 | 0.8548 | -22.7408 | 0.8543 | 14.8833 | 139.4133 | 0.0000 |
| seasonal_naive | 0.7865 | 0.8581 | -21.9643 | 0.8550 | 13.7500 | 118.3371 | 0.0000 |
| ma3 | 0.6711 | 0.6295 | -22.1928 | 0.8744 | 12.2000 | 126.2304 | 0.0000 |
| ma6 | 0.6331 | 0.5627 | -22.4123 | 0.8829 | 11.1833 | 120.9139 | 0.0000 |
| ma12 | 0.6085 | 0.5210 | -22.4611 | 0.8820 | 11.3167 | 117.2693 | 0.0000 |
| ses | 0.6115 | 0.5281 | -22.5124 | 0.8833 | 11.1000 | 118.7142 | 0.0000 |
| holt_damped | 0.7100 | 0.6831 | -22.1613 | 0.8711 | 12.7500 | 129.0857 | 0.0000 |
| hw_additive | 0.8518 | 0.8050 | -22.5580 | 0.8690 | 12.8000 | 133.3125 | 0.0000 |
| hw_multiplicative | 0.6128 | 0.5302 | -22.5268 | 0.8833 | 11.1000 | 118.7142 | 0.0000 |
| theta | 0.6123 | 0.5296 | -22.5073 | 0.8834 | 11.1167 | 118.8543 | 0.0000 |
| croston | 0.5890 | 0.4949 | -21.9560 | 0.8903 | 10.0333 | 119.0034 | 0.0000 |
| sba | 0.6862 | 0.5616 | -25.8582 | 0.8608 | 12.6667 | 109.8241 | 0.0000 |
| tsb | 0.5953 | 0.4999 | -22.1774 | 0.8892 | 10.2000 | 118.7341 | 0.0000 |
| adida | 0.6115 | 0.5281 | -22.5124 | 0.8833 | 11.1000 | 118.7142 | 0.0000 |
| combination | 0.6120 | 0.5292 | -22.4990 | 0.8836 | 11.1000 | 118.8970 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### dying

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.0307 | 0.1141 | n/a | n/a | 0.0000 | 17.9570 | 0.0000 |
| auto | 0.7977 | 0.7761 | n/a | n/a | 0.0000 | 75.5239 | 0.0000 |
| naive | 0.0000 | 0.0000 | n/a | n/a | 0.0000 | 16.5684 | 0.0000 |
| seasonal_naive | 1.2202 | 1.0338 | n/a | n/a | 0.0000 | 104.1968 | 0.0000 |
| ma3 | 0.0594 | 0.0801 | n/a | n/a | 0.0000 | 22.8124 | 0.0000 |
| ma6 | 0.1775 | 0.2048 | n/a | n/a | 0.0000 | 34.4995 | 0.0000 |
| ma12 | 0.5691 | 0.5107 | n/a | n/a | 0.0000 | 62.1455 | 0.0000 |
| ses | 0.0376 | 0.0500 | n/a | n/a | 0.0000 | 29.8933 | 0.0000 |
| holt_damped | 0.0001 | 0.0007 | n/a | n/a | 0.0000 | 16.6664 | 0.0000 |
| hw_additive | 0.0744 | 0.1207 | n/a | n/a | 0.0000 | 30.8615 | 0.0000 |
| hw_multiplicative | 0.0376 | 0.0500 | n/a | n/a | 0.0000 | 29.8933 | 0.0000 |
| theta | 0.0154 | 0.0262 | n/a | n/a | 0.0000 | 20.3344 | 0.0000 |
| croston | 1.5103 | 1.1947 | n/a | n/a | 0.0000 | 120.1566 | 0.0000 |
| sba | 1.4348 | 1.1350 | n/a | n/a | 0.0000 | 115.5111 | 0.0000 |
| tsb | 1.0318 | 0.8420 | n/a | n/a | 0.0000 | 90.3297 | 0.0000 |
| adida | 0.0376 | 0.0500 | n/a | n/a | 0.0000 | 29.8933 | 0.0000 |
| combination | 0.0154 | 0.0262 | n/a | n/a | 0.0000 | 20.3344 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### erratic

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.8496 | 0.9567 | -16.3426 | 0.8325 | 7.3333 | 254.3699 | 0.0000 |
| auto | 0.8287 | 0.9110 | -2.8096 | 0.8732 | 4.8667 | 287.0670 | 0.0000 |
| naive | 1.0614 | 1.1408 | -3.6785 | 0.7973 | 10.7167 | 256.5649 | 0.0000 |
| seasonal_naive | 1.0273 | 1.1435 | -5.7986 | 0.8328 | 6.8333 | 303.5077 | 0.0000 |
| ma3 | 0.9068 | 0.9714 | -2.6625 | 0.8656 | 6.8333 | 257.5225 | 0.0000 |
| ma6 | 0.8535 | 0.9262 | -3.5127 | 0.8519 | 6.5667 | 263.2470 | 0.0000 |
| ma12 | 0.8224 | 0.9064 | -4.5844 | 0.8538 | 5.8167 | 276.6018 | 0.0000 |
| ses | 0.8281 | 0.9104 | -2.7870 | 0.8731 | 4.8667 | 287.1097 | 0.0000 |
| holt_damped | 0.9407 | 0.9991 | -2.4775 | 0.8489 | 8.2167 | 247.7481 | 0.0000 |
| hw_additive | 1.0940 | 1.0933 | 2.8183 | 0.8668 | 10.1667 | 270.0850 | 0.0000 |
| hw_multiplicative | 1.5876 | 1.8324 | 74.9685 | 0.8774 | 7.2500 | 388.4972 | 0.0000 |
| theta | 0.8293 | 0.9114 | -2.9097 | 0.8734 | 4.8500 | 287.2104 | 0.0000 |
| croston | 0.8096 | 0.8983 | -4.2515 | 0.8735 | 4.8167 | 277.7417 | 0.0000 |
| sba | 0.7934 | 0.9000 | -9.0389 | 0.8666 | 5.0333 | 267.9225 | 0.0000 |
| tsb | 0.8096 | 0.8983 | -4.2515 | 0.8735 | 4.8167 | 277.7417 | 0.0000 |
| adida | 0.8281 | 0.9104 | -2.7870 | 0.8731 | 4.8667 | 287.1097 | 0.0000 |
| combination | 0.8286 | 0.9111 | -2.9027 | 0.8732 | 4.8667 | 286.7692 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### intermittent

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.8427 | 0.8221 | -56.4613 | 0.5598 | 8.8833 | 68.7291 | 0.0000 |
| auto | 1.0122 | 0.7405 | -5.7979 | 0.8278 | 3.5000 | 109.1592 | 0.0000 |
| naive | 1.0288 | 1.0199 | -11.2744 | 0.4082 | 11.7500 | 75.3049 | 0.0000 |
| seasonal_naive | 1.0190 | 1.0133 | -8.6682 | 0.7302 | 5.2000 | 117.3885 | 0.0000 |
| ma3 | 1.0347 | 0.8506 | -1.4355 | 0.5885 | 8.2167 | 101.6548 | 0.0000 |
| ma6 | 1.0314 | 0.7946 | -0.5238 | 0.7278 | 5.6833 | 114.1897 | 0.0000 |
| ma12 | 1.0172 | 0.7606 | -4.1164 | 0.8059 | 3.9500 | 116.5411 | 0.0000 |
| ses | 1.0251 | 0.7619 | -2.2700 | 0.8128 | 3.9000 | 111.8719 | 0.0000 |
| holt_damped | 1.0495 | 0.8724 | 0.8767 | 0.6826 | 6.6333 | 105.7438 | 0.0000 |
| hw_additive | 1.1011 | 0.9179 | 18.0054 | 0.8057 | 4.4000 | 117.2115 | 0.0000 |
| hw_multiplicative | 1.0251 | 0.7619 | -2.2700 | 0.8128 | 3.9000 | 111.8719 | 0.0000 |
| theta | 1.0253 | 0.7628 | -2.2141 | 0.8126 | 3.9000 | 111.8903 | 0.0000 |
| croston | 1.0409 | 0.7392 | 2.7514 | 0.8381 | 3.3000 | 114.0843 | 0.0000 |
| sba | 1.0238 | 0.7386 | -2.3862 | 0.8331 | 3.3833 | 111.0231 | 0.0000 |
| tsb | 1.0175 | 0.7512 | -4.1920 | 0.8157 | 3.8000 | 111.4056 | 0.0000 |
| adida | 1.0165 | 0.7498 | -3.4778 | 0.8238 | 3.6000 | 109.3727 | 0.0000 |
| combination | 1.0249 | 0.7627 | -2.3422 | 0.8122 | 3.9000 | 111.7775 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### lumpy

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.9782 | 1.6434 | -54.6506 | 0.4268 | 7.0333 | 65.1267 | 0.0000 |
| auto | 1.1725 | 1.6156 | 3.7943 | 0.6345 | 3.1833 | 102.9681 | 0.0000 |
| naive | 1.3463 | 1.8040 | 5.3960 | 0.3166 | 8.1167 | 88.0457 | 0.0000 |
| seasonal_naive | 1.2950 | 1.7895 | 5.6953 | 0.5625 | 4.6000 | 80.9418 | 0.0000 |
| ma3 | 1.2670 | 1.6758 | 9.1568 | 0.4313 | 7.4500 | 89.8789 | 0.0000 |
| ma6 | 1.2261 | 1.6332 | 9.3373 | 0.5419 | 5.6333 | 92.7287 | 0.0000 |
| ma12 | 1.1984 | 1.6167 | 6.9770 | 0.5826 | 4.5167 | 92.7323 | 0.0000 |
| ses | 1.2166 | 1.6310 | 12.2184 | 0.6108 | 3.7833 | 105.9227 | 0.0000 |
| holt_damped | 1.3229 | 1.6949 | 16.5946 | 0.5013 | 5.6667 | 95.6415 | 0.0000 |
| hw_additive | 1.5275 | 1.7258 | 61.4010 | 0.6650 | 3.6333 | 121.4764 | 0.0000 |
| hw_multiplicative | 1.2166 | 1.6310 | 12.2184 | 0.6108 | 3.7833 | 105.9227 | 0.0000 |
| theta | 1.2187 | 1.6317 | 12.5314 | 0.5994 | 3.9667 | 105.7829 | 0.0000 |
| croston | 1.2214 | 1.6066 | 17.3981 | 0.7029 | 2.6000 | 101.4002 | 0.0000 |
| sba | 1.1984 | 1.6070 | 11.5282 | 0.6969 | 2.6667 | 99.2605 | 0.0000 |
| tsb | 1.1735 | 1.6119 | 5.4652 | 0.6322 | 3.6667 | 99.5358 | 0.0000 |
| adida | 1.1673 | 1.6161 | 1.8574 | 0.6313 | 3.2667 | 101.5925 | 0.0000 |
| combination | 1.2164 | 1.6316 | 11.9450 | 0.5994 | 3.9667 | 105.5702 | 1.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### new

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 4.1206 | 4.0852 | -40.9791 | 0.6013 | 33.1833 | 51.7400 | 0.0000 |
| auto | 2.2346 | 2.7825 | -19.3822 | 0.7788 | 19.2000 | 93.1079 | 0.0000 |
| naive | 2.1455 | 2.7215 | -18.0626 | 0.7880 | 18.2667 | 95.8363 | 0.0000 |
| seasonal_naive | 2.1455 | 2.7215 | -18.0626 | 0.7880 | 18.2667 | 95.8363 | 0.0000 |
| ma3 | 2.8738 | 3.2022 | -27.2848 | 0.7139 | 24.9833 | 76.4862 | 0.0000 |
| ma6 | 3.7095 | 3.7689 | -36.4260 | 0.6387 | 30.6833 | 59.3358 | 0.0000 |
| ma12 | 4.1206 | 4.0852 | -40.9791 | 0.6013 | 33.1833 | 51.7400 | 0.0000 |
| ses | 2.2346 | 2.7825 | -19.3822 | 0.7788 | 19.2000 | 93.1079 | 0.0000 |
| holt_damped | 1.5238 | 2.2249 | -9.3847 | 0.8522 | 12.6000 | 116.2524 | 0.0000 |
| hw_additive | 2.2346 | 2.7825 | -19.3822 | 0.7788 | 19.2000 | 93.1079 | 0.0000 |
| hw_multiplicative | 2.2346 | 2.7825 | -19.3822 | 0.7788 | 19.2000 | 93.1079 | 0.0000 |
| theta | 1.5761 | 2.2834 | -10.2616 | 0.8436 | 13.4833 | 111.9364 | 0.0000 |
| croston | 5.0069 | 4.7731 | -50.2070 | 0.5270 | 40.1000 | 37.5253 | 0.0000 |
| sba | 5.2592 | 5.0014 | -52.6966 | 0.5087 | 41.8167 | 34.3382 | 0.0000 |
| tsb | 5.0069 | 4.7731 | -50.2070 | 0.5270 | 40.1000 | 37.5253 | 0.0000 |
| adida | 2.2346 | 2.7825 | -19.3822 | 0.7788 | 19.2000 | 93.1079 | 0.0000 |
| combination | 1.6920 | 2.3693 | -12.8419 | 0.8303 | 14.6333 | 107.4731 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### seasonal

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 1.9833 | 2.1210 | -0.7036 | 0.9508 | 2.7500 | 156.5023 | 0.0000 |
| auto | 1.7185 | 1.8049 | 8.3613 | 0.9931 | 0.4167 | 176.9196 | 0.0000 |
| naive | 4.6472 | 3.9864 | 1.3458 | 0.8603 | 8.3833 | 177.2694 | 0.0000 |
| seasonal_naive | 1.0484 | 1.0947 | 0.2427 | 0.9947 | 0.3333 | 167.6045 | 0.0000 |
| ma3 | 6.1997 | 5.0696 | 1.6766 | 0.7788 | 13.2667 | 177.2994 | 0.0000 |
| ma6 | 7.0649 | 5.6787 | 1.6842 | 0.7274 | 16.2000 | 168.8928 | 0.0000 |
| ma12 | 4.7353 | 3.8424 | 0.9713 | 0.8491 | 9.4000 | 158.0548 | 0.0000 |
| ses | 4.8031 | 4.0858 | 1.3925 | 0.8518 | 8.8667 | 177.3513 | 0.0000 |
| holt_damped | 6.9141 | 5.6742 | 1.9369 | 0.7562 | 14.8833 | 182.3065 | 0.0000 |
| hw_additive | 1.0352 | 0.9980 | 0.3842 | 0.9931 | 0.4167 | 166.9381 | 0.0000 |
| hw_multiplicative | 0.9863 | 1.0052 | 0.3680 | 0.9904 | 0.5000 | 166.0106 | 0.0000 |
| theta | 4.8142 | 4.0951 | 1.3815 | 0.8513 | 8.8667 | 177.4819 | 0.0000 |
| croston | 5.2892 | 4.2631 | 1.1480 | 0.8179 | 10.9333 | 160.5541 | 0.0000 |
| sba | 5.2670 | 4.2573 | -3.9094 | 0.8017 | 11.9167 | 152.1711 | 0.0000 |
| tsb | 5.2892 | 4.2631 | 1.1480 | 0.8179 | 10.9333 | 160.5541 | 0.0000 |
| adida | 4.8031 | 4.0858 | 1.3925 | 0.8518 | 8.8667 | 177.3513 | 0.0000 |
| combination | 4.8148 | 4.0959 | 1.3859 | 0.8512 | 8.8833 | 177.4596 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### smooth

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.7566 | 0.7624 | -0.1031 | 0.9544 | 3.6833 | 102.4907 | 0.0000 |
| auto | 0.7504 | 0.7556 | -0.0647 | 0.9580 | 3.5500 | 103.4158 | 0.0000 |
| naive | 1.0313 | 1.0386 | 0.6160 | 0.9561 | 3.9833 | 103.6840 | 0.0000 |
| seasonal_naive | 1.0121 | 1.0218 | -0.4183 | 0.9516 | 3.9667 | 102.9708 | 0.0000 |
| ma3 | 0.8434 | 0.8483 | 0.1870 | 0.9585 | 3.4667 | 103.8245 | 0.0000 |
| ma6 | 0.7802 | 0.7851 | 0.0669 | 0.9590 | 3.3833 | 104.3418 | 0.0000 |
| ma12 | 0.7491 | 0.7538 | -0.1467 | 0.9565 | 3.5500 | 103.0704 | 0.0000 |
| ses | 0.7504 | 0.7556 | -0.0647 | 0.9580 | 3.5500 | 103.4158 | 0.0000 |
| holt_damped | 0.8844 | 0.8886 | 0.4824 | 0.9591 | 3.5000 | 104.7980 | 0.0000 |
| hw_additive | 0.9545 | 0.9634 | 0.3285 | 0.9550 | 3.7833 | 104.3872 | 0.0000 |
| hw_multiplicative | 0.9587 | 0.9694 | 0.7363 | 0.9559 | 3.6500 | 105.0037 | 0.0000 |
| theta | 0.7517 | 0.7568 | -0.0607 | 0.9577 | 3.5833 | 103.3613 | 0.0000 |
| croston | 0.7419 | 0.7459 | -0.0873 | 0.9577 | 3.5500 | 103.2310 | 0.0000 |
| sba | 0.8249 | 0.8297 | -5.0829 | 0.9374 | 5.2667 | 93.0872 | 0.0000 |
| tsb | 0.7419 | 0.7459 | -0.0873 | 0.9577 | 3.5500 | 103.2310 | 0.0000 |
| adida | 0.7504 | 0.7556 | -0.0647 | 0.9580 | 3.5500 | 103.4158 | 0.0000 |
| combination | 0.7514 | 0.7566 | -0.0594 | 0.9579 | 3.5667 | 103.4184 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### structural_break

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 2.3853 | 1.6337 | -9.6774 | 0.7945 | 10.5333 | 176.2753 | 0.0000 |
| auto | 0.6078 | 0.5912 | 2.0220 | 0.9742 | 1.5000 | 226.8922 | 0.0000 |
| naive | 0.5148 | 0.4526 | 0.1111 | 0.9724 | 1.6500 | 225.2522 | 0.0000 |
| seasonal_naive | 4.4321 | 2.6917 | -20.3311 | 0.5746 | 21.2500 | 149.5065 | 0.0000 |
| ma3 | 0.4181 | 0.3663 | 0.0359 | 0.9804 | 1.0667 | 222.2882 | 0.0000 |
| ma6 | 1.1654 | 1.0011 | -3.3190 | 0.9163 | 4.2500 | 207.6400 | 0.0000 |
| ma12 | 2.4116 | 1.6433 | -10.0860 | 0.7969 | 10.4167 | 176.5390 | 0.0000 |
| ses | 0.4968 | 0.4231 | 0.5518 | 0.9742 | 1.5000 | 224.3582 | 0.0000 |
| holt_damped | 0.7353 | 0.5287 | 2.6498 | 0.9900 | 0.4833 | 236.5645 | 0.0000 |
| hw_additive | 0.7915 | 0.6075 | -0.2725 | 0.9657 | 1.8833 | 220.1297 | 0.0000 |
| hw_multiplicative | 0.8089 | 0.6190 | -0.0095 | 0.9642 | 2.0500 | 220.3483 | 0.0000 |
| theta | 0.4958 | 0.4217 | 0.7653 | 0.9760 | 1.3833 | 225.5159 | 0.0000 |
| croston | 2.5638 | 1.6679 | -11.1573 | 0.7741 | 11.6167 | 171.9438 | 0.0000 |
| sba | 2.5917 | 1.6764 | -15.5995 | 0.7482 | 12.9167 | 161.1919 | 0.0000 |
| tsb | 2.5638 | 1.6679 | -11.1573 | 0.7741 | 11.6167 | 171.9438 | 0.0000 |
| adida | 0.4968 | 0.4231 | 0.5518 | 0.9742 | 1.5000 | 224.3582 | 0.0000 |
| combination | 0.4953 | 0.4212 | 0.7394 | 0.9758 | 1.4000 | 225.3660 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.

### trend

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 0.5796 | 0.6489 | -2.6143 | 0.9320 | 6.2833 | 210.4697 | 0.0000 |
| auto | 0.5766 | 0.6469 | -4.2916 | 0.9265 | 6.7667 | 203.4707 | 0.0000 |
| naive | 0.6532 | 0.7332 | -2.6032 | 0.9292 | 6.5167 | 210.2849 | 0.0000 |
| seasonal_naive | 1.0733 | 1.1437 | -17.1456 | 0.8557 | 13.3667 | 151.7583 | 0.0000 |
| ma3 | 0.5737 | 0.6452 | -4.2485 | 0.9258 | 6.7333 | 203.4268 | 0.0000 |
| ma6 | 0.5867 | 0.6598 | -6.3022 | 0.9197 | 7.4500 | 195.3595 | 0.0000 |
| ma12 | 0.7229 | 0.7899 | -10.6346 | 0.8939 | 9.8500 | 176.4496 | 0.0000 |
| ses | 0.5766 | 0.6469 | -4.2916 | 0.9265 | 6.7667 | 203.4707 | 0.0000 |
| holt_damped | 0.5644 | 0.6311 | -1.8113 | 0.9364 | 5.8500 | 213.7642 | 0.0000 |
| hw_additive | 0.5549 | 0.6211 | -1.1269 | 0.9451 | 5.1667 | 217.8981 | 0.0000 |
| hw_multiplicative | 0.7866 | 0.8827 | 5.6425 | 0.9638 | 3.4000 | 247.7760 | 0.0000 |
| theta | 0.5547 | 0.6210 | -2.8854 | 0.9341 | 6.0333 | 209.1148 | 0.0000 |
| croston | 0.9457 | 0.9862 | -15.4902 | 0.8619 | 12.8167 | 155.9550 | 0.0000 |
| sba | 1.1708 | 1.1781 | -19.7157 | 0.8342 | 15.3500 | 140.4284 | 0.0000 |
| tsb | 0.9457 | 0.9862 | -15.4902 | 0.8619 | 12.8167 | 155.9550 | 0.0000 |
| adida | 0.5766 | 0.6469 | -4.2916 | 0.9265 | 6.7667 | 203.4707 | 0.0000 |
| combination | 0.5607 | 0.6283 | -3.0882 | 0.9323 | 6.2333 | 208.0877 | 0.0000 |

Denominators: 900 origins; 2700 target points; 2700 scaled points; 0 unavailable-scale points; 60 inventory cases / 5500 calendar days.


# Sample pre-July results

### overall

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 1.6321 | 1.8692 | -2.5625 | 0.9355 | 26.2000 | 4015.9293 | 0.0000 |
| auto | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| naive | 2.0261 | 2.3040 | -7.9519 | 0.9229 | 32.4000 | 3727.8537 | 0.0000 |
| seasonal_naive | 2.0261 | 2.3040 | -7.9519 | 0.9229 | 32.4000 | 3727.8537 | 0.0000 |
| ma3 | 1.5756 | 1.8102 | -8.2076 | 0.8967 | 26.2000 | 3611.6540 | 0.0000 |
| ma6 | 1.6321 | 1.8692 | -2.5625 | 0.9355 | 26.2000 | 4015.9293 | 0.0000 |
| ma12 | 1.6321 | 1.8692 | -2.5625 | 0.9355 | 26.2000 | 4015.9293 | 0.0000 |
| ses | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| holt_damped | 2.3148 | 2.4796 | -42.0931 | 0.6876 | 39.0000 | 1696.1252 | 0.0000 |
| hw_additive | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| hw_multiplicative | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| theta | 1.7649 | 1.9123 | -13.7891 | 0.8699 | 29.2000 | 3287.3773 | 0.0000 |
| croston | 1.7241 | 1.9120 | 8.2553 | 0.9418 | 26.2000 | 4786.0006 | 0.0000 |
| sba | 1.7243 | 1.9303 | 2.8425 | 0.9392 | 27.2000 | 4401.7389 | 0.0000 |
| tsb | 1.7241 | 1.9120 | 8.2553 | 0.9418 | 26.2000 | 4786.0006 | 0.0000 |
| adida | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| combination | 1.7649 | 1.9123 | -13.7891 | 0.8699 | 29.2000 | 3287.3773 | 0.0000 |

Denominators: 5 origins; 15 target points; 15 scaled points; 0 unavailable-scale points; 5 inventory cases / 455 calendar days.

### sample_pre_july

| AFTER method (BEFORE = current) | MASE | RMSSE | Bias % | Fill rate | Stockout days/case | Avg inventory value | Planner holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 1.6321 | 1.8692 | -2.5625 | 0.9355 | 26.2000 | 4015.9293 | 0.0000 |
| auto | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| naive | 2.0261 | 2.3040 | -7.9519 | 0.9229 | 32.4000 | 3727.8537 | 0.0000 |
| seasonal_naive | 2.0261 | 2.3040 | -7.9519 | 0.9229 | 32.4000 | 3727.8537 | 0.0000 |
| ma3 | 1.5756 | 1.8102 | -8.2076 | 0.8967 | 26.2000 | 3611.6540 | 0.0000 |
| ma6 | 1.6321 | 1.8692 | -2.5625 | 0.9355 | 26.2000 | 4015.9293 | 0.0000 |
| ma12 | 1.6321 | 1.8692 | -2.5625 | 0.9355 | 26.2000 | 4015.9293 | 0.0000 |
| ses | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| holt_damped | 2.3148 | 2.4796 | -42.0931 | 0.6876 | 39.0000 | 1696.1252 | 0.0000 |
| hw_additive | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| hw_multiplicative | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| theta | 1.7649 | 1.9123 | -13.7891 | 0.8699 | 29.2000 | 3287.3773 | 0.0000 |
| croston | 1.7241 | 1.9120 | 8.2553 | 0.9418 | 26.2000 | 4786.0006 | 0.0000 |
| sba | 1.7243 | 1.9303 | 2.8425 | 0.9392 | 27.2000 | 4401.7389 | 0.0000 |
| tsb | 1.7241 | 1.9120 | 8.2553 | 0.9418 | 26.2000 | 4786.0006 | 0.0000 |
| adida | 1.6395 | 1.8383 | -6.9921 | 0.9102 | 27.2000 | 3699.8702 | 0.0000 |
| combination | 1.7649 | 1.9123 | -13.7891 | 0.8699 | 29.2000 | 3287.3773 | 0.0000 |

Denominators: 5 origins; 15 target points; 15 scaled points; 0 unavailable-scale points; 5 inventory cases / 455 calendar days.
