Lifecycle: review

# v1.1 integration verification

Scope: local synthetic integration on `product-page`; no network, installs, ERP access, push, or deployment. Both `6e3192a` (Simple decisions/explanation) and `7abe1e5` (input meaning) are ancestors. The pure-block conflict was resolved with a documented combined hash, not by changing calculation policy.

## Results

| Gate | Result |
| --- | --- |
| `node --test tests/*.mjs` | 3,486 passed; 0 failed/cancelled/skipped |
| `/usr/bin/python3 -m pytest -q` | 2,047 passed |
| `/usr/bin/python3 -m unittest discover -s tests` | 202 passed |
| `scripts/golden_diff.py` | exit 0; all SKUs/all fields unchanged; script unchanged |
| `scripts/verify_import_examples.py` | exit 0; 8 files / 8 item records match frozen `af2b1c7` |
| `scripts/check_docs.py` | exit 0; 116 relative links / 62 JSON files checked |
| Builds | 8 design templates + default + demo-1000 rebuilt; default byte-identical to option-gm-b |
| Capture inventory | 35/35 scripts passed: 29 standalone (including capture.cjs), 6 docs; each invocation capped at 300 seconds |
| Safari regressions | 48/48 checks: 24 Chromium + 24 WebKit, each at 1440×900 and 390×844 touch/mobile emulation |
| Current docs stress | 35 configurations; 0 failures; real disclosure and document/native scrolling tested |
| Visual inspection | All 10 v11 Chromium/WebKit screenshots inspected via contact sheets; both refreshed README screenshots inspected |

Ignored machine receipts: `.scratch/pp/gates-verified.json`, `.scratch/pp/captures/verified-final.json`, `.scratch/pp/v11-safari-regressions.json`, and `.scratch/pp/perf-final-summary.json`. The capture inventory merges the original complete 35-script run with successful targeted reruns after fixes; it asserts exact path coverage and retains log/source hashes. Docs capture commands use required `--label after` for polish and `--label final --current` for stress. Historical stress mode remains frozen; current mode reuses the exact-byte import-policy/display guard.

## Safari changes

- Sticky group positions account for the 44px column header and retain variable-height group handoff; Copy order hit-tests pass at 900px scroll.
- Product navigation snapshots IDs, reads fresh evaluated rows, and retains the ordered item until closing the report. Counter, previous and next remain valid after marking.
- Device-local intent says `Ordered on this device · expected ~… (lead-time estimate)`. No invented confirmed arrival. Confirmed file PO dates retain their provenance, including a real PO sharing the local estimated date. Positive additional orders retain their own Order by deadline.
- Set in Settings keeps a 44px target. Short-height reflow reduces surrounding whitespace, not the target; the 720×450 worklist usability regression passes.
- MIT remains in every HTML. Font attribution/full OFL is present iff embedded CSS contains `@font-face`; only option-gm-c embeds Poppins/Tajawal. Regression builds all ten outputs.
- Browser regression checks actual XLSX download events as well as workbook bytes, ordered-state copy, navigation, dark rendering and runtime errors. No external network attempts.

## CLI byte cap and the apparent 200 → 193 count drop

The chunked reader is intentional and predates this integration: `sources._read_csv_bytes` reads chunks of at most 65,536 bytes and stops at budget + 1. `sources.py`, `csv_import.py`, and `tests/test_hostile_imports.py` are byte-unchanged from `9907056`. The existing growing-file test already covers cap−1, cap, and cap+1 and forbids unbounded reads.

New real subprocess tests feed 2 MiB+1 to a real file (normal and strict CLI) and to stdin. Oversized files return exit 2 with exactly `stock_runway.py: error: CSV must be a local file no larger than 2 MiB.` Stdin `-` is not a supported CLI source; small and oversized pipes both retain exit 2 and exactly `stock_runway.py: error: Could not read the local CSV file.` No stdin feature or bypass was added.

No tests disappeared. Collected unittest IDs compare 196 at `9907056` with 202 now, with zero removed IDs. The stale 193 count and single-read mock match pre-`ad4bf14` source (`74572d6`): the seven differences from the interim 200 are three BaselineTests, three WhyAmountTests, and the font iff regression. The new two subprocess tests take 200 to 202. Full test-definition comparison also finds no removed tests. Detailed receipts: `.scratch/pp/unittest-id-proof.json`, `.scratch/pp/stale-193-proof.json`, `.scratch/pp/test-collection-proof.json`.

## Performance

Final-source Current mode, two runs per size, real Element Timing product-name paint and worklist-only boot. Historical reference values were supplied, not rerun.

| Catalog | Median useful paint | Median full analysis | Median boot max long task | Change vs supplied paint / full baseline |
| --- | --- | --- | --- | --- |
| 5,000 | 182 ms | 3,003.5 ms | 166.5 ms | +3.4% / −4.3% |
| 20,000 | 254 ms | 12,991.55 ms | 584 ms | −13.0% / +3.5% |

All four final runs completed without browser errors or network attempts. No measured paint/full-analysis regression exceeds 20%; no speculative maths or performance rewrite was made. Progressive-safety passed in 213.58 seconds; this is still slower than the older approximately 140-second whole-capture reference. Its aggregate wall-time cause was not isolated, and these measurements do not claim that the whole capture returned to 140 seconds.

Not checked: real Safari/iPhone hardware, installed Desktop/hosted deployment, live inventory, historical-build benchmark reruns, or the cause of the whole-capture wall-time gap. Forecast calibration was not changed or revalidated.
