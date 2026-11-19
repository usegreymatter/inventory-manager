# Advisory stockout detection and opt-in planning scenario

## Boundaries

`engine.detect_stockout_months(item, last_month)` is a pure, separate advisory
from the existing `stockout_history` exposure-correction pipeline. Calling the
detector never changes forecasts, planning facts, sales, or settings. The
pre-existing automatic exposure behavior remains the default. The new global
`stockout_adjust` setting defaults to **false**, accepts a strict JSON boolean,
and can be enabled with:

```sh
/usr/bin/python3 stock_runway.py inventory.csv --all --today 2026-11-17 --stockout-adjust
```

This setting opts **order guidance** into a scenario, not a verified estimate of
lost sales. It does not replace source `monthly_sales`, rewrite historical
accuracy scores, add a new forecasting method, or tune anything to a holdout.
Public `forecast()` retains its raw/history projection and historical backtest;
its existing order-date handoff can reflect the adjusted guidance. Consumers
must distinguish the original sales/chart from the advisory purchase scenario.
No order is sent or placed.

## Exact Python / JavaScript contract

Python: `detect_stockout_months(item, last_month)`.
JavaScript integration: `detectStockoutMonths(item, lastMonth)`.

Return JSON-shaped data:

```json
{
  "months": ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
  "flagged": [
    {"month":"2026-09", "index":3, "confidence":"likely", "adjusted_demand":100}
  ],
  "adjusted_sales": [90, 100, 110, 100, 100]
}
```

The example input has `monthly_sales=[90,100,110,0,100]` and
`last_month="2026-10"`. Indices are zero-based, months are chronological, and
`flagged` is chronological. `adjusted_demand` is a number or **null** when there
are fewer than three eligible preceding observations. It is not the observed
sales quantity. No other keys are returned. Missing/invalid sales, an invalid
last month, more than 10,000 sales values, or a history outside the supported
1000-01 through 9998-12 range returns exactly:
`{months:[], flagged:[], adjusted_sales:[]}`.

### Evidence lookup

- Calendar-align sales backwards from `last_month`, including that full month.
- Read `planning_facts.sales_history` and `item.stock_history`. Each accepts a
  list of objects with `month`, or a month-keyed object of row objects. Rows
  outside the history are ignored; rows explicitly naming a different SKU are
  ignored. Missing SKU is accepted for item-local advisory evidence.
- A numeric input must be finite, nonnegative, non-boolean, and within its
  supported bound. Day values must be between zero and that calendar month's
  day count; stock values must be at most the engine quantity limit (1e12).
  Unusable evidence is not a proof of a stockout.
- Today's `item.on_hand` is **not** a historical stock observation.

### Single chronological pass

For each month:

1. **Known** if any matching evidence row has positive `stockout_days`, or has
   `backorder` exactly false and numeric `in_stock_days` below the calendar
   month's day count. Explicit `stockout_days` takes precedence even when
   another row indicates a backorder or positive closing stock.
2. Construct a trailing window from the **last up-to-six preceding NONflagged
   raw observations**, not the preceding six calendar positions. Flagged
   observations are excluded even if no replacement estimate was possible.
   Previously estimated values are never fed back into this baseline.
3. With at least three observations, compute their median. For an even count,
   average the two middle values. With fewer than three, the baseline is null.
4. **Likely**, only if not known, when all of the following hold:
   - the baseline is positive and at least three window observations are
     strictly positive;
   - this is an interior month, with both immediate raw neighbours present;
   - observed sales are **strictly less than 20%** of baseline (including zero);
   - each immediate raw neighbour is **at least 50%** of baseline;
   - every usable historical `on_hand` / `month_end_stock` in matching evidence
     is **≤1**. If none exists, neighbour evidence suffices for *likely* only.
5. Append known/likely flags. Replace that position in a fresh `adjusted_sales`
   list with the trailing median only when the baseline is non-null. Flags
   without an estimate remain visible and leave observed sales unchanged.
6. Only an unflagged raw value is appended to the baseline history.

The right neighbour is only a retrospective isolation check. It never supplies
the replacement baseline. Boundary months cannot be likely flags; explicit
known evidence can flag them. Consecutive zero runs normally fail the neighbour
check, and sparse intermittent sales fail the positive-history gate. Those are
constraints, not guarantees against false positives.

## Opt-in guidance implementation

`order_guidance` keeps its ordinary path when disabled, no flag has an estimate,
the original calculated input is held, or adopted history is locked. An empty
list/object `held` remains held under the existing JavaScript-compatible rule.
Existing invalid/locked history is not repaired by the scenario.

When enabled and at least one flag has a non-null estimate (even if its median
equals observed sales, because original exposure correction might differ):

1. Create a shallow item copy with a fresh adjusted sales list. Remove stale
   `demand_history`, `model`, `monthly_demand`, and `seasonal` fields.
2. If bridge `planning_facts.sales_history` is a list, shallow-copy the facts and
   affected rows. Set affected `quantity` fields to their estimates. For an
   affected row already carrying `in_stock_days`, set that field to the full
   calendar month in this **scenario copy only**, preventing the existing
   exposure pipeline from uplifting a replacement a second time. Preserve
   projects, original errors, supply/commitments, and manual demand settings.
