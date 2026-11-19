# Offline stress-scale results

## Verdict

**Cold startup fails the 2-second budget at every scale.** The cheap safe fix
removes eager optional stock-out detection/incoming resolution from unrelated
row values and sorts. At 50k, cold quantity-sort blocking work fell from 2,001.3
to 113.6 ms. No engine math, policies, goldens or tracked generated HTML were
changed by this scale workstream.

All 5k/20k/50k catalogs completed real Chrome interaction probes with zero page
errors and zero HTTP(S) attempts. The Python CLI exported all 5k products, but
correctly rejected the 20k/50k CSVs at its existing **2 MiB guard**. Rejection
latency is not a forecast-compute benchmark. That safety policy was not changed
or silently bypassed/sharded.

## Reproduce (offline; no installs)

From the repo root, with the already-installed dependencies:

```sh
export TMPDIR="$PWD/.scratch"
export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js
export CHROMIUM_EXECUTABLE=/path/to/chrome
mkdir -p .scratch/stress
for count in 5000 20000 50000; do
  /usr/bin/python3 scripts/stress_scale.py --count "$count" --seed 73021
  node scripts/stress_scale.mjs ".scratch/stress/$count/catalog.html"
done
/usr/bin/python3 -m unittest discover -s tests -p 'test_stress_scale.py' -v
node --test tests/scale-rendering.test.mjs tests/weekly-summary.test.mjs \
  tests/local-orders.test.mjs tests/risk-adapter.test.mjs tests/supplier-minimums.test.mjs
```

Artifacts live only in `.scratch/stress/<count>/`: `data.json`, `stock.csv`,
`catalog.html`, `python.json`, `cli.log`, `orders.csv` (successful CLI only),
`browser-before.json` and `browser.json`. `--before` selects the former browser
report. `--skip-cli` preserves prior CLI timing only when the dataset hash
matches; `--skip-risk-all` omits the full optional-column sweep. Recorded full
risk sweeps below are **pre-fix**; post-fix interactive reruns used that flag.

The trusted generator calls `build()` directly; the public builder's 16 MiB
input guard stays unchanged (50k JSON exceeds it). This proves boot/render,
**not oversized-file admission through import review**.

## Measurement contract

- Chrome 159.0.8154.6 headless, 1440×900; Python 3.9.6 system stdlib.
- Seed 73021, 48 monthly observations ending 2025-12; decision day frozen at
  2026-01-01. All products/suppliers/costs are fictional. Fixtures include 80%
  positive varied sales, 10% all-zero, 10% intermittent histories, 8 categories,
  15 named suppliers plus unassigned, and costs missing every seventh product.
- Fresh contexts; all HTTP(S) blocked. The actual source-built Arctic page has
  a scratch-only bridge invoking real handlers in-page. These timings do not
  include mouse/input-event dispatch or replace accessibility interaction QA.
- Wall time includes two animation frames; `sync` isolates handler blocking
  work. Cold load includes navigation, ready and two frames. Small wall-time
  differences are heavily influenced by headless frame scheduling.
- One pre/post run per size, shared host with other workstreams active; no
  exclusive-host, percentile or statistical performance claim. Boot phase
  timers were added only to post-fix scratch builds, not product source.
- JS heap is CDP used heap after forced GC, not peak/RSS/total browser memory.
  Excel measures real workbook serialization and byte length, suppressing only
  the final download side effect. No installation, network or live data access.

## Post-fix interactions (milliseconds)

**Bold** exceeds 2,000 ms. Every named operation ran at every catalog size.

