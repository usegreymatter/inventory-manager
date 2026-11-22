Lifecycle: proposed (design only; builds on code that already exists, listed in §1)

# Learning loop: forecasts that check themselves

## In plain words

Every time Inventory Manager runs, it can save what it predicted. When the real sales for that month arrive, it compares them and keeps score: how far off it was, whether it guesses too high or too low, and whether its "likely range" really caught the truth as often as it claimed.

Alternative forecasting methods run quietly in the background ("shadow models") and are scored the same way. If one keeps doing clearly better, Inventory Manager **suggests** switching. A person approves, and the Python and JavaScript versions are proven to give identical numbers before the switch ships.

A planned Monte Carlo step (many simulated futures) turns this into a plain risk number: "about a 1 in 8 chance of running out before the next delivery."

What doesn't change:

- **The forecast methods are frozen until November 2026 actuals have been reviewed.** Work before then only records and scores. Shadows and calibration change no order quantity.
- Range calibration and Monte Carlo are **display only** until the owner approves using them in order maths.
- Nothing learns from data the user didn't choose to save (archives are opt-in, as today).

## 1. What already exists (do not rebuild)

| Piece | Where | What it does |
|---|---|---|
| Forecast diary v1 | `engine.forecast_diary`, CLI `--forecast-diary PATH`, standalone `localStorage['stock-runway.forecast-diary.v1']` | Per SKU per run: `as_of`, `method`, `scale`, next 3 months `p50`, `base_p50`, `p80`, `p95` (one-sided upper, null when conformal evidence is short) |
| Learning log v1 | `engine.learning_events`, `--learning-log`, `stock-runway.learning-log.v1` | Append-only state events with stable ids, before/after numbers, owner approvals |
| Scoring | `learning.matured_entries`, `learning.metrics`, `learning.score_diary` | Horizon 1 only, completed months only: count, WAPE, accuracy, bias, CFE, MASE, p50/p80/p95 coverage |
| Drift alert | `learning.pattern_changed` | 6-month scaled CUSUM → `pattern_changed` alert |
| Bias correction | `learning.bias_correction` | Capped 0.85–1.15 multiplier; needs 6 matured months and owner approval above ±15%; retention gate |
| Champion selection | `engine.forecast_selection`, `forecast_lab` | Flat, seasonal naive, damped Holt, seasonal, Croston, SBA, optional external archive; needs ≥10% lower MAE and no worse bias on held-out origins |
| Ranges | phase 3 "split-conformal ranges" | Signed one-sided order statistic, pooled by Syntetos–Boylan class when fewer than 19 residuals |
| Archive safety | `learning.read_jsonl` / `append_jsonl` | `flock`, torn-line quarantine, fsync, id dedupe |

The loop below extends these. Wherever possible it adds new fields beside the existing ones rather than changing their meaning.

## 2. Snapshot data model (diary v2)

One JSON object per SKU per run, appended to the diary. v1 readers ignore v2 rows (they check `version == 1`). v2 readers accept both.

```json
{
  "version": 2,
  "run_id": "3f9c…",                     // random, shared by all rows of one run
  "as_of": "2026-10",                     // last complete sales month (as v1)
  "snapshot_date": "2026-10-31",
  "data_fingerprint": "sha256:…",         // of the canonical bundle bytes used
  "model_version": "engine 0.1.0+<git short sha>",
  "settings_digest": "sha256:…",          // normalized order settings
  "sku": "TILE-SAND",
  "class": "smooth",                      // Syntetos–Boylan class used for pooling
  "champion": {
    "method": "champion", "selected_method": "seasonal_naive", "scale": 4.2,   // v1 writes method "champion"; v2 adds which method won
    "forecast": [ {"month":"2026-11","p50":120,"base_p50":120,"p10":null,"p80":131,"p90":null,"p95":140}, … h=1..3 ]
  },
  "shadows": [                            // never used for outputs; CLI only (see §7)
    {"method":"croston","forecast":[{"month":"2026-11","p50":118}, …]},
    {"method":"bootstrap_q","forecast":[{"month":"2026-11","p10":96,"p50":119,"p90":142}, …]}
  ],
  "lead_time": {"days_p50": 30, "days_p90": null, "source": "supplier_days"},
  "risk": null                            // Monte Carlo block when enabled (§6)
}
```

