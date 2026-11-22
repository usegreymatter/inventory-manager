# Recommended per product (v1.2, opt-in)

**Experimental candidate, not a default promotion.** Choose **Recommended per product** in Forecast method, or pass `{"forecast_method":"recommended"}` as engine/CLI settings. Current remains the default; fixed Auto and all 16 existing method implementations are unchanged. The CLI supports `--method recommended`; settings JSON remains equivalent. Nothing places an order or accesses an ERP.

## Pure, offline API

```python
import forecast_methods
result = forecast_methods.recommend([40, 50, 30] * 12,
                                    previous=None,
                                    stockout_adjust=False)
# JSON-serializable: method, reason, forecast (12 points), scores,
# order_proxy, folds, backtest, previous_method, hysteresis, range_available.
```

The JS twin exports the same `recommend(values, previous=null, stockout_adjust=false)` and `recommend_forecast(values, horizon=12, method='current')` functions. Inputs follow the existing finite, nonnegative, at-most-1e12, at-most-1200-month validation. Values and caller state are never mutated. No filesystem, clock, network, random generator or catalogue data is read by these functions.

`stockout_adjust=True` in this **numeric-only API** records that the caller supplied corrected observations; it does not infer lost demand from zero sales. In the engine/UI adapter, turning on the existing stockout-adjust setting first applies its existing detected-stockout scenario to the fitting values. A pick made on raw sales is not treated as a previous-month choice for that same month's corrected history. The flag and explanation survive the internal correction recursion. Detection is a scenario, not proof of true demand, and trailing zeros without stock evidence remain ambiguous.

## Candidate pool and what “Current” means here

Five fixed candidates only:

| Candidate ID | Curve |
|---|---|
| `current` | **Basic Current hybrid (no adopted challenger)**: steady 12-month mean, otherwise the existing clamped seasonal/recent-level raw-history formula |
| `ses` | Existing fixed-grid simple exponential smoothing |
| `seasonal_naive` | Same month last year |
| `sba` | Existing Croston-SBA intermittent rate |
| `combination` | Existing median of SES, Theta and damped trend |

Important distinction: shipped **Current mode** can itself adopt a separately tested challenger. The pure selector's `current` candidate does **not** reproduce that larger contextual pipeline, calendar overrides or external forecasts. Its visible label says “Basic Current hybrid (no adopted challenger)”, never that it necessarily reproduces Current mode. The synthetic evaluation below compares against the **actual shipped Current engine**, not this approximation. This distinction and the independent Stress-lane gate prevent a misleading promotion claim.

The separate recommendation pool is not appended to `METHODS`: the fixed November candidate registry stays frozen. New code changes source hashes; any November outcome scoring must use its explicitly frozen implementation/registration snapshot, not silently substitute this experimental selector. No actual export or July–September 2026 observations were used for selection or threshold work here.

## Bounded backtest, switch margin and hysteresis

- Validate the full input, but fit only its latest **48 months**. Fewer than **20** months, or all-zero history, retains the incumbent; without one that is the basic Current hybrid.
- Use up to **8 rolling origins**, each with **3 complete targets**, training on a prefix only. Seasonal naive has at least 12 training months at every scored origin. No partial future target is treated as zero.
- Selection loss is the square root of the mean of `(.5 * mean(monthly_error²) + .5 * mean(monthly_error)²) / scale²`. `scale²` is the mean squared prefix difference at lag 12 (lag 1 before 24 months), floored by `(0.05 * prefix_mean)²` and a numerical floor. This is a **floored scaled-error measure**, not the November protocol's unmodified RMSSE. Fold-wide numeric rescaling prevents overflow even for subnormal-to-1e12 changes; target observations enter scoring, never fitting.
- Candidate order proxy is `(excess + 2 * shortage) / (3 * prefix_mean)`, averaged over folds, with a numerical floor. It models one three-month replenishment, **not** daily fill rate, expiry, lead-time risk or equal-inventory performance.
- Keep the incumbent unless the lowest-error candidate improves scaled error by **at least 10%** against a fresh baseline, or **15%** against a previous nonbaseline choice. An explicitly supplied `previous` also requires 15%. Its backtest order proxy must be no more than **2% worse**. “No material worsening” in the reason refers only to this backtest gate, never a promise about future orders.
- A clean import has no saved choice: reconstruct one prior-month choice using the previous prefix and the ordinary 10% baseline gate, then apply hysteresis. Reconstructed Current keeps the 10% gate; a reconstructed alternative gets 15%. This is a deterministic, one-month warm start, **not** an unlimited path-dependent or durable choice history. Callers can supply the true previous choice explicitly.
- Adapters accept carried metadata only from an **earlier month in the same adjustment mode**. Same-month edits/corrections refit without anchoring to the uncorrected pick. Identical calculated rows reuse their evidence rather than changing the reason during order calculation.
- At most **16 origins / 80 candidate fits** including reconstruction; no recursive chain of earlier recommendations. A candidate fits at most 48 observations. The best-error candidate must pass both gates; second-best candidates are not searched after a gate failure.

