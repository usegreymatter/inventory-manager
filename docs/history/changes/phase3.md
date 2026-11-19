Lifecycle: working
# Phase 3 — Forecasts

Local-only synthetic-data implementation on `phase3-forecast`, baseline `55284fe`.
No ERP/network access, external models, installs, publishing or purchase authority.

## Additive health contract (F7)

OWNER-APPROVED Phase 3 retains `health.features.smart_forecast` as an intentional
additive API change, including on no-new-data datasets. It reports aggregate
`state`, `chip: Smart forecast`, and per-SKU `items` with `state` / `needs`.
This is metadata only; no-new-data purchase fields retain their legacy values.
With monthly history but fewer than four possible selection origins (28 full
eligible months under the held-out split), state is `locked`, not `on`; with
no monthly history it is `hidden`. Legacy whole-health comparisons explicitly
remove this additive feature before comparing previous fields.

## Step 1 — matched production champion

18 complete consecutive eligible months minimum; excluded/censored months lock
smart selection (never compact gaps). At most 1,200 months. Training starts at
12 months; evaluate the latest up to 12 origins, next three months (truncated
final folds). Candidates are the existing lab flat average, seasonal naive,
damped Holt, seasonal, Croston and SBA. Every origin trains on its prefix only.
The comparator is the actual fractional production calendar model, not lab's
flat baseline. Four candidate-eligible origins minimum, >=10% lower point MAE
and no worse absolute signed bias (1e-12 tolerance). Non-flat candidates must
also pass those tests against the flat trailing mean. Choose greatest relative
MAE gain, fixed method order on ties. No pass => unchanged production outputs.

Adopt the next 12 monthly values as one calendar curve; repeat that curve beyond
one year, including trend models. This bounded policy keeps far-runout annual
jumps consistent with projection, order dates, cover and quantities. It is not
an extrapolated indefinite trend. `smart_forecast` health reports per-SKU
Hidden/Locked/On; health alone cannot activate invalid/partial data. Standalone
health without its core fails closed. No added main-screen column or dot.

### Before / after (actual Python + Desktop + CLI)

| sku | field | before | after |
| --- | --- | --- | --- |
| TREND | order_qty | 77 | 96 |
| TREND | order_by | 2027-01-22 | 2026-12-30 |
| TREND | run_out | 2027-02-12 | 2027-01-20 |
| SLOW | run_out | None | 2027-11-30 |
| SLOW | status | no-sales | overstocked |
| SHORT / FLAT | all fields | unchanged | unchanged |
| legacy corpus | all fields | unchanged | unchanged |

Fixtures: `phase3-inputs.json`, `phase3-before.json` (executed from archived
55284fe), `phase3-numbers.json`. Golden command:
`/usr/bin/python3 scripts/golden_diff.py --inputs tests/golden/phase3-inputs.json --output tests/golden/phase3-numbers.json --before tests/golden/phase3-before.json --write`.

Step 1: pytest **1488 passed**, Node **2407 passed / 0 failed**; 120 seeded
selection/projection/full-guidance comparisons (absolute numeric tolerance 1e-9),
selected-method suggested-order parity; constant/short whole-output historical
comparisons. Five standalone builds regenerated. Legacy golden unchanged.

### Pre-existing optional-field discrepancy found

On fallback champion histories, the legacy Python `suggested_order` estimates
use seasonality while Desktop snapshotSafety flattens that optional estimate
without planning facts. Example 18-month synthetic
`[0,0,0,0,0,95,0,0,0,0,45,0,0,0,0,71,0,0]`, stock 120, lead 14:
Python suggested_order=18, JS=12. Actual orderGuidance quantity agrees at 18.
This already exists at 55284fe; preserved rather than silently changing fallback
bytes. Seeded tests compare optional suggested_order on adopted methods only;
full primary guidance and production-selection parity covers every seed.
This is a known remaining legacy defect, not full optional-field parity proof.

## Step 2 — tap-only empirical ranges and method evidence

`forecast_details` / `forecastDetails` are opt-in diagnostics, not extra forecast
output fields. The Why drawer adds Method (one of the compact names) and Tested
as `Tested: N mo` (hidden at zero). Order range is collapsed behind a second tap. No main-screen
content, settings or release dot was added.

