# Why-this-number waterfall

The big suggested-order quantity (or held dash) is a button. It opens a native
modal drawer on PC and a bottom sheet on phones. Escape, Close and backdrop
dismiss; focus containment and return-to-trigger are preserved. Product
navigation shortcuts do not fire through either dialog. No new main-screen
section exists.

## Core producer contract

`engine.why_breakdown(item, today, settings, as_of)` and the identical JS
`whyBreakdown(item, today, settings, asOf)` produce ordered `{key, qty}` rows.
A3 calls the JS core with the same evaluated item, decision date, settings and
snapshot as guidance. The temporary calendar-demand/residual adapter is gone;
`guidance.breakdown` is not a second source of truth.

- Non-total rows are **signed deltas**, in item units, in core order. Negative
  removes supply or excluded demand; positive adds demand/buffer/rounding.
- For a numeric purchase, all quantities are finite and the deltas sum **exactly**
  left-to-right to `guidance.quantity`, including explicit core arithmetic
  reconciliation rows. A3 appends an absolute `total` row equal to guidance.
- A held purchase is a **single** core row with `qty: null`, never zero. A3 shows
  its short hold label and item unit, with no number, bar or total. Late PO hold,
  sales-history hold, customer-order hold and missing-data hold remain distinct.
- A3 maps keys to English STRINGS labels of one to three words. Pack rounding is
  “Round to box” only for a non-unit pack; otherwise “Round up”. MOQ has its own
  “Minimum order” row, and the safety row is “Safety stock”.
- Customer orders, Sold-out months fixed, Projects removed and Manual change
  appear only for non-zero core deltas. A late PO hold appears only when the
  core returns that hold (the purchase is unknown, not a numeric adjustment).
- Other producer rows retain their values and ordering, including zero rows.
  Unknown keys, invalid labels or non-conserving ledgers fail closed; A3 never
  rebuilds a fallback estimate or changes guidance to make the rows balance.
- Every numeric row, including total, shows the item unit. Hold rows also show
  the unit but no numeric quantity. Delta labels display at most two decimals
  (up to six for values smaller than 0.01); numeric tooltips retain six decimals.
  Raw step data retains full precision, so visible rounded deltas may differ
  slightly from the total. Negative zero displays as zero; zero has no bar.

The renderer only reads the ledger. It never selects a method, rounds an order,
updates guidance, or adds safety stock to the purchase. Existing Python/JS core
parity tests exercise the producer; A3 tests compare presented deltas directly
to that producer across phase-2 and manual golden inputs. `capture-a3.cjs` also
uses an offline synthetic fixture with cleaned history, customer orders and
manual change, plus a late-PO-held counterpart. It checks exact conservation,
compact labels, units and a single nonnumeric hold; the numeric drawer screenshot
is `.scratch/phase2/why-phase2.png`.

## Data-health boundary

Health warnings show in a compact modal list behind the topbar count chip; each
item-specific warning also adds a tiny amber dot beside that SKU in the sidebar.
Dataset-wide warnings identify Snapshot in the list (not repeated on every row).
Warning labels are table-owned and at most three words. Feature readiness stays
in the pure modules, not a new panel of inactive future features. No 'new' dot is
added in this release.