| Operation | 5k wall | 5k sync | 20k wall | 20k sync | 50k wall | 50k sync |
|---|---:|---:|---:|---:|---:|---:|
| Load / first render | **9,038.6** | — | **33,061.4** | — | **83,258.7** | — |
| Order tab | 195.6 | 3.5 | 11.2 | 8.8 | 22.0 | 20.4 |
| All tab | 150.3 | 8.3 | 170.9 | 28.3 | 180.3 | 62.4 |
| Search | 97.1 | 4.0 | 90.7 | 6.1 | 78.1 | 18.9 |
| Clear search | 110.6 | 6.0 | 175.0 | 30.5 | 75.4 | 68.8 |
| Group supplier | 94.5 | 16.9 | 58.6 | 53.8 | 135.2 | 132.7 |
| Group status | 185.5 | 6.6 | 226.3 | 18.7 | 59.9 | 57.3 |
| Sort quantity | 137.9 | 17.4 | 144.7 | 57.6 | 115.3 | 113.6 |
| Sort product | 26.6 | 20.0 | 88.8 | 48.1 | 98.2 | 96.3 |
| Sort urgency | 147.5 | 8.0 | 144.8 | 21.3 | 153.1 | 53.3 |
| Product open (includes cold risk) | 30.2 | 23.9 | 172.5 | 20.4 | 74.7 | 18.5 |
| Product close | 195.1 | 0.1 | 202.8 | 0.0 | 215.4 | 0.1 |
| Cold product risk | 144.1 | 1.6 | 173.5 | 1.6 | 121.8 | 1.2 |
| Weekly summary open | 165.3 | 25.2 | 214.4 | 62.7 | 190.2 | 116.4 |
| Weekly summary close | 49.8 | 1.0 | 122.7 | 1.2 | 62.6 | 1.1 |
| Excel serialization | 174.3 | 95.5 | 399.5 | 395.9 | 957.9 | 878.5 |

## Safe lazy-value fix

`wlValue` built every column value before selecting a key, so quantity sorting
triggered stock-out detection across the entire catalog. Optional detection and
local incoming now run only for their own keys; values/cache rules stay intact.
The focused regression failed before the fix (16 unintended detector calls),
then passed after it, checking all ordinary keys and both optional paths.

| Products | Quantity-sort sync before ms | Sync after ms | Wall before ms | Wall after ms |
|---|---:|---:|---:|---:|
| 5,000 | 212.1 | 17.4 | 214.4 | 137.9 |
| 20,000 | 796.1 | 57.6 | 889.1 | 144.7 |
| 50,000 | **2,001.3** | 113.6 | **2,003.2** | 115.3 |

## Startup: remaining freezes and phase attribution

Phases wrap actual functions in scratch builds, without changing their inputs.
They are not exhaustive: other initialization/wrappers/layout consume the rest.

| Products | First render ms | Core row evaluation ms | Health cumulative ms | Legacy list ms | Longest task ms | Mounted product rows |
|---|---:|---:|---:|---:|---:|---:|
| 5,000 | **9,038.6** | **6,387.8** | 1,357.4 | 187.4 | **8,821.0** | 13 |
| 20,000 | **33,061.4** | **23,299.6** | **5,208.5** | 804.9 | **32,755.0** | 13 |
| 50,000 | **83,258.7** | **58,798.6** | **13,228.9** | **2,034.2** | **82,980.0** | 13 |

Final worklist virtualization already keeps mounted products to 13. Core
synchronous evaluation and health dominate startup, with the earlier legacy
list also costly. A scheduling/worker/cache packet needs explicit snapshot
invalidation and calculation parity; this packet makes no broad shared-app
boot rewrite or engine change. **Startup remains a real user-visible freeze.**

## Full optional risk column (pre-fix sweeps)

All products processed; none withheld, zero simulation errors. Wall includes
intentional idle scheduling; active measures batch work. The 50 ms heartbeat
continued throughout: multi-minute completion is not a multi-minute UI freeze,
but still exceeds the 2-second completion budget. No second full sweep is claimed.

| Products | Wall ms | Active ms | Processed | Heartbeat max gap ms | Ticks | Max individual simulation ms |
|---|---:|---:|---:|---:|---:|---:|
| 5,000 | **33,938.1** | **2,680.2** | 5,000 | 163.7 | 499 | 2.6 |
| 20,000 | **138,695.1** | **11,593.4** | 20,000 | 186.1 | 2,181 | 3.1 |
| 50,000 | **302,384.6** | **25,983.5** | 50,000 | 165.3 | 4,770 | 4.7 |

