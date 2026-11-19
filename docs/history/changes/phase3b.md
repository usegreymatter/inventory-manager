# Phase 3b — learns from misses

Local-only; no ERP, credentials, network, install, push or self-modifying code.
Learning is opt-in, no diary means unchanged calculation/output. Quantile coverage
is one-sided; unavailable tails are null. Scoring uses completed horizon-one actuals
once per SKU/month (first valid archive entry wins), not overlapping horizons.
MASE uses the naive scale recorded at the forecast origin; zero scales stay null.

## Step 1 — diary

Added versioned next-three-month forecasts and pure matured scoring in Python/JS,
explicit `--forecast-diary PATH` append-only/idempotent JSONL CLI archive. Desktop
storage and the opt-in control are completed with the report-card integration.
Targeted RED: 3 failures for missing functions/module. GREEN: pytest 3 passed,
Node 1 passed. All five standalone variants rebuilt.

Golden before/after (`/usr/bin/python3 scripts/golden_diff.py --write`):

| sku | field | before | after |
| --- | --- | --- | --- |
| (all SKUs) | (all fields) | unchanged | unchanged |

## Step 2 — capped bias correction

Opt-in `--learn` + diary; `--no-correction SKU` is the per-SKU undo.
Requires six matured months, four same-sign misses and CFE >=5% of forecasts.
Absolute (non-compounding) multiplier capped at ±15%; requests exceeding cap are
proposals only. Correction must pass the existing MASE/RMSSE/bias/PIS adoption
gate against the selected method, champion and flat baseline on matched folds.
RED: 2 missing-function failures. GREEN: pytest 5; Node 2 including twelve-run
Python/JS replay with a real applied correction. All five variants rebuilt.
Golden before/after `--write`: all SKUs/all four fields unchanged (no diary).

## Step 3 — pattern change

Centered scaled CUSUM on six consecutive matured months: three reference,
three monitored, threshold ±5; scale floor 10% of prediction or one unit.
Adds `pattern_changed` via Python/JS health and requests a fresh normal
selection (the existing selection runs each snapshot). No forced method or
quantity change; gate still required. Learning readiness is locked before six
matured months and on afterwards; absent diary does not add capabilities.
RED: one missing function failure. GREEN: pytest 6, Node 3 incl health/selection
parity and drift-only projection identity. Five variants rebuilt. Golden
before/after `--write`: all SKUs/all four fields unchanged (no diary).

## Step 4 — tap-only report card and opt-in storage

Accuracy (1-WAPE), exact monthly change in percentage points, matured-month
count, method counts, automatic-change state and per-SKU Undo live behind
Tools/Accuracy (A3) or All settings/Accuracy (Desktop). Archive and corrections
have independent off-by-default switches; device persistence is opt-in. No
extra resting-screen rows. CLI prints the same report with a diary flag.
RED: report missing (pytest 1) and Desktop panel missing (Node 1). GREEN:
pytest 7, Node 4; standalone 79/0. Extended capture-a3 with storage append,
tap-only report, undo/reload, phone-width and screenshot assertions; browser
execution reserved for the final verification. All five variants rebuilt.
Golden before/after `--write`: all SKUs/all four fields unchanged (no diary).

## Integrated Phase 3 + 3b review fixes

OWNER-APPROVED Phase 3 + 3b (maintainer 2026-11-13). Combined forecast review
fixes F1-F10 with the diary, gated correction, pattern alert, report card,
append-only learning log and exact-proposal Approve/Dismiss controls.

Selection/adopted-history memoization remains pass-scoped. Its key includes
serialized learning context contents (matured diary entries, enable/undo flags,
prior method and exact owner approvals), so nested edits invalidate both caches.
The Python stock-only inventory-position clone uses the same key helper.
Python/JS mutation probes reject the old identity-only cache and pass with the
content-aware key. Existing correction, replay, undo and decision tests pass.

Offline integration verification:
- `/usr/bin/python3 -m pytest -q`: 1544 passed.
- Full `node --test tests/*.test.mjs`, with both `PYTHON` and
  `FORECAST_LAB_PYTHON` set to `/usr/bin/python3`, then `/opt/homebrew/bin/python3`:
  2428 passed per interpreter, zero skipped/failing.
- Five standalone variants rebuilt; `capture-a3.cjs`: PASS, 160 checks.
- Exact golden objects unchanged across JS/Python/CLI: 11 legacy, 19 Phase 2,
  and 4 Phase 3 cases; no golden fixture writes.
- Existing `perf2.mjs 100`, shared-base `585b423` versus integration: baseline
  calculate 644 ms / guidance 6949 ms; integrated calculate 392 ms / guidance
  364 ms. Single local timing sample, not a production benchmark.
- Snapshot/mutation guards retained and re-pinned; `git diff --check` clean.

