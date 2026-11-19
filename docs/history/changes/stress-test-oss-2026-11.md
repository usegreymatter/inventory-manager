# OSS scale and exact worklist parity — November 2026

Local offline measurement of product revision `9c79cc66aa22d0e885b52fddb5d9f293e0465033` versus baseline `51ceaa6c1df8b08ae0d05c6dd0f152fd2ce6cd80`. Only the two stress harnesses and this report changed in this task; no product source, forecasting math, or golden fixture was modified.

## Timing scope and limits

Single serial run per size/method; headless Chrome 159.0.8154.6, 1440 × 900, fixed browser date 2026-01-01T12:00:00Z. Seed 73021, 48 monthly values, fictional data only. HTTP(S) requests were blocked; all eight runs recorded zero requests and zero page errors. These are local measurements, not cross-device latency guarantees or statistical percentiles.

**The original table did not directly measure first useful paint.** Its first-useful column remains an honest render/rAF proxy, not a pixel-paint timestamp. The later real-paint addendum below closes that measurement gap without relabeling these historical values. For >1k, `analysisFirstUsefulMs` starts at the progressive analysis job (after preparation) and ends at the first useful row-render rAF callback. `analysisFullMs` uses the same start and ends at complete analysis. For 1k, scratch instrumentation starts immediately before startup initializers and includes every synchronous startup render; useful render ends at its rAF callback, full analysis at the final synchronous render return. The 1k and progressive scopes therefore differ and must not be treated as directly equivalent.

FCP is the browser Paint Timing API value measured from navigation; it may show only the shell and **is not useful worklist paint**. Navigation-to-ready includes full analysis and two rAF callbacks. Maximum long task covers navigation and the entire measured interaction suite, excluding worklist JSON capture (performed in separate parity runs). The all-catalog optional risk column was deliberately skipped; cold-risk entrypoint return values were null, so these runs do not establish risk computation throughput.

## Final scale table

All timings in milliseconds, rounded to one decimal. First useful = render proxy, not proven paint.

| Products | Method | First useful render proxy | Full analysis | FCP (shell) | Navigation → full ready | Max long task |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Current | 1078.2 | 951.6 | 32.0 | 1374.3 | 1078.0 |
| 1,000 | Auto | 1340.9 | 1217.8 | 136.0 | 1705.5 | 1341.0 |
| 5,000 | Current | 129.2 | 3288.9 | 192.0 | 3583.6 | 155.0 |
| 5,000 | Auto | 129.5 | 2881.1 | 188.0 | 3210.3 | 149.0 |
| 20,000 | Current | 128.9 | 12217.0 | 128.0 | 12609.6 | 622.0 |
| 20,000 | Auto | 129.1 | 11422.8 | 124.0 | 11856.6 | 650.0 |
| 50,000 | Current | 130.4 | 31557.7 | 32.0 | 32167.2 | 1769.0 |
| 50,000 | Auto | 131.9 | 28841.6 | 124.0 | 29368.6 | 1982.0 |

Each run completed status-tab changes, search/clear, supplier/status grouping, three sorts, product open/close, weekly summary/close, and in-memory Excel export with the download suppressed. Exactly 13 worklist rows were mounted in every final run. This does not prove every interaction is fast: long tasks remain, and optional all-catalog risk is excluded.

## Exact computed worklist parity

The baseline was extracted with `git archive 51ceaa6` into scratch, not a new worktree. Both builders received identical JSON input bytes and the same fixed clock, fresh browser context, and explicit Current/Auto setting. `JSON.stringify(currentRows)` was saved without field removal, key sorting, numeric tolerances, whitespace normalization, or newline addition. Fresh binary equality, row counts, and SHA-256 checks passed **4/4**.