Cumulative empirical residuals are computed from the displayed method on prefix
origins, using the entire matching calendar window (not a sum of monthly
quantiles). The endpoint month's error is multiplied by its elapsed fraction;
that proportional within-month assumption is explicitly a rough approximation,
not calibrated daily coverage. Require at least four fully matured windows;
windows beyond 12 months, thin/invalid history and committed-customer-demand
windows suppress the range rather than inventing errors for known obligations.
Quantiles interpolate empirical P50/P80/P95 of cumulative residuals, added to
continuous expected demand and clamped at zero. Net stock and incoming once,
then MOQ/pack round. **No analytic safety quantity is added to empirical tails.**

Recommended is exactly the actual order, not a claim the existing policy is
P80. Raw `p50/p80/p95` demand and `empirical_orders` preserve that distinction.
Lean=min(actual order,P50 order); Stock-up=max(actual order,P95 order), so the
optional policy comparison cannot reverse its labels. This is an enveloped
comparison, not a relabelled calibrated P80 purchase. Bands are selection-sample,
small-sample, overlapping errors; no confidence/service guarantee.

Step 2 golden delta (legacy and step-1 optional corpus):

| sku | field | before | after |
| --- | --- | --- | --- |
| all SKUs | all purchase fields | unchanged | unchanged |

Verification: pytest **1489 passed**; Node **2407 passed / 0 failed** (final
rerun below); 120 seeded full diagnostic comparisons. Offline capture-a3
**143 passed / 0 failed**, including drawer method/tests, second tap, exact
Recommended, compact labels, phone bounds and unchanged main screen. Screenshot
`.scratch/phase3/why-forecast.png` visually inspected: legible, no clipped rows.

## Resume Step 0 — interrupted WIP

Copied the interrupted 15-file diff into the tool-created isolated branch;
regenerated stale A3 output (the initial pytest run had 2 regeneration failures).
Verified 1489 pytest; Node groups 2297 + 110 = 2407, zero failures;
capture-a3 143/0. Commit 8f51286 preserves it without claiming calibration.

## Resume Step 1 — split-conformal ranges

Supersedes Step 2's interpolated production ranges above. Freeze the method on
rolling origins ending before the last 12 months; use that held-out tail only
for calibration of the frozen method. Forecast levels still refit on each
available prefix (rolling time-series conformal, not IID exchangeability proof).
Use the signed one-sided order statistic at rank ceil((n+1)q), without
interpolation. A rank beyond n is +infinity: suppress finite scenarios, rather
than silently claiming a P95 from 11 residuals. Zero-floor final demand only.

Pool mean-normalized residuals from other SKUs in the same Syntetos–Boylan
class when fewer than 19 residuals (this covers the requested ~12 threshold and
the minimum finite P95). Each peer contributes errors of its own frozen method,
matching horizon and endpoint fraction. Deduplicate SKU identities; no opposite
classes or invented pool. The A3 drawer passes the visible dataset's items.
With no eligible peers the main screen is unchanged and ranges stay hidden.
Classes are introduced here solely to make pooling possible; visible routing
labels follow in Step 4. Overlapping windows, prefix refits, pooled exchangeability
and within-month proportionality remain assumptions, not coverage guarantees.

Golden delta vs 8f51286 (scripts/golden_diff.py --write, three surfaces agree):

| sku | field | before | after |
| --- | --- | --- | --- |
| SLOW | run_out | 2027-11-30 | None |
| SLOW | status | overstocked | no-sales |
| legacy corpus | all fields | unchanged | unchanged |

The old 36-month sparse fixture no longer clears the earlier selection split;
it correctly falls back to the legacy champion. The adoption/status regression
now uses 48 months where a candidate clears the split, not a forced adoption.
Verification: pytest 1493/0; focused Node 3/0 (120 production seeds and 40
full pooled-diagnostic seeds). Existing lab differential suite 7/0 also ran.

## Resume Step 2 — scale-free scoring gate

Supersedes the raw MAE adoption rule above. Per fold, scale only from the
training prefix: seasonal lag 12 at >=24 months, otherwise naive lag 1; zero
seasonal differences fall back to lag 1. All-constant training with nonzero
errors has undefined scaled error (null), never a unit-dependent epsilon.
MASE=mean(|e|/mean(|training differences|)); RMSSE is the square root of mean
(e²/mean(training differences²)). CFE=sum(actual-predicted); PIS is negative
sum of chronological one-step cumulative errors (not duplicated overlapping
horizons). Scaled CFE/PIS use each fold's training scale.