Rules: numbers are finite and 0..1e12. A missing tail is `null`, never invented. `p10` and `p90` stay `null` until the lower/two-sided calibration ships. A snapshot is written only for non-held items, and never retroactively (same rule as v1).

## 3. Reconciliation (actuals)

- Join key: `(sku, target month, as_of origin, method)`. A target month is "matured" only when it is a complete month in a later bundle. The existing fail-closed rules apply (non-month-end snapshot or `partial_last_month` excludes the last month).
- Actuals come from the **raw** monthly net sales of the newer bundle, the same series the forecast was trained on, before stockout or project cleaning. A cleaned-actuals view is a second, labelled score, never a replacement.
- When history is restated (an ERP edit to a past month), score against the newest bundle and record `restated: true` with the old and new values. Never edit old snapshots.
- Horizons 1–3 are all scored (v1 scores only h=1). Reports lead with h=1 (as today) and show h=2 and h=3 in a details view.

## 4. Metrics

All metrics are computed per SKU, per class (smooth/erratic/intermittent/lumpy), per ABC class and overall, over a rolling window of the last 6 and 12 matured months.

| Metric | Formula (over matured rows) | Use |
|---|---|---|
| WAPE | Σ\|a−p50\| / Σa (undefined when Σa = 0) | headline accuracy (existing) |
| Bias | Σ(a−p50)/n, and CFE = Σ(a−p50) | over/under-forecast (existing) |
| MASE | mean(\|a−p50\| / scale) | scale-free comparison across SKUs (existing) |
| Interval coverage | share of rows with a ≤ pQ (upper) and p10 ≤ a ≤ p90 (two-sided, later) | "the range catches the truth about Q% of the time" |
| Pinball loss | for each quantile q: mean(max(q(a−pq), (q−1)(a−pq))) | scores a whole range, not just the midpoint; compares challengers fairly |
| Lead-time error | received − promised days (from `receipts.csv`) | feeds Monte Carlo lead-time spread |

Report coverage with its sample count and a plain warning below 12 rows ("too few months to judge"). Coverage on fewer than 4 rows is not shown (matches the existing retention gate).

## 5. Champion / challenger

