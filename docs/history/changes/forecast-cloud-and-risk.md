# Forecast cloud and run-out risk (display only)

Status: display-only advice. Point forecasts, order quantities and goldens are
unchanged (`scripts/golden_diff.py`: all SKUs unchanged). Forecast methods stay
frozen until November 2026 actuals; nothing here was tuned on the July–September
2026 holdout.

## What the owner sees

- **Forecast cloud** on the product chart: a darker 50% band and a lighter 90%
  band around the existing forecast line. Tooltip: "Expected · likely · wide".
  The month table has a **Likely range** column.
- **Chance of running out** on the product page: before the suggested order
  arrives, and during the cover period after ordering.
- **Order amount slider** (−50%…+100%) re-runs the same scenarios with a
  different order size. It changes nothing; it is a what-if.
- **Run-out risk** optional worklist column (not in Simple).

## Method (full contract in the `risk.py` docstring)

- Bands: absolute one-step errors from the product's own history (last 60
  origins, frozen method), 50%/90% quantiles, widened by √horizon, floored at 0.
  Fewer than 8 errors → wider default band, labelled thin history.
- Risk: 1,000 simulated paths per product. Demand = 3-month moving blocks of the
  product's own history, scaled to the current forecast. Lead time = scenario
  multipliers {0.9, 1, 1, 1.1, 1.25, 1.5} unless supplier evidence exists.
  Includes on-hand, on-order, dated receipts and local orders.
- Reproducible: seed from SKU + as-of date; shared xorshift32 PRNG in Python and
  JavaScript (no Math.random / random).

## Limits

- These are model estimates, not calibrated real-world probabilities.
- Lead-time spread is a scenario set, not fitted to real supplier history.
- The risk numbers never change order quantities. Whether they ever should is an
  owner decision after November actuals.

## Verification (2026-11-17, synthetic and sample data only)

- Python/JS parity: `tests/risk.parity.test.mjs` + `tests/risk-adapter.test.mjs`,
  849 passed / 0 failed.
- Coverage on 2,000 synthetic series from a known process (not the holdout):
  50% band 50.85%, 90% band 89.75%.
- Python: `cd tests && /usr/bin/python3 -m unittest test_risk test_stockout_advisory test_stockout_correction test_demo_catalog` → 41 OK.
- Browser: `node standalone/capture-risk.cjs` 47/47 checks, no errors, no
  network. Single-product risk ~1.6 ms cold; slider update 75–145 ms headless on a
  shared machine (budget 200 ms).
- Historical sample-derived numerical example retired in synthetic-data
  publication refresh; regenerate current results with
  `node standalone/capture-risk.cjs`. The dated verification counts and
  independently synthetic coverage results above remain historical receipts,
  not a rerun against the refreshed catalogue.

Not checked: real devices/Safari, Arabic UI, live inventory, real-world
calibration of the bands or risk.
