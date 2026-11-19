# Out-of-stock months: advisory correction (round 4)

**Off by default pending Nov actuals.** Forecasts and the default order policy remain frozen; no July–September 2026 holdout tuning was performed. No sample or demo rows were changed.

## Method and limits

Inspect optional monthly `planning_facts.sales_history` and `stock_history` for lost-sales exposure (`in_stock_days` with `backorder=false`) or positive `stockout_days`. Label those flags as known stock-out; sparse month-end `on_hand` / `month_end_stock` supports, but cannot prove, a likely stock-out.

Without direct exposure evidence, flag an isolated month below 20% of the preceding non-flagged median (including zero), with both immediate raw neighbours at least 50% of that baseline. Require at least three positive preceding observations. Where monthly stock is known, all available observations must be at or near zero (<=1 unit). Current on-hand is never treated as past stock. Missing stock history leaves the result **likely**, not confirmed.

Replacement uses the median of the last up-to-six non-flagged raw observations, with at least three observations. No future month enters that median. A known flag without enough earlier observations gets no replacement. Consecutive low-sales months and an unconfirmed last month are deliberately not inferred; seasonality, promotions, discontinuation and data errors can still create false positives. Near-zero is a fixed illustrative unit threshold, not a calibrated parameter.

With `stockout_adjust=true` / CLI `--stockout-adjust`, the unchanged forecast and **same order-guidance function** run on an isolated copy containing adjusted history. Existing exposure rows for replaced months are normalized in that scenario only to avoid double uplift. Raw sales, goldens, projections, accuracy scores, defaults and source facts are unchanged. Held/locked rows stay held. The pre-existing exposure pipeline is preserved; this new heuristic is not silently adopted.

Product pages show both quantities, confidence and hatched months; Settings > Advanced contains the local default-OFF switch. The worklist has an optional **Stock-outs** count column, absent from Simple. When enabled, orders are labelled corrected; charts continue to show recorded sales and the unchanged source forecast.

These are **scenario diagnostics, not forecast accuracy or lost-demand validation**. The demo already contains deterministic isolated dips, so its generator and dataset were not regenerated. Its 220 flagged months are heuristic-only.

## Reproduction

`/usr/bin/python3 scripts/stockout_report.py` prints the complete before/after table below (fixed decision date 2026-11-17). Only flagged SKUs appear; sample has none. `None` means the existing planner withholds a quantity. Changed guidance includes dates and demand; quantity changes alone are fewer (69 demo SKUs in the browser check).

`node scripts/stockout_parity.cjs`: 1,380 cases, including 360 seeded random histories plus 15 edge cases with before/after guidance and all 1,005 committed dataset rows for detection; zero mismatches. See also `docs/history/changes/stockout-advisory.md` for the exact return contract.


## sample.json

Scanned 5 SKUs; flagged 0; known months 0; likely months 0; changed guidance 0.

| SKU | Flagged months | Order before | Order after | Delta |
| --- | --- | ---: | ---: | ---: |
| (none flagged) | — | unchanged | unchanged | 0 |

## demo-1000.json

Scanned 1000 SKUs; flagged 93; known months 0; likely months 220; changed guidance 78.