Not checked: live ERP, hosted/Desktop installation, network, Safari/Firefox,
physical touch devices, or independent human visual review. No push or install.

## Shared-evaluation merge verification

OWNER-APPROVED Phase 3 + 3b (maintainer 2026-11-13). Combined `p3fix-perf`
(`5476203`) with `p3fix-learn` (`d7138e6`), preserving both the content-keyed
shared evaluation and the learning-safety behavior below. Prepared learning rows
retain linear SKU grouping, durable decisions, persisted disabled SKUs and prior
absolute correction factors. A3 snapshot keys replay the log before comparison;
in-place log changes invalidate ready snapshots as well as selection memo keys.

- New Python/JS regressions cover disabled SKU, durable decision and prior-factor
  invalidation. Mutation of the old A3 key makes all three JS regressions fail;
  the merged key passes them.
- All five HTML variants rebuilt. Python: **1594 passed**. Full Node suite with
  `PYTHON` and `FORECAST_LAB_PYTHON` set together to `/usr/bin/python3`, then
  `/opt/homebrew/bin/python3`: **2448 passed** each, no skips/failures.
- `capture-a3.cjs`: **PASS, 161 checks**, no network requests or browser errors.
  Report-card screenshot vision review found readable statuses/buttons and no
  clipping/overlap; this is not independent human visual approval.
- Default and Phase 3 `scripts/golden_diff.py` comparisons: all fields unchanged,
  without `--write`. The guarded source manifest is re-pinned to the tested
  integration source; existing guard-only proof passes.
- Deterministic **1000-SKU × 48-month** bench: CLI no-diary **2682.77 ms**,
  CLI diary/learning **4103.73 ms**; JS evaluation/guidance **1761.97 ms**,
  JS diary/learning **2890.52 ms**. A3 load **988.51 ms**, render **938.60 ms**,
  switch **3.60 ms**. Exactly **1000** actual selections; repeat render, switch
  and drawer reuse the snapshot. Single offline local samples, not live claims.

Not checked: live ERP, hosted/native Desktop installation, Safari/Firefox,
physical touch hardware or independent human visual approval. No network,
install, push or remote changes were performed.

## Opus Phase 3b follow-up fixes

OWNER-APPROVED Phase 3 + 3b (maintainer 2026-11-13). Local-only follow-up;
no install, network, live ERP, push or remote changes.

- A3 loads each storage key independently. Any failed parse or wrong container
  pauses learning and makes settings/diary/log writes read-only for that session;
  the report card says **Learning paused**. The real-loader regression proves
  corrupt settings, diary and log each preserve the other keys byte-for-byte.
- Per-SKU undo replays the latest `correction_disabled`/`correction_enabled`
  events. CLI `--no-correction SKU` persists even without a prior applied factor;
  `--enable-correction SKU` explicitly reverses it. Same-snapshot repeated
  disable/enable/disable cycles remain distinct. Global off is not a per-SKU undo.
- Approve/Dismiss survives new snapshots and changed forecast quantities. A bias
  request changing **more than 5 percentage points** (or changing sign), or a new
  before/after method pair, requires a fresh decision. Initial proposal IDs are
  still snapshot-scoped; cap and adoption gate remain mandatory. An approved bias
  that fails its gate says **Approved, not tested**, never **Not better**.
- Report cards and change logs use Applied / Needs OK / Not better / Undone /
  Turned off. Method switches, withdrawals and disabled states do not show a
  meaningless correction percentage.
- Hysteresis keeps the previously adopted **absolute, non-compounding factor**;
  continuation never silently retunes it. New adoption still needs the original
  10%-improvement MASE gate and all existing RMSSE/bias/coverage checks. Existing
  factors withdraw only for a clear failure: MASE, RMSSE or absolute scaled CFE
  **more than 15% worse** than any matched comparator, unavailable metrics, or
  fewer than four coverage samples / coverage below 60%. The ±15% factor cap and
  immediate owner undo still hold. The 36 seeded Opus step scenarios (six shifts
  × six seeds, 18 monthly snapshots each) have zero one-month apply/withdraw churn;
  an explicit perfect-baseline control still rejects harmful continuation.
- JSONL recovers only an unterminated malformed final fragment, preserving it
  exactly in `<file>.quarantine` before truncating the fragment and warning.
  Mid-file damage, malformed newline-terminated rows and non-object rows still
  fail closed. Exclusive `fcntl` locks cover read/recovery/dedupe/append;
  writes flush and fsync. Eight simultaneous writers preserve 80 unique rows.
- The snapshot's stale opening scope is corrected (F9). Only touched engine/core
  hashes are re-pinned to the tested source revision; sample/source/tool hashes,
  approved settings blocks and historical backtest/mutation guards are retained.
  Five standalone variants rebuilt. No diary: golden output remains unchanged.