Report scaled pinball mean(max(q*e,(q-1)*e)/scale), q=.5/.8/.95. Corrections
use only previously matured same-horizon residuals; before finite calibration,
score the point forecast, not an invented quantile. Coverage reports counts
and null rates if no finite check. P95 checks are normally absent in a short
selection window: null is not 95% success. Live purchase outputs never grow
these diagnostic fields. `forecast_selection.accuracy` and lab accuracy report
these metrics; archived pre-Phase-3 benchmark JSON/REPORT remain historical,
not refreshed accuracy claims. New `phase3-scoring.json` records synthetic
per-SKU production evidence including all challenger comparisons.

Adopt only >=10% lower MASE, RMSSE no worse (1e-12), |scaled CFE| no worse
(1e-12), >=4 finite prequential P80 checks and P80 coverage >=.60 (target .80,
tolerance .20). Apply against matched production AND flat comparator. Pick
largest relative MASE gain; fixed method order on ties. Selection is not
independent final validation. The laboratory now follows the same gate/split;
its standalone finite tails also refuse the unattainable P95 order statistic.

Golden --write table vs Step 1:

| sku | field | before | after |
| --- | --- | --- | --- |
| all SKUs (phase3 and legacy) | all fields | unchanged | unchanged |

Verification: pytest 1496/0; focused Node 10/0 before the additional fixed-number
JS assertion; hand-derived Python tests for MASE/RMSSE/pinball/CFE/PIS and gate
rejections. Production parity 120 seeds; pooled diagnostics 40 seeds; lab
full-output differential 1452 comparisons.

## Resume Step 3 — lead-time demand reorder maths

Only with the existing safety-stock opt-in, >=24 eligible complete months,
>=3 positive observations and nonzero recent variation: intermittent/lumpy
SKUs use 4096 IID resamples of observed monthly values (fixed shared LCG seed
271828). Sum floor((lead + review_days)/30) independent draws plus one proportional
fractional month. No Markov transitions, size jitter, Willemain bootstrap,
receipt spread or unobserved demand is invented. OWNER-APPROVED Phase 3:
smooth/erratic SKUs keep the existing analytic buffer and reorder point, not
the laboratory normal-quantile path.

Reorder point is ceil(lead-time demand service quantile). Added safety units
are ceil(max(0,quantile - empirical expected lead demand)), once, before packs
and MOQ. Cover demand remains the existing forecast window. Buffer days still
advance the deadline only; review_days is included in the quantile protection
window (lead + review_days), matching the old analytic buffer horizon. This is
a fixed-lead IID-month approximation,
not a daily or random-lead service guarantee. Short/censored/excluded/constant
histories retain the old outputs; default-off outputs stay byte-identical.

Golden --write vs Step 2:

| sku | field | before | after |
| --- | --- | --- | --- |
| phase3 and legacy corpus | all fields | unchanged | unchanged |
| synthetic 24-month slow SKU | reorder point (backup on) | 15 | 10 |
| synthetic 24-month slow SKU | safety units (backup on) | 12 | 8 |

The extra two rows are the focused fixed-number unit fixture (30-day lead,
18 zeros and six tens), not an unrecorded production dataset. Verification:
pytest 1499/0; focused Node 12/0; additional 24 lead/service/sample cases
compare the pure quantile and enabled inventory planning across Python/JS.

## Resume Step 4 — calendar challenger and routing classes

Embedded identical Gregorian Ramadan-1 / Eid-al-Adha starts for 2015–2035 in
both ports; two Ramadan starts in 2030 are retained. Frozen from the installed
ICU `islamic-umalqura` calendar offline; no live calendar/network lookup.
OWNER-APPROVED compact drawer label: **Approx dates**; the title retains
**approx (Umm al-Qura), confirm locally**. These are calculated
starts, not official local sighting decisions; dates can differ by a day.

Explicit per-item `calendar_forecast: true` enables only an extra seasonal
challenger, never an override. >=36 prefix months, >=2 observations of each
start-month event, >=12 ordinary months, all dates inside the table. Estimate
event-month mean effects against ordinary months, remove them, fit the existing
seasonal model, then add effects for future shifting start months. It represents
start-month indicators, not an entire Ramadan daily window. Still must beat
both comparators through exactly the Step-2 gate; unsupported dates fall back.
Optional health gate reports Hidden/Locked/On; Why shows the approximation note.

