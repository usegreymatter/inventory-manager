# APPROVED 2026-11-18 by owner — November 2026 forecast pre-registration

**APPROVED 2026-11-18 by owner. This approves the protocol, not a promotion decision, and is not evidence that November outcomes were scored.** No real export was opened to prepare or test it. Freeze the approved commit and SHA-256 before accessing actuals; late approval must be disclosed as retrospective registration rather than rewritten as prospective proof. The approval date alone does not establish prospective registration.

## Frozen candidates and inputs

The machine-readable candidate list and constants are [nov-2026-candidates.json](nov-2026-candidates.json): **Current, Auto-fixed, median combination, Theta, SES**, each with Sales variation **off/on comparison against Past forecast misses** (ten configurations total). “Off” means the existing Sales variation safety-stock basis, not zero safety stock. Current + Sales variation is the champion. All smoothing, classification and buffer formulas are the exact committed `forecast_methods.py`, `engine.py` and shared method spec; the scorer hashes these sources as well as this document and the candidate JSON. Auto-fixed uses recent decline/observed-zero rules and naive for dying demand; no seasonal-naive resurrection. Do not add, remove or re-fit candidates after outcomes are inspected. New candidates require a new forward registration.

Fit inputs must be dated **on or before October 2026**, with no November values passed to classification, error quantiles or model fitting. July–September 2026 is already-seen **diagnostic only**, never a clean holdout and never used for rule/threshold selection. The repository sample remains `sample_pre_july` only in development diagnostics. No tuning on that protected interval. Any future use of July–September as past observations in a November forecast is disclosed as historical fitting, not selection or validation; it does not make those months a holdout again.

The local scorer accepts explicit JSON `months` (consecutive YYYY-MM), `items` (`sku`, `monthly_sales`, optional `censored_months`). A complete October prefix and observed November are required for accuracy. Decision outcomes require the full **three-month November–January window** (`ceil((14+60)/30)=3`); until January 2027 actuals exist, inventory comparisons are **PENDING**, numeric promotion fails closed, and November reports accuracy only. Known censored December/January targets exclude those SKUs from decision replay and are counted separately. Censored training months remain observed sales, identically for every candidate; no uncensoring is claimed. A complete October prefix and observed November are required; duplicate SKU, malformed/month gaps, invalid quantities, or incomplete histories fail closed. Known censored target months are excluded and counted; no missing actual becomes zero. No reconstruction of true demand from sales is claimed. Optional facts not supported by this prototype are not silently interpreted as actual stock/cost/lead history. The scaffold uses the frozen **synthetic policy scenario**: unit cost 1, starting stock = trailing-prefix-12 mean, deterministic lead 14 days, review 30 days, two months cover, no open receipts, one recommendation and uniform within-month demand. It is not a historical operational replay. A production promotion requires a separately reviewed actual-stock/cost/receipt replay adapter; scaffold PASS is never sufficient authority to change the default.

## Primary accuracy outcomes

Score **total demand in a lead-time window**, `P = max(1, ceil(lead_days / 30))` complete monthly buckets (P=1 at this checkpoint). The monthly proxy for a 14-day lead is explicit; do not pretend November alone validates longer lead times or a protection-period total. December–February follow-up adds longer complete horizons when actuals exist. Any incomplete target window is pending/excluded, not extrapolated.

For each SKU, forecast its P-month total from the October prefix. Scale squared cumulative error by the mean squared differences between historical rolling P-month totals separated by 12 months (lag 1 for histories <24 months, or if the seasonal denominator is zero). Compute unweighted SKU-mean RMSSE and signed scaled bias; zero scales are **unavailable and counted**, not perfect forecasts. Also report total unit bias and aggregate bias percent when actual demand is positive. RMSSE and absolute bias must not worsen vs Current. MASE/WAPE can be secondary, never a replacement for mean-targeting metrics. No sales-value weighting is claimed while every simulated cost is 1.

## Decision outcomes at equal inventory value

Primary decision metric: replayed unit **fill rate**, with **stock-out days per case** alongside it, at the **same average end-of-day inventory value** as Current over the complete three-month decision horizon, never the truncated November-only ledger. This is not cycle service level, and a 95% cycle target is not a guaranteed 95% fill rate. A common nonnegative safety-buffer multiplier per candidate/group is calibrated by fixed bisection, never by per-SKU winner selection. Budget tolerance is 0.5%; multipliers are bounded at 128. MOQ/date switches and the zero-buffer inventory floor may make a budget infeasible. Report the actual gap and nearest policy; unmatched or observed non-monotone candidates cannot pass or be called equal-spend winners. Matching on observed replay inventory is an ex-post diagnostic, not an executable forward budget guarantee. Keep all planner holds as no-order cases. The development frontier is 0.8x/1x/1.2x Current stock value.

## Pass rule — APPROVED 2026-11-18 by owner

A new default is eligible only when **all** hold:

1. At least **30 paired eligible SKUs** overall; per-class promotion independently needs **30 paired SKUs in that class** (classification at the October prefix only).
2. Equal inventory is matched within 0.5% and fill rate improves by **at least 1.0 percentage point**; stock-out days per case do not increase.
3. A paired **SKU-cluster bootstrap**, 1,000 resamples, seed 20261118, retaining every origin of each sampled SKU, yields a **90% interval for fill-rate improvement whose lower bound is strictly above zero**. For 30+ SKUs, zero-demand SKUs remain in inventory but no-demand fill-rate denominators are unavailable; missing bootstrap denominators are counted. Report all candidates, not only the best. These are exploratory per-candidate intervals without multiplicity correction; promotion also requires the rolling follow-up and independent review, not cherry-picking the best November interval.
4. Lead-window RMSSE and **absolute signed scaled bias** are no worse than Current; report zero-scale exclusions. The primary accuracy denominator and decision denominator are named separately.
5. Human review confirms censoring, actual supply/cost provenance and the production replay adapter. **The scaffold never activates anything**, even if its numeric gate passes. Protocol status: **APPROVED 2026-11-18 by owner**.

## Inconclusive or adverse result

**Keep Current.** Missing or thin histories, unavailable denominators, unmatched budgets, a CI touching/crossing zero, worse bias, or conflicting class results are inconclusive/fail, never “nearly passed.” Publish negative results as well as positive ones. A per-class exception must satisfy the same predeclared class gate and human approval; it cannot be discovered by post-hoc segment fishing.

**One month is a checkpoint, not final proof.** Repeat the unchanged comparison on rolling December 2026, January 2027 and February 2027 origins, fitting only information available before each origin, retaining each monthly report. A later protocol change gets a new version/hash and future-only evaluation. Report drift, achieved error-quantile coverage and service separately; no claim that the experimental buffer reaches its target follows from synthetic fill rate alone.

## Local scaffold launch

```sh
/usr/bin/python3 scripts/score_november.py /explicit/local/export.json --output .scratch/november-report.json
```

The script performs no network calls or writes outside its requested output. It hashes this document, candidate configuration, implementation files and exact input bytes into the report, exposing subsequent changes. Do not commit client inputs/reports; only synthetic fixtures are allowed in this repository. This task tested the launch on a generated synthetic November-shaped fixture only. It does not authorize opening the live pilot directory, ERP access, purchases, sending, installation, deployment, or changing Current.