3. Recalculate through `_forecast(adjusted, months, as_of, 6)`, merge its newly
   computed fields, and recursively call **the same** `order_guidance` with an
   explicit `stockout_adjust:false`. Do not implement a second purchase formula.
4. Return that guidance unchanged. The original item/facts/settings remain
   untouched. Scenario guidance history describes its scenario inputs; retain
   the separate detector result and original sales for honest UI disclosure.

## Reproducible sample and demo report

```sh
mkdir -p .scratch
/usr/bin/python3 stockout_report.py --today 2026-11-17 > .scratch/stockout-report.json
```

The stdlib-only report scans **every item** in committed `data/sample.json` and
`data/demo-1000.json`. It emits every flagged item's original/adjusted sales,
flags, and actual before/after guidance fields, including null quantities for
held items. It only reads the datasets and writes JSON to stdout. Custom local
JSON paths may be supplied as positional arguments. The default report date is
fixed (2026-11-17), not the wall clock.

Observed from the committed inputs:

| Dataset | Items scanned | Items flagged | Known months | Likely months | No estimate | Items with changed guidance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Five-item sample | 5 | 0 | 0 | 0 | 0 | 0 |
| Fictional 1,000-product demo | 1,000 | 93 | 0 | 220 | 0 | 78 |

No sample/demo/generator modification was necessary: the existing erratic demo
histories already exercise the *likely* path. They contain no supplied stockout
proof, so **none of these 220 likely flags is a known or verified stockout**.
This is an important false-positive demonstration, not classifier-accuracy
validation.

Actual before/after examples at the fixed planning date, default settings:

| Demo SKU | Advisory replacement | Monthly guidance demand before → after | Purchase qty before → after | Order-by before → after | Run-out before → after |
| --- | --- | --- | --- | --- | --- |
| TIL-STO-01-001 | 2026-01 → 171.5 | 173.08333333333334 → 187.375 | 353 → 386 | 2027-01-19 → 2027-01-16 | 2027-03-25 → 2027-03-13 |
| SEA-CLE-05-005 | Four likely months; see report | 878.6666666666666 → 1942.9166666666667 | 1404 → 3816 | 2027-09-07 → 2027-05-12 | 2028-01-22 → 2027-07-24 |
| TRM-SIL-05-005 | 2025-05 → 25.5 | 41.833333333333336 → unchanged | 198 → unchanged | 2027-08-06 → unchanged | 2027-09-30 → unchanged |

Changing an old month does not necessarily change the current model/window.
Replacing dips can also reduce estimated variability and safety stock; purchase
quantities are not guaranteed to increase. Known flags can replace values with
a lower or zero trailing median: the rule is a replacement, not a monotonic
uplift. Review any scenario before using it to plan.

## Limits

- Sales-only flags cannot distinguish stockouts from erratic demand, seasonality,
  closures, returns, projects, recording errors, or a genuine decline.
- A month-end stock balance can miss intra-month shortages; the ≤1 check is only
  a conservative heuristic condition.
- Neighbour confirmation requires a subsequent observed month. This is an
  advisory on a completed history, not a claim that the flag was knowable at
  that month's forecast origin. Do not treat it as leakage-free holdout proof.
- Three to six observations are a small baseline, not a lost-sales model or a
  confidence interval. "Known" describes supplied availability evidence, not
  certainty about the numeric replacement.
- No thresholds, model choices, sample values, or golden numbers were fitted to
  report/holdout outcomes. The default automatic exposure pipeline is separate.

## Verification / parent integration

```sh
/usr/bin/python3 -m unittest discover -s tests -p test_stockout_advisory.py -v
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 /usr/bin/python3 -m pytest -q tests/test_stockout_correction.py tests/test_project_exclusion.py tests/test_manual_change.py tests/test_cli.py tests/test_golden.py tests/test_settings_control.py
node --check scripts/stockout_parity.cjs
# After the parent integrates the real JS function and opt-in branch:
node scripts/stockout_parity.cjs
```

`tests/stockout_advisory_bridge.py` supplies 1,140 deterministic cases: 135
synthetic detection/guidance cases, plus detection on all 1,005 committed
sample/demo rows. `scripts/stockout_parity.cjs` extracts the **real** Desktop core
without SDK/UI/network and compares detection and before/after guidance with
Python. It intentionally fails if the parent JS function is not yet integrated;
there is no fallback implementation masking missing JS behavior.

Python verification at this branch: 16 advisory tests passed; 200 focused
existing tests passed, including frozen golden-number comparisons. Full suite:
**1,812 passed, one pre-existing standalone CSS-URL guard failure**. The failing
guard rejects the existing local `mask:url("data:image/svg+xml,...")` in the
committed Arctic HTML; `git show HEAD:standalone/stock-runway.html` reproduces
that regex match. No standalone/JS files were edited here. Pytest autoload was
disabled because unrelated installed AnyIO plugin code targets a newer Python
than `/usr/bin/python3` (3.9); no installation was performed.

Not checked here: completed Python/JS parity (parent owns JS integration),
browser/UI behavior, live ERP data, hosted deployment, or stockout accuracy.