| SKU | Flagged months | Order before | Order after | Delta |
| --- | --- | ---: | ---: | ---: |
| TIL-STO-01-001 | 2026-01 (likely) | 353.0 | 386.0 | 33.0 |
| SEA-CLE-05-005 | 2025-06 (likely), 2025-08 (likely), 2025-12 (likely), 2026-05 (likely) | 1404.0 | 3816.0 | 2412.0 |
| TRM-SIL-05-005 | 2025-05 (likely) | 198.0 | 198.0 | 0.0 |
| TRM-BRU-04-009 | 2026-02 (likely), 2026-05 (likely) | 48.0 | 48.0 | 0.0 |
| GRT-BEI-02-012 | 2025-10 (likely), 2026-02 (likely), 2026-04 (likely) | 466.0 | 528.0 | 62.0 |
| TLS-STE-02-012 | 2025-05 (likely) | 181.0 | 181.0 | 0.0 |
| WPR-BLA-02-012 | 2025-03 (likely), 2025-10 (likely), 2025-12 (likely) | 1005.0 | 1015.0 | 10.0 |
| TIL-SLA-03-013 | 2025-09 (likely) | 995.0 | 995.0 | 0.0 |
| TRM-WHI-04-014 | 2025-04 (likely), 2025-12 (likely) | 123.0 | 135.0 | 12.0 |
| SEA-BLA-02-017 | 2025-05 (likely), 2025-07 (likely), 2025-10 (likely), 2026-09 (likely) | 36.0 | 36.0 | 0.0 |
| GRT-CHA-02-017 | 2025-10 (likely) | 232.0 | 232.0 | 0.0 |
| ADH-EXT-03-018 | 2025-09 (likely) | 1479.0 | 1479.0 | 0.0 |
| TRM-BLA-05-020 | 2025-07 (likely), 2026-04 (likely), 2026-06 (likely) | 24.0 | 54.0 | 30.0 |
| TRM-BRO-01-021 | 2025-03 (likely), 2025-09 (likely), 2026-01 (likely), 2026-09 (likely) | 414.0 | 456.0 | 42.0 |
| UND-HEA-05-025 | 2025-03 (likely), 2025-06 (likely), 2026-01 (likely) | 4907.0 | 6834.0 | 1927.0 |
| WPR-GRE-01-026 | 2025-03 (likely) | 0 | 0 | 0 |
| GRT-WHI-02-027 | 2025-03 (likely), 2025-05 (likely), 2026-02 (likely) | 320.0 | 370.0 | 50.0 |
| TIL-STO-03-028 | 2025-04 (likely), 2025-07 (likely), 2025-12 (likely), 2026-02 (likely) | 0 | 0 | 0 |
| TRM-SIL-04-029 | 2026-01 (likely) | 660.0 | 660.0 | 0.0 |
| UND-STA-04-029 | 2025-05 (likely), 2026-02 (likely), 2026-09 (likely) | 36.0 | 44.0 | 8.0 |
| ADH-WHI-05-030 | 2025-04 (likely), 2026-05 (likely), 2026-07 (likely) | 1008.0 | 1263.0 | 255.0 |
| UND-PRE-01-031 | 2025-03 (likely), 2025-11 (likely) | 2302.0 | 2583.0 | 281.0 |
| TLS-PRO-01-031 | 2025-12 (likely) | 7309.0 | 7661.0 | 352.0 |
| ADH-GRE-03-033 | 2026-04 (likely), 2026-08 (likely) | 578.0 | 1035.0 | 457.0 |
| TRM-WHI-02-037 | 2025-04 (likely) | 2454.0 | 2454.0 | 0.0 |
| UND-DEN-04-039 | 2026-01 (likely) | 41.0 | 46.0 | 5.0 |
| WPR-BLA-04-039 | 2025-09 (likely), 2025-11 (likely), 2026-07 (likely) | 270.0 | 360.0 | 90.0 |
| SEA-BLA-02-042 | 2025-07 (likely), 2025-10 (likely), 2026-04 (likely), 2026-06 (likely) | 516.0 | 1392.0 | 876.0 |
| TIL-IVO-02-042 | 2025-04 (likely), 2025-08 (likely), 2026-03 (likely), 2026-08 (likely) | 74.0 | 203.0 | 129.0 |
| ADH-EXT-05-045 | 2025-09 (likely), 2026-09 (likely) | 125.0 | 177.0 | 52.0 |
| GRT-IVO-01-046 | 2025-03 (likely), 2025-08 (likely) | 535.0 | 535.0 | 0.0 |
| GRT-IVO-02-047 | 2026-01 (likely), 2026-03 (likely), 2026-09 (likely) | 300.0 | 580.0 | 280.0 |
| UND-HEA-02-047 | 2025-09 (likely), 2026-01 (likely) | 2619.0 | 3027.0 | 408.0 |
| TLS-HEA-05-050 | 2025-08 (likely), 2025-11 (likely), 2026-08 (likely) | 113.0 | 115.0 | 2.0 |
| SEA-CLE-01-051 | 2025-08 (likely), 2025-12 (likely) | None | None | None |
| ADH-WHI-02-052 | 2025-04 (likely), 2025-11 (likely), 2026-02 (likely), 2026-04 (likely), 2026-07 (likely), 2026-09 (likely) | 349.0 | 1165.0 | 816.0 |
| TLS-STA-03-053 | 2025-03 (likely), 2025-05 (likely), 2026-03 (likely) | 0 | 0 | 0 |
| ADH-GRE-01-056 | 2025-07 (likely), 2026-03 (likely), 2026-05 (likely), 2026-07 (likely) | 126.0 | 133.0 | 7.0 |
| TIL-SAN-02-057 | 2025-06 (likely), 2025-08 (likely), 2026-05 (likely) | 68.0 | 68.0 | 0.0 |
| TLS-PRO-04-059 | 2025-04 (likely), 2026-09 (likely) | 71.0 | 63.0 | -8.0 |
| TRM-BRU-05-060 | 2026-01 (likely), 2026-04 (likely) | 132.0 | 135.0 | 3.0 |
| TRM-WHI-02-062 | 2025-07 (likely) | 126.0 | 126.0 | 0.0 |
| WPR-BLA-02-062 | 2025-04 (likely), 2025-12 (likely), 2026-09 (likely) | 150.0 | 270.0 | 120.0 |
| WPR-BLA-03-063 | 2026-03 (likely), 2026-06 (likely) | 150.0 | 200.0 | 50.0 |
| TIL-SLA-05-065 | 2025-03 (likely) | 175.0 | 175.0 | 0.0 |
| WPR-BLA-05-065 | 2025-04 (likely) | 400.0 | 400.0 | 0.0 |
| SEA-BLA-03-068 | 2025-09 (likely), 2026-05 (likely) | 120.0 | 108.0 | -12.0 |
| ADH-EXT-03-068 | 2025-12 (likely), 2026-02 (likely) | 1401.0 | 1486.0 | 85.0 |
| TRM-BLA-05-070 | 2025-03 (likely), 2026-02 (likely) | 24.0 | 30.0 | 6.0 |
| WPR-RAP-01-071 | 2025-07 (likely) | 8139.0 | 14367.0 | 6228.0 |
| TRM-BRO-02-072 | 2025-08 (likely), 2026-08 (likely) | 3525.0 | 4248.0 | 723.0 |
| SEA-BRO-05-075 | 2026-05 (likely), 2026-09 (likely) | 180.0 | 228.0 | 48.0 |
| WPR-RAP-05-075 | 2025-04 (likely), 2025-12 (likely) | 100.0 | 80.0 | -20.0 |
| TIL-STO-01-076 | 2025-02 (likely), 2026-05 (likely) | 47.0 | 44.0 | -3.0 |
| UND-STA-01-076 | 2025-07 (likely) | 0 | 0 | 0 |
| UND-STA-02-077 | 2025-11 (likely), 2026-02 (likely) | 213.0 | 239.0 | 26.0 |
| TLS-STA-02-077 | 2026-03 (likely), 2026-06 (likely) | 31.0 | 29.0 | -2.0 |
| SEA-CLE-03-078 | 2026-02 (likely), 2026-09 (likely) | 48.0 | 60.0 | 12.0 |
| UND-STA-03-078 | 2025-12 (likely), 2026-08 (likely) | 184.0 | 222.0 | 38.0 |
| ADH-WHI-04-079 | 2025-11 (likely), 2026-05 (likely) | 267.0 | 376.0 | 109.0 |
| ADH-WHI-05-080 | 2025-03 (likely), 2025-12 (likely) | 316.0 | 402.0 | 86.0 |
| TLS-PRO-02-082 | 2025-09 (likely), 2025-12 (likely), 2026-09 (likely) | 41.0 | 61.0 | 20.0 |
| SEA-WHI-03-083 | 2026-01 (likely) | 84.0 | 84.0 | 0.0 |
| SEA-GRE-01-086 | 2025-10 (likely), 2026-07 (likely) | 2460.0 | 2088.0 | -372.0 |
| SEA-GRE-02-087 | 2025-09 (likely), 2026-06 (likely) | 5328.0 | 4836.0 | -492.0 |
| TIL-SLA-02-087 | 2025-03 (likely), 2026-03 (likely) | 463.0 | 541.0 | 78.0 |
| UND-DEN-03-088 | 2025-04 (likely), 2026-09 (likely) | 5029.0 | 5183.0 | 154.0 |
| SEA-GRE-04-089 | 2025-12 (likely), 2026-02 (likely), 2026-06 (likely), 2026-09 (likely) | 876.0 | 1452.0 | 576.0 |
| TIL-SLA-04-089 | 2025-08 (likely), 2025-11 (likely), 2026-09 (likely) | 2388.0 | 5164.0 | 2776.0 |
| TLS-STE-04-089 | 2025-04 (likely), 2025-11 (likely), 2026-01 (likely) | 1626.0 | 1773.0 | 147.0 |
| SEA-BLA-02-092 | 2026-06 (likely), 2026-08 (likely) | 5652.0 | 6048.0 | 396.0 |
| ADH-EXT-03-093 | 2025-09 (likely), 2026-01 (likely), 2026-03 (likely) | 2364.0 | 2994.0 | 630.0 |
| TLS-LIG-03-093 | 2025-05 (likely), 2026-01 (likely), 2026-09 (likely) | 1864.0 | 3056.0 | 1192.0 |
| TLS-LIG-04-094 | 2025-11 (likely), 2026-08 (likely) | None | None | None |
| SEA-BLA-05-095 | 2026-01 (likely), 2026-03 (likely), 2026-06 (likely) | 1224.0 | 1200.0 | -24.0 |
| TIL-CON-04-099 | 2025-09 (likely), 2026-04 (likely) | 2102.0 | 6649.0 | 4547.0 |
| SEA-BRO-05-100 | 2025-04 (likely), 2026-04 (likely), 2026-09 (likely) | 4740.0 | 6120.0 | 1380.0 |
| GRT-IVO-05-100 | 2025-11 (likely), 2026-01 (likely), 2026-03 (likely), 2026-06 (likely) | 2760.0 | 2860.0 | 100.0 |
| ADH-WHI-02-102 | 2025-02 (likely), 2026-01 (likely), 2026-04 (likely), 2026-09 (likely) | 1367.0 | 1958.0 | 591.0 |
| WPR-GRE-05-105 | 2025-07 (likely), 2025-11 (likely), 2026-09 (likely) | 600.0 | 840.0 | 240.0 |
| WPR-WHI-01-106 | 2026-07 (likely) | 289.0 | 298.0 | 9.0 |
| SEA-WHI-04-109 | 2025-08 (likely), 2026-02 (likely) | 240.0 | 216.0 | -24.0 |
| GRT-GRE-04-109 | 2025-06 (likely), 2026-06 (likely) | 400.0 | 400.0 | 0.0 |
| TLS-PRO-04-109 | 2026-02 (likely) | 2445.0 | 2653.0 | 208.0 |
| TIL-SAN-05-110 | 2025-09 (likely), 2026-06 (likely), 2026-09 (likely) | 179.0 | 345.0 | 166.0 |
| TIL-SLA-01-111 | 2025-04 (likely), 2026-08 (likely) | 432.0 | 183.0 | -249.0 |
| ADH-STA-02-112 | 2025-04 (likely), 2025-06 (likely), 2025-09 (likely), 2026-01 (likely) | 749.0 | 887.0 | 138.0 |
| GRT-BEI-03-113 | 2025-04 (likely), 2025-12 (likely), 2026-03 (likely), 2026-05 (likely) | 370.0 | 680.0 | 310.0 |
| ADH-STA-05-115 | 2025-07 (likely), 2026-06 (likely) | 314.0 | 310.0 | -4.0 |
| UND-MOI-01-116 | 2025-03 (likely), 2025-10 (likely), 2026-04 (likely) | 158.0 | 810.0 | 652.0 |
| TLS-LIG-02-117 | 2025-05 (likely), 2025-07 (likely), 2026-07 (likely) | 5530.0 | 5499.0 | -31.0 |
| WPR-RAP-02-122 | 2025-03 (likely), 2025-11 (likely), 2026-02 (likely), 2026-09 (likely) | 65.0 | 65.0 | 0.0 |
| SEA-BRO-04-124 | 2025-05 (likely) | 696.0 | 696.0 | 0.0 |
