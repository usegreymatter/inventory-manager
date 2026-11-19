Lifecycle: living

# Forecast lab contract

Inputs: monthly series (continuous quantities); spec in `../docs/forecast-lab/INTEGRATION.md`.
Job: deterministic standard-library forecast methods and held-out selection; no I/O. The JS twin is root `../forecast_lab.js`, which must give the same numbers.
Output: method forecasts and selection evidence used by `../engine.py`.
Human check: `../tests/test_forecast_lab.py`, Python–JS bridge tests, `../scripts/golden_diff.py`. Methods are frozen until November 2026 actuals are reviewed (see `../docs/architecture/LEARNING-LOOP.md`).
