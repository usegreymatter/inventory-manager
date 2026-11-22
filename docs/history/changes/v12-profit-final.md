Lifecycle: living

# Round 3A final paired profit stress

Synthetic/offline only. Re-ran the independent unchanged harness after the CLI/risk fixes: **2,880 scenarios**, 12 families, 30 paired seeds × four cover settings × stockout adjustment off/on. The 11 eligible families use `profit_suggestion.qty`; intermittent parts deliberately use ordinary `quantity` because the profit suggestion abstains. This is the deployed-with-abstention policy, not an imaginary suggestion for withheld products.

Source Python-corpus fingerprint for both fresh arms: `085e3255baddf08a37befce2425e2b3df90f516c5dd83792cc87593067ee9ab6`. The comparator checks exact family/seed/config universes, harness fingerprints and compatible manifests. Original `lane-o-profit-96.json` and `lane-o-baseline.json` were filtered **only by family** into new `.scratch/r3a-stress/*-filtered.json` files; originals and harness are untouched. Fresh outputs are `.scratch/r3a-stress/r3a-profit-{eligible,parts}.json`; exact per-config paired CIs are in `eligible-vs-lane-o-{profit-96,baseline}.json` and `parts-vs-lane-o-{profit-96,baseline}.json` in that directory. The pooled family table is `family-table.json`.

## Family deltas

B minus A. Family rows average the eight settings **within each seed**, then use 1,500 paired-seed bootstrap resamples. Net profit is synthetic currency; fill deltas are percentage points. CIs are 95% percentile intervals. Net profit = revenue − sold-unit COGS − daily end-stock holding − write-offs; no ordering cost, and terminal assets are not expensed. This is sensitivity analysis, not a trained universal winning policy.

| Family | Δ profit vs O96 [95% CI] | Δ fill pp vs O96 | Δ profit vs v1.1 [95% CI] | Δ fill pp vs v1.1 |
|---|---:|---:|---:|---:|
| intermittent_parts | -181.51 [-385.55, +44.11] | -1.14 | +0.00 [+0.00, +0.00] | +0.00 |
| perishable_14_fefo | +0.00 [+0.00, +0.00] | +0.00 | +3624.71 [+3344.65, +3890.97] | -12.27 |
| perishable_14_freshest | +0.00 [+0.00, +0.00] | +0.00 | +3710.96 [+3475.26, +3962.30] | -12.08 |
| perishable_30_fefo | +0.00 [+0.00, +0.00] | +0.00 | +1623.36 [+1518.89, +1736.11] | +16.11 |
| perishable_30_freshest | +0.00 [+0.00, +0.00] | +0.00 | +1487.47 [+1389.45, +1588.89] | +14.07 |
| perishable_365_fefo | +0.00 [+0.00, +0.00] | +0.00 | +481.47 [+447.55, +516.54] | +11.52 |
| perishable_365_freshest | +0.00 [+0.00, +0.00] | +0.00 | +533.21 [+493.69, +574.13] | +11.74 |
| perishable_7_fefo | +0.00 [+0.00, +0.00] | +0.00 | +5556.98 [+5220.32, +5889.56] | -6.78 |
| perishable_7_freshest | +0.00 [+0.00, +0.00] | +0.00 | +5492.66 [+5219.74, +5753.10] | -7.75 |
| perishable_90_fefo | +0.00 [+0.00, +0.00] | +0.00 | +528.21 [+495.64, +561.69] | +11.73 |
| perishable_90_freshest | +0.00 [+0.00, +0.00] | +0.00 | +359.42 [+321.77, +400.74] | +10.43 |
| steady | +0.00 [+0.00, +0.00] | +0.00 | +1491.64 [+1409.70, +1579.89] | +11.78 |

## Interpretation and boundaries

- Eligible families exactly reproduce O96; this round adds correctness/presentation safeguards, **not a new profit gain** over that policy.
- Withheld intermittent-parts products exactly reproduce v1.1 ordinary amounts in this experiment. Versus O96 their mean profit difference is negative but its interval spans zero; withholding is a reliability boundary, not evidence of profit superiority.
- Seven- and fourteen-day products trade lower fill for substantially lower write-offs and higher simulated profit. Do **not** market this as an across-the-board service improvement.
- Per-config compare files retain all 15 simulator metrics and cost-ratio sensitivities; the pooled JSON retains lost margin, holding cost, expired value and average stock value as well as profit/fill.
- No preset or Recommended-method arm is measured here; those combination experiments remain separate. No live inventory, installed Desktop, real money or production result is implied.