| Dataset | Method | Rows | Bytes each | Before = after SHA-256 |
| --- | --- | ---: | ---: | --- |
| demo-1000 | Current | 1,000 | 2,993,008 | `547c4a0aa6750caa649db3aef9e680ae82de0a0f334fdf2bb0ecef21659c7f3f` |
| demo-1000 | Auto | 1,000 | 4,909,003 | `b19f9ceee51b184842a81bb83c6baf45fdc1009006b5987000c2515370d8572e` |
| synthetic-5000 | Current | 5,000 | 17,117,630 | `1198ca4e3557b81973ee65aced907db1f2337eecb91b2f018726041d7edc37f6` |
| synthetic-5000 | Auto | 5,000 | 25,472,705 | `bc5e6f1787c05c3bc8280e259f1cc28eac2abda271fbd5cb02ad4318c2b1da3c` |

Input hashes:
- demo-1000: `ed4d2b2ab1f34c725bd2555306fed10cebb65e4a7483d2e5b54fa7c03fed74ed`
- synthetic-5000: `0e6e1b9d04d91463f74a19a69ffff675a01494d3f08c9fc73c77344ec63f9cbe`

Every exact file is retained under `.scratch/stress-final-20261118/parity/<dataset>/<method>/{before,after}/worklist.json`; adjacent `browser.json` binds the HTML hash, result, and row count, and `comparison.json` records the equality verdict. Baseline and after HTML are retained. Parity is computed-row parity, not proof of every UI action or persisted setting.

## Before / after findings and open issues

- Before: the old harness startup anchor failed against the final builder. After: it matches the final 1k synchronous / larger progressive startup split and fails loudly if that anchor changes again.
- Before: `--cli-max-bytes` was parsed but never passed to the CLI. After: the opt-in value is forwarded as `--max-bytes`; the 1k and 5k Current CLI fixtures completed with exactly the expected row count. The 20k and 50k CLI attempts correctly rejected input with exit 2: `CSV contains more than 10000 rows.` The byte cap does not bypass the independent row cap; that guard was not relaxed. The public 2 MiB default remains unchanged. Auto CLI was not exercised (the scale CLI command measures the default forecast, not browser Auto).
- Before: waiting exclusively for `analysisState=complete` hung for the 1k build, which does not load the progressive module. After: readiness accepts complete synchronous 1k rows; all eight runs completed.
- Before: timing only the last startup render undercounted the 1k initializer path. After: the two 1k rows were rerun with the full startup clock; earlier clock results remain as `browser-before-clock-fix.json`, not used in the table.
- Before: harness defaults embedded private machine paths. After: Playwright resolves from its module or the explicit `PLAYWRIGHT_MODULE`; Chrome uses its installed default or `CHROMIUM_EXECUTABLE`.
- Baseline versus final: byte-identical worklist JSON in all four comparisons. No change to computed rows was found.

Fresh parity-run navigation measurements (different fixture/scopes from the scale table; no first-useful inference):

| Dataset | Method | Before navigation → ready | After navigation → ready | Before boot max task | After boot max task |
| --- | --- | ---: | ---: | ---: | ---: |
| demo-1000 | Current | 1488.1 | 958.3 | 1028.0 | 735.0 |
| demo-1000 | Auto | 2401.0 | 1788.2 | 2153.0 | 1403.0 |
| synthetic-5000 | Current | 8462.8 | 3399.5 | 8256.0 | 207.0 |
| synthetic-5000 | Auto | 13434.9 | 3149.3 | 13036.0 | 229.0 |

Original-run limits: 1k still performs synchronous startup analysis. At 50k, full analysis remains tens of seconds and boot tasks approach two seconds; do not claim all scale interactions are fast. Those original runs did not check pixel-verified useful paint, all-catalog risk throughput, responsive/mobile behavior, repeat-run variance, hosted deployment, or live inventory. See the addendum for the subsequently measured useful product paint; the other limits remain.

## Reproduction and evidence

Run from this checkout with scratch temp and already installed tooling; no installs/network are needed:

```sh
export TMPDIR="$PWD/.scratch"
export PLAYWRIGHT_MODULE=/path/to/installed/playwright/index.js
export CHROMIUM_EXECUTABLE=/path/to/chrome
/usr/bin/python3 scripts/stress_scale.py --count 50000 --method auto --skip-cli --output "$PWD/.scratch/example-auto-50000"
node scripts/stress_scale.mjs "$PWD/.scratch/example-auto-50000/catalog.html" --skip-risk-all
# Opt-in CLI cap, leaving the default unchanged:
/usr/bin/python3 scripts/stress_scale.py --count 50000 --cli-max-bytes 67108864 --output "$PWD/.scratch/example-current-50000"
```

The preserved `.scratch/stress-final-20261118/run.py` reproduces archive-baseline and after builds and all four byte comparisons (baseline tar must already be extracted, as retained). `report.py` performs fresh identity, equality, row-count, completion, HTML-hash, and CLI checks and generates this report. `manifest.json` records the initial source snapshot and larger-run harness identity; the final 1k clock-only harness change is bound separately in `verified-summary.json`. Scale JSON is at `<method>/<count>/browser.json`; CLI evidence is adjacent `python.json`, `cli.log`, and `orders.csv`. Logs and the initial failed readiness run were preserved, not silently counted as passes.

Verified extracted archive files: 458; after-source JS/Python/CSS files: 51. Baseline tar SHA-256: `f2c84bfca5e9bfeb0c700c0257c648db47cc0e591a7af6e5a5914fccbc0ebbc6`. `scripts/golden_diff.py` remains byte-identical to product revision `9c79cc6`; the parent owns full Node/Python/golden regression runs and release merging.

## Real useful-product paint addendum — 2026-11-18

**Measured actual browser-reported product text paint in all 8/8 requested runs.** This is one fresh serial run per size/method, not a speed comparison or latency guarantee. Reused the eight existing `<method>/<count>/catalog.html` fixtures from `.scratch/stress-final-20261118/`; no builder, CLI, install, network access, or parity regeneration was run. Original HTML and `browser.json` hashes were checked unchanged after each run. Product source and forecasting maths were not edited.

### Measurement contract

`node scripts/stress_scale.mjs <scratch-catalog.html> --skip-risk-all --real-paint` creates an adjacent scratch-only `catalog-element-paint.html`. Its sole source transformation adds `elementtiming="stress-useful-product"` to worklist product-name spans during their existing constructor, before insertion/paint. An init-script `PerformanceObserver` observes `element` entries. The metric is the earliest **positive `renderTime` from navigation start** among these names with nonzero browser-reported intersection width/height, a product SKU, and nonempty text. It is not FCP, a DOM mutation time, observer-delivery time, rAF, or an estimated fallback. All eight first entries identify `Synthetic item 2`, `SCALE-0002`; raw entries retain their intersection rectangle, row text and observer-delivery timestamp. Element Timing worked on the first implementation; no measurement repair or CDP fallback was required. Missing/unsupported entries fail the run rather than receiving estimates.

Full analysis retains the **original labeled scope**: at 1k, startup initializers through final synchronous render return; above 1k, progressive analysis start after preparation through analysis completion. It is not navigation-to-full-analysis, and the two scopes are not directly equivalent. Maximum long task still covers navigation plus the entire existing interaction suite, with optional all-catalog risk excluded. The new screenshot/observer work is included in this instrumented run; do not compare its timings as an isolated product change. The existing automation navigation-to-ready clock additionally includes screenshot capture and is not used as the paint metric.

### Fresh real-paint table

All values in milliseconds; full analysis rounded to one decimal. One run per cell; no variance or percentile claim.

| Products | Method | Navigation → useful product paint (`renderTime`) | Full analysis (original scope) | Max long task (navigation + interaction suite) |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | Current | 1112 | 914.0 | 1039 |
| 1,000 | Auto | 1408 | 1229.0 | 1361 |
| 5,000 | Current | 176 | 3137.1 | 162 |
| 5,000 | Auto | 136 | 2813.8 | 165 |
| 20,000 | Current | 292 | 12550.6 | 623 |
| 20,000 | Auto | 340 | 11182.9 | 645 |
| 50,000 | Current | 468 | 32247.5 | 1757 |
| 50,000 | Auto | 472 | 28525.3 | **2243** |

