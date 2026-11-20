Lifecycle: living

# Pure purchase-quantity explanation

## API

- Python: `engine.why_this_amount(item, today, settings=None, as_of=None) -> str`
- JavaScript pure block: `whyThisAmount(item, today, rawSettings={}, asOf=item?.as_of) -> string` (named export)

Pass the same calculated/source item, planning date and settings as
`order_guidance` / `orderGuidance`. Retain original fractional `on_hand`, raw
`monthly_sales` and the dataset's month-end `as_of`; chart-rounded stock is not
purchase-planning stock. An explicit snapshot argument overrides `item.as_of`.
No browser clock, input mutation, ERP write or new purchase calculation is added.
Render the returned string as text, not HTML.

## Numeric contract

The exact `why_breakdown` / `whyBreakdown` signed ledger retains its original
quantities and component order, including MOQ uplift, pack rounding and arithmetic
reconciliation. Left-to-right binary64 addition of those exact quantities equals
the existing suggested order exactly. JSON exports retain this ledger in
`why_breakdown`; use it, not the human-readable sentence, for exact reconciliation.

The sentence rounds visible terms to **two decimal places**, using decimal
half-up rounding and omitting insignificant trailing zeros. When the final
purchase quantity needs finer precision, it uses that precision, up to six decimal
places. It omits binary64 arithmetic residue rather than presenting it as demand;
if the rounded terms do not add up to the displayed order, a signed
**display rounding** (`display_rounding`) term reconciles the visible sum. That
term is display-only, not extra demand, MOQ uplift, pack rounding or a new purchase
calculation, and is not added to the exact ledger. Displayed terms need not
round-trip to their underlying binary64 values. “Units” refers to the product's
inventory base unit; it does not convert kilograms, boxes or packs.

Held purchase advice never becomes a zero-unit suggestion. Stable ledger hold
markers supply the summary wording (the pre-existing Python/JS forecast reason
strings differ for some invalid inputs); detailed reasons remain in guidance.
No forecast demand is not a promise of no future sales. Assumed lead time,
undated incoming assumed within lead time, and unknown incoming assumed zero
are explicitly identified when applicable.

## CLI opt-in

- Default invocation retains the existing CSV column set, but stock CSV imports
  now emit an `Input meaning: {…}` review on stderr and can block output with exit
  code **2** pending explicit risk acknowledgement. Default output is not an
  unconditional order list; see [CLI input review](GUIDE.md#input-meaning-and-acknowledgement).
- `--explain`: append the `why_this_amount` string column to CSV.
- `--json`: export the rows as a JSON array, always adding the readable
  `why_this_amount`, exact `why_breakdown` ledger and `input_warnings` list.
- Both flags work with `--all` and `-o`; `--json --explain` equals `--json`.
  Normal import checks and summaries retain their existing streams.

## Local verification

```sh
mkdir -p .scratch
export TMPDIR="$PWD/.scratch" PYTHON=/usr/bin/python3
/usr/bin/python3 -m pytest -q tests/test_why_amount.py tests/test_why_breakdown.py tests/test_cli.py tests/test_golden.py
node --test tests/why-amount.test.mjs tests/why-breakdown.test.mjs
/usr/bin/python3 scripts/golden_diff.py
```

Parity covers every sample and demo-1000 item, 200 deterministic random
synthetic items, committed-demand/manual-change golden cases and an overdue
incoming hold. Tests check text parity, unchanged inputs/settings, display-decimal reconciliation
and exact binary64 ledger reconciliation (not approximate equality).

## Simple-first interface

Simple is the first-device default. Its six columns are Product, Status, On hand,
Order qty, Order by and Risk. Risk labels are display-only buckets of the existing
run-out probability: **Low <10%, Medium 10–40% (inclusive), High >40%**. Unknown or
withheld risk is never labelled Low. Python `risk_label` and JavaScript
`riskLabel` share boundary/parity tests; neither changes the simulation.

One **Show detail** toggle reveals extra columns, forecast cloud, scenario slider,
method notes, ledger and settings. The choice stays on this device; an explicitly
saved dataset view or URL view overrides the device's starting preference. Detailed
and Custom remain available, and the toggle restores the last expanded mode.

Every mounted order row exposes the pure explanation in its quantity tooltip and
accessible product description. The product page shows its compact rate/lead/cover
context, with the same readable ledger in the tooltip and accessible description.
The readable ledger uses the display-rounding rules above; exact ledger quantities
remain available separately. Monthly rate, lead time, cover, MOQ and pack provide
context, not additional terms in the sum.

Only the plugin `pureBlock.sha256` is refreshed in the import manifest. Historical
backend/sample pins remain frozen. The polish guard independently pins the additive
engine display-helper bytes, removes only that exact block, and proves all original
engine bytes still match the frozen checkpoint. Mutation tests cover both paths.
All standalone variants must be rebuilt after a pure-block change.

