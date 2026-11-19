# Forecast methods: final local verification

## Outcome and boundaries

Implemented opt-in forecasting library, per-product demand classifier/Auto rule table, seven advisory industry presets, shared Python/JavaScript planning adapters, Arctic + Desktop settings/product labels, CLI flags, deterministic synthetic benchmark and all generated HTML. **Current stays the default and remains unchanged.** No holdout tuning, install, network, push, ERP or purchase side effect.

Functional checks pass. **Performance qualification:** product opens in a 5k catalog do not regress, but Auto cold catalog evaluation is **19.1% slower** (4459 → 5311 ms). If “5k-SKU open” means cold loading the whole catalog rather than opening a product, that stricter no-noticeable-regression criterion is **not met**. No fast-product claim masks this limitation.

## Executed gates

| Gate | Final observed result |
|---|---|
| `node --test tests/*.mjs` | 3465 passed, 0 failed; `.scratch/methods-verification/node-tests-final.log` |
| `cd tests && PYTHONPATH=.. /usr/bin/python3 -m unittest discover -p 'test_*.py'` | 169 tests OK; `.scratch/methods-verification/python-tests-final.log` |
| Real subprocess CLI tests (`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q tests/test_methods_cli.py`) | 31 passed, exit 0 |
| `scripts/golden_diff.py` | All SKU fields unchanged across Python/JS/CLI |
| `scripts/verify_import_examples.py` | PASS, all 8 example files / 8 records identical |
| Library exact parity | 811 histories / 673 distinct series × 16 methods; 12,976 vectors / 414,736 points, exact public outputs |
| Integrated planner parity | 600 varied catalog series, all 16 methods represented; exact curves, class/method metadata, quantities, dates and safety stock |
| Effective-method metadata parity | 2,000 method/history fits exact; internal multiplicative fallback tested |
| All named/default/demo HTML builds | 8 named + default + separate demo-1000, exit 0; default equals option-gm-b by `cmp` |
| Every `standalone/capture-*.cjs` | 23/23 exit 0, background batch; `.scratch/methods-verification/captures.json` |
| Method settings capture, final targeted rerun | 46/46 checks; persistence, reset/import/export, presets, all methods, desktop/390px light/dark, no page errors/network |
| Source integrity | Exact embedded method JS, mutation guards retained, historical backtest bytes unchanged, `git diff --check` passed |
| Independent reviews | Opus SHIP; method-label fallback corrected; final second check SHIP |

Final capture runner enumerated every matching script and saved full individual logs. The method capture was rerun after strengthening the phone screenshot to show the entire Forecast method group below the sticky header. Screenshot review found no forecast-group clipping/overlap on desktop or 390px dark; helper text remains dense but readable. Earlier transient failures (old source pins and a test navigation overlay) were corrected, not suppressed. No thresholds were relaxed.

## 5k synthetic catalog, final code

| Measurement (median ms, 5 fresh contexts/method) | Current | Auto |
|---|---:|---:|
| Cold 5k catalog evaluation | 4459.40 | 5311.30 |
| Method-change handler | 4809.10 | 5755.70 |
| Cached table redraw | 7.60 | 7.90 |
| Product-open handler | 11.15 | 8.90 |
| Product open through two frames | 71.30 | 68.30 |


Five fresh contexts per method, ten process classes, 100 product opens, all 5,000 Auto rows checked for requested-method metadata. Trusted scratch fixture injection, **not** importer throughput. Cold and settings calculations remain synchronous multi-second work. Auto retains 17 supported-calendar holds among dying-demand rows; Current has none. These rows remain included in measurements. Detailed ranges/raw results: `.scratch/methods-scale/report.json`; earlier pre-optimization runs remain described in [performance notes](forecast-method-performance.md).

## Benchmark interpretation

Final-code run: 3,000 known-process synthetic series, 9,000 prefix-only origins, 27,000 target points per method; 600 paired one-order inventory cases/method. All 221 documented method/group rows match final JSON. Synthetic Current → Auto: MASE 1.3153 → 1.0305, RMSSE 1.7165 → 1.3115, fill rate 0.8373 → 0.9087, average inventory value 121.9909 → 149.7961. Higher service costs more stock; the five-series pre-July sample does not reproduce the headline improvement. This is **synthetic sensitivity evidence**, not validated operational performance. Existing Current-calibrated ranges/probabilities are withheld for alternatives.

The shared spec is `docs/forecast-methods-spec.md`; results and limits are `docs/history/changes/forecast-methods.md`. Only the pure-block SHA-256 and a comment changed in `docs/import-logic-baseline.json`; source/sample/import hashes there are frozen. Intentional new settings bytes have their own small manifest; the engine guard references immutable `e3f3b81`.

Not checked: live/plugin-hosted installation, deployment, real inventory, real devices/Safari/Firefox, alternate-method uncertainty calibration, operational monthly replanning, actual demand uncensoring, industry suitability, and the reserved July–September 2026 holdout. Cold-catalog Auto performance parity is a **known unmet qualifier**, not an untested claim.