Ties retain the incumbent. Scores are rounded consistently in both languages before the switching comparison. Forecasts retain the existing bounded nine-decimal point-curve convention. The selected next-year curve repeats beyond year one using the existing alternative-method calendar ledger.

## Explanations and honest risk ranges

Every fitted product supplies **“Method picked: X because Y”**. The standalone report keeps this visible in Simple and detailed views; the Why sheet uses the actual label even for seasonal-naive and SBA picks. Product results can use different methods in the same catalogue. Source/held/excluded histories keep existing missing-data gates; excluded or unobserved months are never compacted.

### CLI selection and caller-owned previous choices

`--method recommended --json` exports the selected product's `forecast_method`
metadata (including `method`, `label` and `reason`) and appends the picked-method
explanation to `why_this_amount`. `--method recommended --explain` includes the
same explanation and a `forecast_method` CSV column containing JSON metadata.
Saved `{"forecast_method":"recommended"}` settings use the same path. Current
mode without the new settings keeps its previous output columns and bytes.

The Desktop page saves the last Recommended pick per SKU and stockout-adjustment
mode in device-local storage (`stock-runway.recommended-picks.v1`, up to 10,000
SKU records). The current pick and its one earlier snapshot seed are retained,
so saving a current result cannot change a same-month rerender or reload. Only
an earlier snapshot month can seed a fit; same-month picks cannot seed themselves.
Entries written before this two-snapshot fix have no retained seed and may use
stateless selection once until the next month's save. No sales/stock rows are
stored. Reused SKUs on this device share this memory; clear this storage key to
start fresh. Blocked/full storage falls back to stateless selection. Standalone
pages and other callers remain stateless unless they supply earlier picks.

The CLI is **stateless between runs**. Without an explicit previous-method file,
the selector only reconstructs the bounded one-month warm start described above;
it cannot remember the actual choice from your previous invocation. To supply
that incumbent, create a UTF-8 JSON object mapping exact SKUs to candidate IDs:

```json
{"SYN-A":"ses","SYN-B":"sba"}
```

```sh
python3 stock_runway.py stock.csv --today 2026-11-01 --all \
  --method recommended --previous-methods methods.json --json
```

Allowed values are `current`, `ses`, `seasonal_naive`, `sba`, and `combination`;
these are the selector's candidates, not `auto` or `recommended` mode names.
The file must be a JSON object no larger than 2 MiB, with nonempty SKU keys of
at most 512 characters. Missing SKUs take the ordinary stateless path; extra
SKUs are ignored for this catalogue. Invalid entries fail before export.

`--previous-methods` supplies the previous choice to the existing selector's
hysteresis gate; it does **not** force the winner or enable Recommended mode.
The file is read only, never updated automatically, and cannot also be the
output/learning archive/log. Save the next mapping yourself from each JSON
row's `sku` and `forecast_method.method` if you want durable choice history.
Because this minimal mapping carries no date or adjustment metadata, **you must
supply choices from an earlier sales month using the same stockout-adjustment
mode**. The CLI cannot verify that provenance. Do not reuse unadjusted choices
for adjusted histories, or same-month edits, as if they were earlier-month
choices. Omit the file when that condition is not met.

Recommended **models** have no calibrated demand range or run-out probability, including when their basic-Current candidate wins. Those ranges are withheld and the product/settings explain why. Past forecast misses explicitly falls back to Sales variation rather than calibrating the newly selected model on the same selection window. Products that cannot fit a recommendation and genuinely fall back to the unchanged Current pipeline may retain Current's own ranges; that is a mixed catalogue, not selected-model calibration.

