# Shelf-life ordering and commercial clearance

Optional settings `shelf_life_days`, `arrival_age_days` (default 0), and
`min_remaining_life_days` (default 0) resolve product > file > global.
Absent shelf life and absent lots leave all old outputs byte-identical.
Settings accept whole days up to 36500 (shelf life starts at 1, age/margin at 0);
calendar overflow holds advice rather than wrapping dates.

## Hand-worked acceptance examples

These examples use a 2026-10-31 snapshot, a steady 300/month forecast and
November's 30 days (10/day), zero lead, no buffer or backup unless stated.
Demand uses the same dated forecast and committed orders as normal purchases,
not an independent monthly-average shortcut. Dates after November use actual
calendar month lengths. The arrival day is the boundary: its demand belongs to
the pre-arrival balance; the next W days form the usable window.

1. **Short life**: life 10, age 0, minimum remaining 0 gives W=10.
   Demand November 1–10 = 300 × 10/30 = 100. No stock: cap=100;
   the ordinary 60-day purchase is limited to 100. Order every 10 days rather
   than try to cover 60 days. Monthly data with W<30 gives a coarse warning.
2. **Stock unsold on arrival**: same W=10, zero lead, stock=40, with backup
   large enough to trigger today: cap=100−40=60, not 100. Incoming assumed
   within lead and confirmed receipts by arrival are also deducted.
3. **Pack ceiling after rounding**: W=10, stock=0, pack=24 gives
   floor(100/24) × 24 = 96. The usual upward-rounded purchase is capped at 96;
   never round the cap back up to 120.
4. **MOQ conflict**: W=10, pack=24, MOQ=120: feasible cap=96 < MOQ=120.
   Purchase=0 with an explicit conflict naming 120 and 96. A capped zero is
   not labelled healthy. Safety stock is inside this ceiling, never above it.
5. **Short-dated arrival**: life=30, age=18, minimum remaining=5 gives W=7.
   November demand=300 × 7/30=70. W<=0 (e.g. life=20, age=18, min=5)
   means cannot stock, purchase=0, conflict; do not apply negative-window math.
6. **Expired unsold lot raises usable-stock need**: stock=200; lot A=100
   expired October 30, lot B=100 expires November 5. FEFO can sell B's
   300 × 5/30=50 before its deadline, so A risk=100 and B risk=50.
   Usable planning stock=200−150=50 (a deliberately conservative planning
   exclusion, not a write-off). With lead=2 the commercial clear-by dates are
   October 28 and November 3. Sell-through is capped at each lot's quantity.
7. **FEFO shared demand**: lots 80 due November 5 and 80 due November 10:
   first sells min(80,50)=50, risk=30; second sells min(80,100−50)=50,
   risk=30. Do not allocate November's first 50 sales to both lots.

## Policy and limits

The cap is dated demand from arrival through arrival+W minus projected usable
stock still unsold at arrival, floored to a whole pack. Safety stock and buffer
stock must fit inside the cap. MOQ above cap blocks the order. Longer life
cannot decrease the order with all other inputs fixed.

Known lots are consumed FEFO, using expiry minus minimum remaining life as the
last sellable date. Unknown residual stock (on-hand minus known lot totals) is
not assumed expired. At-risk quantities are excluded conservatively from usable
planning stock, including expired unsold lots; physical chart stock is unchanged.
Increasing `min_remaining_life_days` can therefore **raise an order when lots
exist**: earlier sellable deadlines exclude more existing stock conservatively.
Without lots it only tightens the usable purchase window; it is not a general
monotone-decreasing quantity control.
Lot totals differing from on-hand are warned; over-described lots never make
usable stock negative. Incoming stock has no known expiry and is assumed usable.
This is a forecast, not a safety/compliance control or disposal instruction.

“Get rid of by” is a commercial prompt to discount, return, or investigate.
`clear_by = expiry − minimum remaining life − max(1, ceil(supplier lead days))`.
Past dates remain past (urgent review), never silently moved to today.
A lot's `sell_through_qty + at_risk_qty = qty`. Monthly inputs cannot establish
within-month peaks, so W<30 is prominently coarse, not precision assurance.

Imports accept ISO dates, Excel 1900 serials (styled workbook dates retain their
workbook epoch), and month-only values interpreted as month-end with a warning.
Ambiguous dates require the existing input-review acknowledgement. Lot totals
are compared with stock; repeated SKU rows with lot columns are legitimate lots,
not automatically duplicate exports. Repeated lot rows at one location retain the
first product sales/incoming snapshot rather than multiply it by the lot count;
without explicit lot quantity, on-hand is interpreted as stock for that lot and
summed. Different snapshots require review acknowledgement. Explicit lot quantity
means on-hand is a repeated product/location stock snapshot, retained once.
No dates or quantities are inferred from lot names. Product settings may override
imported shelf life. The core holds any lot marked `expiry_acknowledged: false`;
CSV `--show-orders-anyway` or accepting the acknowledged desktop import review
explicitly clears that hold for the accepted data. Re-import asks again.

The ceiling counts supply available at arrival only. Later confirmed deliveries
remain in the normal prefix-netted purchase calculation, not in the ceiling
itself; this preserves the monotonic life ceiling. Undated on-order and dated
receipts represent distinct supply and are additive, as before: do not enter the
same order in both. Excel serials are literal dates with no arbitrary year cutoff;
review implausibly old dates before accepting. Past clearance dates stay urgent.

## Lane verification and integration boundary

Failing-first examples are in `tests/test_shelf_life.py`, `tests/shelf-life.test.mjs`,
`tests/test_shelf_cli.py`, `tests/test_shelf_lot_import.py`, and
`tests/shelf-display.test.mjs`. The JS property corpus checks exact Python/JS
order-guidance parity and nondecreasing purchases for 2000 seeded cases including
fractional packs, multiple lots, backup stock, buffers, incoming, and zero cover.
A scratch-built single-file page executes that same core. Desktop clearance
renders imported names as React text children, not HTML.

No frozen hash guards or generated HTML were updated in this lane. The authorized
changes are: optional shelf settings resolution/validation; new FEFO and cap
helpers; guarded order-guidance stock exclusion and post-rounding cap; explicit
why-ledger cap/exclusion terms and sentences; lot/shelf import aliases and review;
and desktop display/CLI opt-ins. Forecast-method algorithms, default settings
values, historical backtests, source datasets and goldens remain untouched.
`golden_diff.py` reports all fields unchanged and `verify_import_examples.py`
reports the eight existing ERP examples unchanged.

The full lane pytest run reported 2076 passed / 36 failed; all 36 failures compare
unregenerated standalone HTML to the intentionally changed shared core. The full
Node run reported 3586 passed / 10 failed: four old exact-byte approved/core
fingerprints and six standalone embedded-core comparisons. `unittest discover`
passed 255 tests. The last focused run passed all 30 shelf/import/CLI Python tests
and six Node shelf/display tests. These are source/local proofs, not a claim of a
passing release gate. Integration must rebuild the offline outputs and review
new approved fingerprints after merging all lanes; do not weaken the old guards.
The standalone shell still needs its clearance section, capped badge and accepted
expiry-date acknowledgement wired to the shared core by the integration owner.
Browser/real Desktop acknowledgement UX and physical retail FEFO assumptions
were not validated here.
