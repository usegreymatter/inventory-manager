# Phase 4: simple hybrid default

OWNER-APPROVED Phase 4 simple hybrid (maintainer 2026-11-14).
Local-only change; no live data access, Odoo, installation, network, push or deployment.

## Fixed rule and scope

- Classify the **entire known history prefix** with Syntetos–Boylan ADI/CV².
  Smooth means ADI < 1.32 and CV² < 0.49; equality is not smooth. These
  thresholds are fixed, not selected from the evaluation results.
- With at least three full months and a smooth class, the production champion
  is a flat arithmetic mean of the last 12 months, or all available months if
  fewer than 12 exist. Factors are all one; monthly demand remains fractional.
  The exact method label is **Steady: 12-month average**. With 3–11 months that
  same label means the available-month average, not invented history.
- All other classes retain the **exact legacy champion**. Fewer than three
  full months remain held at the production entry points. Legacy helpers are
  not a supported cross-language forecasting interface below that boundary.
- Python and JavaScript share full-prefix classification, fixed left-fold
  binary64 arithmetic for the new mean, and the same cleaned-history range.
  The raw lab input bounds remain unchanged. Production cleaning can produce
  validated observations above the raw-input cap and supports long histories.
- The champion in every rolling fold is computed only from that fold's prefix.
  Smart challengers and diary corrections retain every existing gate, cap,
  proposal, approval, rejection, withdrawal and undo rule. No new method tuning.
- Censored/project-excluded months remain unobserved; their existing latest
  three eligible observations fallback is unchanged. Complete eligible cleaned
  histories can use the new rule. Raw history and historical backtest/grade
  calculations are unchanged; those old grades are not a fresh accuracy test
  of this new default.
- Rebuilt all five standalone variants from the exact Desktop pure core.

## Existing real-data aggregate (provided evidence, not rerun here)

The prior local replay covered **March–September 2026, 986 products and
16,139 prediction points**. Percentages below are aggregate WAPE and signed
bias (prediction minus actual, divided by actual); negative bias means
under-forecasting.

| Forecast | WAPE % | Bias % |
| --- | ---: | ---: |
| Last 3 months average | 47.9 | -5.9 |
| Last 12 months average | 46.6 | -10.8 |
| Legacy champion | 52.5 | -21.4 |
| New simple-hybrid default | 46.7 | -19.2 |
| Smart selection | 47.0 | -17.0 |

These are owner-supplied aggregate results from the earlier replay. This
closeout deliberately did not reopen the live-pilot data directory. July–
September had already been seen and must not be presented as a new untouched
holdout. The irregular group still under-forecasts by roughly **50%**. The
hybrid is not uniformly best: the plain 12-month average has slightly lower
aggregate WAPE here, and the 3-month mean has materially less negative bias.

## Deterministic synthetic replay

Reproduced with `/usr/bin/python3 scripts/benchmark_simple_hybrid.py`; raw
local result: `.scratch/hybrid-replay.json`. Fixed seed 20261112, 100 synthetic
SKUs, three-month horizons, 870 scored points. Identical histories, cleaning
and smart gates compare the pre-Phase-4 champion seam with this hybrid; latent
truth is read after prefix predictions, not used for method selection.

| Synthetic pattern | Legacy champion WAPE % | Hybrid champion WAPE % |
| --- | ---: | ---: |
| All patterns | 24.49 | 26.58 |
| Smooth | 12.44 | 9.25 |
| Seasonal | 16.85 | 39.19 |
| Shifting Ramadan event | 27.10 | 53.22 |
| Intermittent | 148.06 | 148.06 |

Overall smart WAPE also worsened, **21.29 → 23.55%**. This is not a claim of
universal improvement or a reason to silently retune the approved rule.
Seasonality/event sensitivity remains a known trade-off: an ADI/CV² smooth
series can still have a real calendar pattern. Slow moving means can also lag
recent level changes. Corrections and smart selection are gated fallbacks,
not guaranteed remedies. Intermittent performance remains poor.

## Snapshot sharing and scale proof

The classifier is O(n) over one known prefix. Its result is value-keyed in the
**existing evaluation snapshot**; equal shallow clones reuse it, changed sales
(including in-place edits) invalidate it, and later snapshots recompute it.
Rolling prefixes are distinct inputs and never borrow the full-history class.
No process-global cache or data retention was added.

Performance-only repairs also reuse training-prefix scales and already scored
fold sets within the same selection; bias gates use the same metrics, not
weaker tests. All three conformal quantiles share one validated residual sort.
Forecast eligibility no longer revalidates an already validated history inside
the same lab forecast call. Public validation and adoption formulas remain
unchanged. A deterministic regression compares every metric and eligible
forecast against `4a2bbcb` across 23 histories and six methods, including
constant, zero and fractional cases.

The 1000-SKU/48-month benchmark at `.scratch/probe/p4s9/` measured:

| Gate | Supplied baseline 4a2bbcb ms | This branch ms | Change |
| --- | ---: | ---: | ---: |
| Python, no diary | 2683 | 2551.77 | -4.89% |
| Python, diary + learning | 4104 | 3944.57 | -3.88% |
| JavaScript, diary + learning | 2891 | 2545.07 | -11.97% |
| A3 browser render | 939 | 922.10 | -1.80% |

All four are within the requested +10% ceiling. A3 selection count is exactly
1000; product switch, repeat render and opening the drawer reuse the snapshot.
Earlier measurements were slower and variable while unrelated CPU-heavy jobs
were running; these are elapsed-time measurements, not CI timing guarantees.
The complete benchmark CSV/JSON/diary/log hashes remained identical to this
branch's pre-optimization hybrid run (`.scratch/probe/p4s/`). They intentionally
do not match the pre-feature legacy numbers.

Commands:

```sh
export TMPDIR=$PWD/.scratch
/usr/bin/python3 scripts/bench_scale.py --output .scratch/probe/p4s9
node scripts/bench_scale.mjs .scratch/probe/p4s9/data.json --browser --learning --assert-once
/usr/bin/python3 scripts/golden_diff.py
/usr/bin/python3 -m pytest -q
PYTHON=/usr/bin/python3 FORECAST_LAB_PYTHON=/usr/bin/python3 node --test tests/*.test.mjs
PYTHON=/opt/homebrew/bin/python3 FORECAST_LAB_PYTHON=/opt/homebrew/bin/python3 node --test tests/*.test.mjs
node standalone/capture-a3.cjs
node docs/capture-polish.cjs --label after --guard-only
```

## Verification notes and limitations

The earlier builder's approved golden-number update was preserved. Subsequent
performance fixes do not change those numbers; the final golden diff must say
unchanged on all surfaces. Old numeric/label expectations were repaired without
dropping parity or safety assertions. Legacy byte-oracles substitute only the
approved model/label seam and still compare complete outputs.

The A3 correction/undo browser fixture now has an explicit early observed
spike, keeping this dedicated legacy-path fixture erratic. The original smooth
fixture correctly rejects its old correction under the new champion; the
harness must not demand that an invalid correction be applied. All correction,
archive, undo, decision and reload assertions remain. Separate smooth and
irregular forecast tests remain in both languages.

Browser proof is disposable offline Chromium, not the real Desktop application
or a hosted release. Human visual review, Safari/Firefox, physical touch,
production ERP accuracy and independent controller acceptance are not established
by these local checks. No purchasing guarantee is implied.