## Synthetic evidence and limitations

The reproducible evaluator is [auto_synthetic.py](../forecast_lab/auto_synthetic.py). It generates its **own** five families: level jitter, a ramp, a two-peak annual cycle, random lots, and restricted supply. It never reads the Stress lane's held-out families or any real data. Development seeds 0–999 are separate from the 80 evaluation seeds 10000–10079 per family (**400 series**). Every series has 36 training months and 3 unseen synthetic target months. This is a self-authored development evaluation, **not independent validation**.

Both adjustment modes are reported. Adjustment ON divides by **known synthetic exposure**: this isolates censoring sensitivity but does not validate the production detector or prove that real latent demand is identifiable. All methods receive the same fitting values and are scored against synthetic latent target demand. Current comparison runs the shipped engine, including any adopted challenger. Scaled error and the prefix-normalized order proxy are reported separately, with paired series bootstrap **90% CIs, 1000 resamples, seed 93017**, all four baselines, and all family results. Intervals are exploratory, without multiplicity correction. Each family/seed is an independent synthetic series; only one final evaluation origin per series is used.

An initial diagnostic used actual-target demand (floored at one unit) as the order-proxy denominator. On random-lot windows with no future sales, that becomes a scale-dependent raw-unit cost. It showed a worse aggregate proxy than the basic hybrid (delta +2.969, 90% CI [0.751, 5.534]). The final evaluator corrects the unit mismatch to the **same prefix-demand normalization used by selection** and separately fixes the baseline to actual Current. This is an explicitly disclosed metric/baseline correction, not evidence that the initial adverse result never occurred. No selector parameters were adjusted to optimize these outcomes.

Final numbers, timings and verification receipts are recorded below after executing the final source. **Beating fixed Auto on scaled error is not established when its paired interval crosses zero.** The independent Stress-lane requirement to beat every baseline is a separate, still-open promotion gate. Keep Current as the default regardless of the development averages.

## Recorded final results

Numerical implementation: `0e260d2`; full machine-readable results are [auto_evaluation_v12.json](../forecast_lab/auto_evaluation_v12.json). Lower is better. Deltas are **Recommended minus baseline**; negative favors Recommended. Point means are not a claim that every family wins.

| Adjustment | Method | Mean scaled error | Mean order proxy |
|---|---|---:|---:|
| Off | Recommended | 0.6355 | 0.5214 |
| Off | actual Current | 1.6516 | 0.7695 |
| Off | fixed Auto | 0.6575 | 0.5551 |
| Off | median combination | 2.1256 | 0.7624 |
| Off | SES | 2.1218 | 0.7607 |
| On | Recommended | 0.6662 | 0.4085 |
| On | actual Current | 1.6802 | 0.6558 |
| On | fixed Auto | 0.6899 | 0.4463 |
| On | median combination | 2.1561 | 0.6511 |
| On | SES | 2.1542 | 0.6518 |

| Adjustment | Baseline | Scaled-error delta [90% CI] | Order-proxy delta [90% CI] |
|---|---|---|---|
| Off | actual Current | −1.0161 [−1.3092, −0.7680] | −0.2481 [−0.3033, −0.1926] |
| Off | fixed Auto | −0.0219 [−0.0545, +0.0081] | −0.0337 [−0.0672, −0.0019] |
| Off | combination | −1.4900 [−1.8388, −1.1832] | −0.2410 [−0.2902, −0.1939] |
| Off | SES | −1.4862 [−1.8336, −1.1789] | −0.2393 [−0.2876, −0.1920] |
| On | actual Current | −1.0139 [−1.3081, −0.7651] | −0.2473 [−0.3021, −0.1917] |
| On | fixed Auto | −0.0236 [−0.0551, +0.0058] | −0.0378 [−0.0703, −0.0068] |
| On | combination | −1.4898 [−1.8361, −1.1810] | −0.2426 [−0.2918, −0.1948] |
| On | SES | −1.4879 [−1.8336, −1.1800] | −0.2433 [−0.2915, −0.1966] |