- **Champion**: whatever `forecast_selection` picks today. Unchanged.
- **Shadows** (run every snapshot, never shown as the answer): Croston, SBA and seasonal naive (already in `forecast_lab`); ETS variants beyond the existing damped Holt (additive error, optional damped trend and additive season, from 24+ months); **bootstrap quantiles** (moving-block bootstrap of the champion's in-sample residuals, block length 3, giving p10/p50/p90 directly); plus any external archive (`forecasts.csv`) that is already supported.
- **Promotion proposal**, raised automatically only when all of these hold:
  1. ≥ 6 matured monthly origins for that SKU class, scored out-of-sample (the snapshot existed before the actual).
  2. Challenger WAPE ≥ 10% lower **and** pinball loss (q=0.5, 0.8, 0.95) lower **and** \|bias\| no worse (1e-12 tolerance), the same bar as today's selector.
  3. Interval coverage within ±10 percentage points of nominal.
  4. It holds across ≥ 60% of SKUs in that class (no promotion from a few lucky SKUs).
- **Promotion itself** is a code change, never a runtime switch. It is a packet that adds or changes a method in **both** `engine.py`/`forecast_lab` and `desktop/plugin.js`/root `forecast_lab.js`, regenerates goldens (`scripts/golden_diff.py --write`) with an explicit before/after table, passes the Python–JS parity suites, rebuilds standalone, and gets **owner approval**. This also respects the freeze: no promotion lands before November 2026 actuals are reviewed.
- Learning log records: `challenger_proposed`, `challenger_dismissed`, `challenger_promoted` (with model_version).

## 6. Calibration and Monte Carlo (display only first)

**Conformal width calibration.** The existing split-conformal p80/p95 stays the source. The loop adds an *observed* check: if rolling 12-month coverage of p80 is below 70% or above 90% for a class, the display widens or narrows the band with a calibrated multiplier. The multiplier is fitted on the matured residuals only, clamped to 0.5–2.0, and shown as "range adjusted from past misses". The multiplier never changes safety stock or order quantity until the owner approves that as a separate packet.

**Monte Carlo stockout risk** (planned round):

- Demand paths: draw monthly demand for each future month as `champion p50 + resampled residual` (moving-block bootstrap, block 3, residuals from the frozen-method calibration tail, pooled by class under the same rule as conformal). Floor at 0. Daily demand within a month = monthly ÷ days (the existing calendar model).
- Lead time: from the empirical received−promised distribution added to `supplier_days` when there are ≥ 5 complete receipts for that supplier. Otherwise lead time is fixed at `supplier_days` and the result says "lead time spread unknown".
- Supply: on-hand, dated open POs on their due dates (late unconfirmed POs excluded, matching the existing hold), plus the proposed order arriving at order date + sampled lead time.
- Outputs per SKU: `p_stockout_before_next_receipt`, `p_stockout_in_cover_window`, expected shortage units, runout-date p10/p50/p90, the path count and the seed.
- **Parity:** Python and JS must give identical numbers, so neither `random` nor `Math.random` is used. Both use one shared 32-bit PRNG (e.g. mulberry32/splitmix32, spec and test vectors in the packet), seeded from the first 4 bytes of `sha256(data_fingerprint + sku)`, with integer index arithmetic and the existing `planning_sum` summation order. Default 2,000 paths. A scale benchmark (`scripts/bench_scale.*`) must stay under budget for 1,000 SKUs in the browser before it ships.
- Display: "About 1 in 8 chance of running out before the next delivery", with the inputs listed. It is not a guarantee, and nothing auto-orders on it until AUTOMATION's anomaly and cap rules are extended by an approved packet.

## 7. Where snapshots live

| Surface | Store | Retention / size |
|---|---|---|
| CLI | Explicit `--forecast-diary PATH` (JSONL, existing locked append). v2 adds shadows and risk. Suggested default dir when the user opts in: `<data dir>/.stock-runway/diary.jsonl` (git-ignored) | Keep everything. Typical size: 1,000 SKUs × 12 runs × ~1.5 KB ≈ 18 MB a year |
| Desktop plugin | Same JSONL through the plugin's storage boundary | Same |
| Standalone HTML | `localStorage['stock-runway.forecast-diary.v2']` (champion block only, no shadows) plus **Export / Import diary** as a JSON file the user keeps | Cap at 24 origins per SKU and about 3 MB. Over the cap: drop the oldest and tell the user to export. Corrupt storage pauses learning without overwriting (existing `learning-a3.js` rule) |

Migration: v1 rows stay readable forever. The standalone page copies v1 into v2 once and keeps the v1 key untouched for rollback.

Privacy: snapshots hold SKUs and quantities only, never supplier contacts or costs beyond what the bundle already holds. They never leave the device unless the user exports them.

## 8. Tests the loop must add

- Reconciliation: synthetic diary plus a later bundle gives exact WAPE, bias, MASE, pinball and coverage on hand-computed fixtures (Python **and** JS, same numbers).
- v1/v2 coexistence: v1 rows still score identically, and v2 rows are ignored by v1 code paths.
- Shadow isolation: golden outputs are byte-identical with shadows on and off.
- Monte Carlo: PRNG test vectors match across Python and JS. Fixed seed gives identical probabilities. Zero-variance input gives the deterministic answer.
- Freeze guard: a test asserting `forecast_selection` outputs on the golden corpus are unchanged until the promotion packet updates them on purpose.