Routing-only classes: Syntetos–Boylan uses ADI >=1.32 and positive-size CV² >=.49
(intermittent/lumpy/erratic/smooth; inactive for no positive values). ABC ranks
trailing-12-month demand value only when every eligible SKU has a valid positive
unit cost; otherwise quantity share, never a mix. Descending weight / SKU tie
order; cumulative share before current item <80%=A, <95%=B, else C. XYZ uses
full-series population CV <=.5=X, <=1=Y, else Z. Require >=18 monthly values;
duplicated identities are omitted. Health locks partial/invalid calendar data.
One compact Why row, e.g. `Class: AX Smooth`; no main-screen content or routing
of purchase maths is added. Quantity-share labels are not cross-unit economics.

Golden --write vs Step 3:

| sku | field | before | after |
| --- | --- | --- | --- |
| phase3 and legacy corpus | all fields | unchanged | unchanged |

Verification: pytest 1502/0; focused Node 18/0 including exact table, 24 optional
calendar-selection/class comparisons, 40 pooled diagnostics, 24 reorder cases;
health's 320 seeded malformed-data cases preserve Python/JS parity.

## Still off

Item links/donor selection, receipt lead-time spread, nested independent model
validation, real-data accuracy claims, automatic orders, ERP writeback, hosting,
TimesFM installation/inference. Step 2+ details follow in their own commits.

## Finish Step 1 — lead-demand parity (SR-P3-PARITY)

Root cause: test adapter omitted lead_demand from its physical allow-list; both
production engines already emitted identical physical and guidance values at seed 4.
Added the field and a focused 24-month cleaned-history regression; enabled PYTHON
selection in the bridge test. This exposed a Python 3.14 compensated-sum drift
on locked planning-facts fallback; that fallback now uses planning_sum, preserving
legacy no-facts summation. Both Python paths: stockout Node 6/0. Golden before/after:
all SKUs/all fields unchanged (`/usr/bin/python3 scripts/golden_diff.py --write`). Five builds rebuilt.

## Finish Step 2 — external challenger archive

Added bounded `forecasts.csv` ingestion to canonical bundles (CLI + bridge),
external p50 scoring on identical production folds/gates, optional explicit
origin vintages, and import through Desktop/A3's existing bridge JSON picker.
No provider calls/install. Incomplete history/future curves cannot cherry-pick
folds; external must beat champion and flat comparator and the strongest passing
internal candidate to win. Source/flags retained; heuristic tails discarded;
all cumulative intervals still require held-out conformal evidence. Missing P95
suppresses the range. Untimestamped target schedules require caller-frozen
historical provenance; scores cannot prove the provider avoided hindsight.

Actual synthetic gate-mechanics fixture (oracle-like archive, NOT skill evidence):

| sku | field | before archive | after archive |
| --- | --- | --- | --- |
| EXT | method | baseline | external |
| EXT | order quantity | 127 | 157 |
| EXT | runout | 2026-11-28 | 2026-11-23 |
| EXT | order by | 2026-11-07 | 2026-11-02 |
| legacy corpus | all fields | unchanged | unchanged |

`/usr/bin/python3 scripts/golden_diff.py --write`: unchanged legacy corpus.
Phase-3 golden regenerated: unchanged tracked bytes; existing baseline deltas
remain TREND 77→96, order-by 2027-01-22→2026-12-30, runout
2027-02-12→2027-01-20. Tests: external pytest 6/0; Node external 2/0 under
both Python paths, covering full selection/guidance/diagnostic parity, winning,
losing, incomplete, duplicate, invalid origin/source, vintaged archives, import,
heuristic-tail refusal and historical no-archive bytes. Five standalone builds.

## Finish Step 3 — benchmark finite-tail truth

Before: runner raised TypeError on float(None) for a suppressed P95. After:
500 synthetic SKUs / 1,400 outer folds complete. All 4,200 marginal interval
opportunities suppressed, zero finite P95; coverage/mean width null (not zero
or perfect coverage). Every raw candidate MAE/WAPE metric remains identical
to the previous JSON. Selected metrics changed with the previously installed
scale-free lab gate and frozen selection/calibration split, not runner tuning.
REPORT.md and benchmark_results.json refreshed from the executed result; the
old interpolated coverage claims are withdrawn. Targeted synth tests 12/0.
Golden before/after: all legacy SKUs/all purchase fields unchanged.