Worst relative order-proxy family versus Current: level jitter with adjustment off (0.06255 vs 0.05983), restricted supply with adjustment on (0.05874 vs 0.05452). These are regressions, despite aggregate improvements. **The claim “beats all four baselines” is not established**: fixed Auto's scaled-error CIs cross zero, and independent held-out Stress results remain untested by this lane. Do not promote the default.

### Cost on the supplied synthetic 1000-product demo

All runs used `data/demo-1000.json` (24 history months). No values from that file were used for tuning. Three runs on this local machine: JS pure-selector median **155.1 ms**, full Node-VM catalogue calculation median **1621.5 ms**, Python pure-selector median **1354.0 ms**. The first JS pure-selector run was 191.4 ms. Full calculation retained the same **20 held rows** as Current, with 980 fitted recommendations. These CPU measurements do not include DOM painting.

One fresh offline headless-browser load per mode, including parse, evaluation, DOM and two animation frames: Current **908.6 ms**, Recommended **1439.3 ms** (1000 rows, 20 held in each; no page errors/network requests). This is a single local cold-load observation, not a cross-device performance guarantee. A first timing probe wrongly waited for a presentation-only readiness attribute not set by demo startup and timed out; the corrected probe verifies the real 1000-row catalogue and selected mode instead.

### Verification receipt

- Failing-first tests were run before the API, adapter, evaluator, same-month/mode fixes, extreme-range correction and visible-Simple explanation fix.
- Focused Python: **16 passed**. Node recommendation suite: **3 passed**, including **600 random histories × all 12 forecast points and evidence exactly equal in Python/JS**, and 40 stockout/safety-basis adapter cases.
- Real offline browser UI harness: **23 checks passed**, 1440/390 light/dark screenshots, mixed method IDs, visible product/Why reasons, persistence and no network/runtime errors. This is not installed Desktop proof.
- Full `node --test tests/*.mjs`: **3589 passed, 4 failed (3593 total), exit 1**. The failures are the two historical Desktop source-byte pins and the two round-two protected-maths source-byte pins. No pins were weakened or updated in this lane; integration must review/refresh combined v1.2 bytes.
- Full `/usr/bin/python3 -m pytest -q`: **2098 passed, exit 0** with temporary regeneration of every standalone variant and the demo.
- `/usr/bin/python3 -m unittest discover -s tests`: **241 passed, exit 0** (partial discovery relative to pytest, not a substitute).
- `scripts/golden_diff.py`: **unchanged**, exit 0. `scripts/verify_import_examples.py`: **8 files / 8 item records unchanged**, exit 0. `scripts/check_docs.py`: exit 0.
- Generated HTML was restored after verification and is **not committed**. Integration must rebuild it from merged sources. No live data, remote operation, installation or default promotion occurred.

Not checked: independent Stress-held-out families and the must-beat-every-baseline gate; installed Hermes Desktop; real ERP/stock/cost outcomes; long-run expiry/fill-rate or equal-stock-value superiority. The basic-Current candidate approximation remains deliberate and visible, not a claim of exact full-Current reproduction.

## Reproduction and verification

```sh
export TMPDIR="$PWD/.scratch" PYTHON=/usr/bin/python3
/usr/bin/python3 -m forecast_lab.auto_synthetic --output .scratch/auto-evaluation.json
/usr/bin/python3 -m pytest -q tests/test_auto_method_v12.py tests/test_auto_synthetic_v12.py
node --test tests/auto-method-v12.test.mjs
# Optional existing local Playwright/Chromium; no install:
node tests/capture-auto-v12.cjs
```

The browser harness takes `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`, builds only under `.scratch/auto-ui/`, blocks HTTP/network requests, and checks the real settings selector, mixed method labels, Why explanations, withheld risk, reload persistence, and 1440/390 light/dark report views. This is file:// offline-browser evidence, not an installed Hermes Desktop test.

Full-suite checks require temporary regeneration of all standalone variants, including `stock-runway-demo-1000.html`. Lane M does not commit any generated HTML; integration owns the rebuild and final combined source-pin updates. Four historical Node whole-source byte guards intentionally still pin pre-v1.2 bytes; their failure must not be disguised as a numerical regression or silently bypassed. Existing golden files are never rewritten.