All eight completed the existing interaction assertions with zero page errors and zero blocked HTTP(S) requests. The 50k Auto maximum long task exceeds two seconds; early useful text paint does **not** establish a responsive or complete analysis. Progressive worklist results are explicitly incomplete and may change until analysis finishes. The 1k path remains synchronous. No performance threshold or blanket speed claim is established.

### Visible-content evidence and machine conditions

Every run saved a viewport `useful-paint.png` after the first Element Timing observation, before the readiness wait and interaction suite. These are proof of visible content after observation, **not screenshots of the exact timestamped first frame**. The 50k Current screenshot was visually inspected: it shows `Synthetic item 2`, SKU `SCALE-0002`, on hand 162, monthly sales 252.2 ea, order quantity 554, order value 388 and order-by Today, while the banner says analysis is incomplete (708 / 50,000). This is useful worklist content rather than just the shell; it is not final-order validation.

Host: Apple M5 Max, 68,719,476,736 bytes RAM, Darwin 27.2.0; isolated headless Chrome 159.0.8154.6, viewport 1440 × 900, default browser frame scheduling, no CPU/network throttling configured. Fixed browser date remains 2026-01-01T12:00:00Z. The run sampled load averages, VM page counters, swap, and top-five CPU processes (PID, CPU percentage, executable basename only; no arguments/environment) every three seconds. Observed one-minute load range: 2.955078125–3.87548828125. Swap used was 1407.31 MiB at the first and last sample; preflight system memory-free percentage was 60%. GPU utilization/queue and renderer hardware identity were not measured. The measurements were serial, not parallel; other system activity was not eliminated.

### Evidence, checks and reproduction

- Raw results: `.scratch/stress-final-20261118/<method>/<count>/browser-real-paint.json` (original HTML hash, instrumented HTML hash, raw positive paint entries, full analysis, tasks, screenshot hash, and completion status).
- Matching instrumented HTML and screenshot: `catalog-element-paint.html`, `useful-paint.png` beside each raw result. The original files and historical table remain preserved.
- Runner/log: `.scratch/stress-final-20261118/paint-run.py`, `paint-run.log`; no fixture generation or CLI invocation is in this runner.
- Manifest, sampled load/system data, individual run logs and test logs: `.scratch/stress-final-20261118/paint-evidence/`.
- Manifest SHA-256: `6dd97db23bab087e098ce78d99c536160db7bd70454c77f99d045115300205fd`.
- Visually inspected 50k Current screenshot SHA-256: `2ab9c6b47ae47d1c6e3296f8da3e3aebf62b374ddd57e2d3018144e8c18a88fb`.
- Matching 50k Current raw result SHA-256: `0c7a8d1c8cac4879bd443c82eaf3c3cfd25916345490d8b7254c3a1b9890cafd`.
- Fresh checks after harness execution: `node --test tests/*.mjs`: **3470/3470 passed**; `/usr/bin/python3 -m unittest discover -p 'test_*.py'` from `tests` with repository `PYTHONPATH`: **196/196 passed**; `node --check scripts/stress_scale.mjs`: exit 0. Docs check: 106 relative links, 63 JSON files, zero problems (also rerun after this addendum).

To reproduce without changing old evidence, copy an existing scratch fixture into a new scratch directory, then run the command above with installed tooling supplied through `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` and `TMPDIR="$PWD/.scratch"`. The opt-in browser runner is portable; no private executable paths are embedded in tracked files.

Not checked by this addendum: repeat-run variance, baseline real-paint comparison, all-catalog risk throughput, responsive/mobile or other-browser behavior, GPU contention, hosted deployment, live inventory, and fresh golden/import/parity reruns. The four existing exact worklist comparisons above are retained evidence, not newly executed checks.
