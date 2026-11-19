# Round 2 — performance receipt

**No repeatable Auto cold-load speedup was achieved.** Safe pass-scoped history/model memoization is retained; fit keys include as-of, method and exact cleaned observations (identical histories may share a pure fit). Classification phase means avoid twelve filter passes while preserving addition order. The 17 dying-demand supported-calendar holds disappear in all three final Auto contexts, but that correctness fix does not establish a speedup.

The identical 5,000-SKU/ten-class fixture was measured in three fresh contexts per method before and after, alternating method order. Trusted synthetic SAMPLE injection, not importer throughput. Both captures report PASS, no page errors or network requests. The pinned `2026-11-01T12:00:00Z` is the **synthetic decision date**, not execution time. Browser acceptance jobs also ran on the host, so frame timings are noisy. No threshold was relaxed.

| Median ms (3 contexts/method) | Current before | Auto before | Current after | Auto after |
|---|---:|---:|---:|---:|
| Cold first catalog render | 4245.80 | 4880.00 | 4181.40 | 4918.50 |
| Page startup | 10592.90 | 12123.00 | 10747.00 | 12128.60 |
| Method-change handler | 4476.50 | 5390.80 | 4632.30 | 5576.00 |
| Cached table handler | 7.70 | 8.50 | 7.50 | 6.70 |
| Product-open handler | 10.95 | 10.35 | 11.00 | 9.55 |
| Product through two frames | 136.25 | 131.05 | 134.70 | 90.75 |

Auto cold median 4880.0 → 4918.5 ms (+0.79%, overlapping ranges); final Auto remains 17.63% slower than Current. Thus the original cold-performance qualifier remains **unmet**, not “fixed” or “not checked.” Product-open/cached-redraw responsiveness does not establish startup parity. No expensive/unsafe optimization or importer-cap increase was added to manufacture a gain.

Raw full ranges, exact fixture/source SHA-256 and all per-context hold counts: `.scratch/round2/perf-before/report.json`, `.scratch/round2/perf-after/report.json`. The final rebuilt default file must match the after report source hash; this is checked in the final gate receipt.

---

# Archived Round 1 — forecast method performance and CLI receipt

Lifecycle: living. Local offline synthetic evidence only; no importer, hosted, or customer-data performance claim.

## Measurement contract

`standalone/capture-methods-scale.cjs` uses the seeded synthetic generator (500 items each: smooth, erratic, intermittent, lumpy, seasonal, new, dying, trend, structural break, censored). Catalogs contain 5,000 independent histories, 60 months ending October 2026; new histories have 48 dormant zero months followed by 12 observed ramp months. Planning date is fixed at November 1, 2026. Identical fixture hash for Current and Auto. Fixture is injected as trusted scratch SAMPLE, **not imported**. No pre-evaluated rows. Forecast engine and UI are unmodified.

Fresh offline browser contexts alternate method order. Five rounds per method by default. Capture first real render, page startup, real selector change handler, warm table re-render, and real product button handler plus two-animation-frame presentation latency. Open ten previously unopened products (one per class) before setting changes. Verify all 5,000 forecast `requested` metadata entries are Auto in Auto runs; record held products rather than discard them, and store chosen-method distribution and example curves. Verify the product URL matches the exact clicked SKU. Report per-run medians/ranges and per-class timing; no arbitrary pass threshold hiding an Auto regression. PASS means capture/assertions completed, not performance acceptance.

CLI tests spawn the actual `stock_runway.py` with synthetic CSV and fixed date. Cover every method, `--all`/default filter, settings JSON roundtrip, all preset suggestions, flags > preset > saved method priority, output file readback, invalid choices/settings with preserved output, deterministic Current CLI and SES library defaults. No subprocess or engine mocks.

## Reproduction

```sh
export TMPDIR="$PWD/.scratch"
export CHROMIUM_EXECUTABLE=/path/to/chrome
node standalone/capture-methods-scale.cjs > .scratch/methods-scale.log 2>&1
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q tests/test_methods_cli.py
```

## Measured results

Source: `standalone/stock-runway.html` at base `d71b974`, SHA-256 `433bb34b90f5dbde2bae159177b2d0d6722aef3ee176bf0f5626ef464041a902`.
Fixture SHA-256: `ca555b64e532b607a2c1b23cba46477ba3a33e43c3e4f7a142e6a82063423d63`.

Five fresh contexts per method, alternating order; milliseconds, median [min–max]. Product metrics are medians of the ten class-opening measurements within each run, then median/range across runs (not 50 independent contexts). Presentation means two requestAnimationFrame callbacks, not display-device input-to-photon measurement. Startup is navigation timeOrigin through page-ready evaluation and includes multiple application initialization renders.

| Metric | Current | Auto |
|---|---:|---:|
| First real catalog render | 4444.20 [4364.30–4591.90] | 5773.40 [5571.40–6102.60] |
| Page startup | 11015.90 [10942.10–11405.40] | 13797.90 [13495.50–14177.30] |
| Method selector handler / catalog recompute | 4872.30 [4737.00–5018.30] | 6207.40 [6110.20–6468.50] |
| Selector through two frames | 4873.70 [4738.50–5020.40] | 6208.90 [6116.50–6469.90] |
| Cached table re-render handler | 7.30 [7.10–9.10] | 7.00 [6.80–11.20] |
| Cached table through two frames | 93.90 [71.30–132.50] | 95.30 [81.70–96.30] |
| Product button handler | 10.20 [9.40–13.40] | 8.25 [7.80–10.10] |
| Product through two frames | 81.85 [49.10–95.25] | 64.70 [34.35–80.20] |