## Excel, summary DOM and heap

Pre/post workbook byte lengths and sampled deterministic risk outputs were
asserted equal at each size. This is not workbook-content hash or whole-catalog
numerical parity. Summary screen CSS hides excess rows but still mounts its
complete tables: a future lazy-DOM opportunity for worse catalogs.

| Products | Excel bytes | Excel sync ms | Summary DOM rows | Loaded heap MiB after | After actions MiB | After full risk MiB before |
|---|---:|---:|---:|---:|---:|---:|
| 5,000 | 2,996,908 | 95.5 | 295 | 53.63 | 54.47 | 58.22 |
| 20,000 | 12,193,817 | 395.9 | 1,129 | 202.82 | 204.33 | 218.59 |
| 50,000 | 30,687,436 | 878.5 | 2,716 | 499.42 | 502.24 | 538.03 |

## Actual Python CLI invocations

| Products | Input CSV bytes | Elapsed ms | Exit | Export rows | Export bytes | Result |
|---|---:|---:|---:|---:|---:|---|
| 5,000 | 1,201,842 | **18,524.2** | 0 | 5,000 | 448,307 | Export complete |
| 20,000 | 4,838,477 | 56.1 | 2 | 0 | — | Rejected: existing 2 MiB guard |
| 50,000 | 12,123,699 | 52.1 | 2 | 0 | — | Rejected: existing 2 MiB guard |

No supported single-file CLI compute result exists here for 20k/50k. Changing
that safety cap or supporting a streaming/bundle route requires another packet.

## Reproducible input hashes

Aggregate assertions checked all three browser catalog counts, full risk
processed counts, zero errors, equal workbook byte lengths and sampled risk
outputs, producing `.scratch/stress/aggregate.json`. JSON SHA-256:

- 5,000: `0e6e1b9d04d91463f74a19a69ffff675a01494d3f08c9fc73c77344ec63f9cbe`
- 20,000: `cea725aacabeff95bbbf4e1b56a4791af4377eac47805ca66d92da9a2ad0c2e7`
- 50,000: `797c907af206c22c9953885e93bf350859c87dd80b35208c2d59d353da264aca`

## Regression evidence and known failures

- Generator tests: **3/3 pass**, including all requested sizes, unique SKU/count,
  calendar/metadata, same/different seeds and scratch-only output guard.
- Focused Node row/digest/local-order/risk/supplier tests: **31/31 pass**.
- Shared-tree full Node suite: **3,425 pass / 7 fail**, 3,432 tests. Six
  generated-core equality guards fail with other workstream import-source
  changes and intentionally unrebuilt tracked HTML. Do not call it green.
- Fresh `057add0` archive in scratch: **3,430 pass / 1 fail**, 3,431 tests.
  Known failure: `polish snapshot guard rejects any changed pure block or
  backend/sample bytes` in `desktop.test.mjs`.
- Fresh baseline with **only scale-owned files** overlaid: **3,431 pass / 1
  fail**, 3,432 tests, same pre-existing snapshot guard. No added scale regression.
  Logs: `.scratch/stress/node-tests.log`, `node-baseline.log`,
  `node-own-only.log`. An intermediate `bf1cfa1` archive included an unrelated
  import commit, so its seven failures are not the own-only comparison.
- Full pre-fix 5k/20k/50k Chrome runs and post-fix interactive runs: exit 0,
  real counts, zero page errors; after-fix mounted worklist rows asserted <100.
  A final 50-product harness probe also passed with boot-phase instrumentation.

**Not checked:** live/ERP data, admission of oversized imports, phone layouts,
input-device dispatch latency, peak/RSS memory, repeated-trial percentiles,
whole-workbook hash/whole-catalog numerical parity, a second full risk sweep
after the lazy-value fix, and single-file CLI computation beyond 2 MiB.