**Whole-catalog Auto is materially slower:** first render +1329.20 ms / +29.9%; selector recompute +1335.10 ms / +27.4%. Both methods block the main thread for multiple seconds. No engine repair was authorized in this packet.

**Product open did not show a repeatable Auto penalty.** Auto's synchronous opening was faster in every class median (deltas −1.00 to −2.80 ms), not merely inside a relaxed threshold. Risk adaptation intentionally withholds alternative-method analytics, so this is the actual shipped UI workload, not a claim that both methods perform identical analytics.

### Repeat with exact clicked-SKU URL assertions

Other full suites/capture jobs were visible on the host. Waited ten seconds foreground before the initial measurement and repeated independently with three fresh contexts per method, alternating order, same source/fixture hashes. Did not stop unrelated processes. Both batches had zero page errors and zero network requests; the repeat verifies every opened product URL equals its intended SKU.

```sh
SCALE_OUT="$PWD/.scratch/methods-scale-repeat" SCALE_RUNS=3 \
  node standalone/capture-methods-scale.cjs > .scratch/methods-scale-repeat.log 2>&1
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q \
  tests/test_methods_cli.py tests/test_forecast_methods.py > .scratch/methods-cli-final.log 2>&1
```

| Repeat metric, ms | Current median [range] | Auto median [range] |
|---|---:|---:|
| First real catalog render | 4485.00 [4469.20–4519.20] | 5842.60 [5780.00–5873.80] |
| Page startup | 11181.20 [11156.40–11489.50] | 14155.20 [13809.90–14311.40] |
| Selector handler / catalog recompute | 4975.60 [4754.30–5002.70] | 6659.20 [6278.40–6982.80] |
| Selector through two frames | 4977.10 [4755.80–5004.50] | 6660.60 [6279.90–6984.20] |
| Cached table handler | 11.20 [7.20–11.30] | 7.70 [6.90–11.50] |
| Cached table through two frames | 105.80 [80.40–112.10] | 58.10 [28.40–111.90] |
| Product button handler | 9.20 [8.85–9.55] | 8.50 [7.95–9.80] |
| Product through two frames | 78.95 [76.90–85.20] | 85.05 [79.30–96.00] |

Repeat Auto synchronous product medians remained faster for every class (−0.10 to −3.10 ms). Two-frame product median moved +6.10 ms with overlapping ranges, whereas the first batch moved −17.15 ms. Treat frame timing as noisy, not proof of an Auto slowdown or a speedup. The repeat confirms the catalog penalty (+30.3% cold / +33.8% selector). No universal threshold was imposed or relaxed.

## Active method and holds

Every Auto context and post-selector state reports `requested: {auto: 5000}`. Actual selected methods: SES 2494, additive seasonal smoothing 419, TSB 396, SBA 891, ADIDA 322, combination 478. Current contexts report `{current: 5000}`. All counts are derived and asserted from actual evaluated rows; generator process labels are not fed to fitting.

An initial capture failed on an overstrict zero-holds assertion: Auto has **17 dying-history needs-data rows** with reason `The estimated run-out date exceeds the supported calendar.` Current has zero. The assertion was replaced with recording exact hold count/reasons, not by excluding or changing those histories. They remain in every 5,000-row measurement and retain Auto metadata. Initial failed evidence: `.scratch/methods-scale-initial-failure.log` and `.scratch/methods-scale-initial-failure.json`. This is a visible semantic difference, not a performance pass or forecast-accuracy assessment.

## Test / execution receipt

- `node --check standalone/capture-methods-scale.cjs`: exit 0.
- Five-round browser batch: exit 0, 10 contexts, 100 product opens, report `PASS`.
- Three-round repeat: exit 0, six contexts, 60 exact-SKU product opens, report `PASS`.
- `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q tests/test_methods_cli.py`: exit 0, **31 passed in 4.44s**, `.scratch/methods-cli.log`.
- Final CLI + existing method library suite: exit 0, **55 passed in 4.86s**, `.scratch/methods-cli-final.log`.
- `git diff --check`: exit 0.

Raw complete timings, per-class ranges, settings activation evidence, hashes, and hold examples: `.scratch/methods-scale/report.json` and `.scratch/methods-scale-repeat/report.json`; stdout logs `.scratch/methods-scale.log` and `.scratch/methods-scale-repeat.log`. Trusted generated fixture and instrumented scratch HTML are beside each report. No engine, plugin, generated shipped page, or existing capture file changed. Initial system Python pytest plugin autoload hit incompatible external anyio; disabling unrelated plugins resolved it.

Confidence: high for measured local workload and CLI behavior; moderate for general performance conclusions due to host contention and headless frame scheduling. Not checked: real importer throughput, live Desktop/plugin, hosted runtime, other devices/browsers, full repository suites (parent-owned), forecast accuracy, or engine optimization.

## Final integrated-code rerun (supersedes initial timings)

| Measurement (median ms, 5 fresh contexts/method) | Current | Auto |
|---|---:|---:|
| Cold 5k catalog evaluation | 4459.40 | 5311.30 |
| Method-change handler | 4809.10 | 5755.70 |
| Cached table redraw | 7.60 | 7.90 |
| Product-open handler | 11.15 | 8.90 |
| Product open through two frames | 71.30 | 68.30 |

Auto cold catalog remains 19.1% slower. No product-open regression was observed. Full acceptance distinction, ranges and known supported-calendar holds are in [final verification](forecast-method-verification.md). Final raw report `.scratch/methods-scale/report.json`; 10 fresh contexts, 100 product opens; zero page errors/network requests.
