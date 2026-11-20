Lifecycle: living

# Input meaning before orders

Local CSV and workbook review now asks three questions in **Before we suggest orders**:

- **Your stock number is:** available to sell, or includes reserved/allocated stock. The second option subtracts a recognized reserved/allocated quantity column before the unchanged import and calculation engines run. Missing columns produce a persistent warning. Invalid, negative or excessive reserved values set those source rows aside and require acknowledgement; they are never silently treated as zero.
- **Incoming orders:** included in the file, or not in the file. Missing/blank/unparsed incoming values remain unknown. “Not in file” ignores undated incoming quantities, without removing separately supplied dated receipts. Results keep the warning **Incoming orders unknown — counted as 0. Check open POs before ordering.** and list the affected product codes.
- **Units:** explicitly confirm that stock and sales already use the same unit. Recognized sales/stock unit columns that disagree produce a warning; no conversion is invented.

Only the file layout, column choices, these three answers and a warning checksum are remembered locally. Raw spreadsheet rows and the **Show orders anyway** acknowledgement are not remembered. Layout review repeats when warnings, exclusions or defaults change; risky files always need fresh acknowledgement. Cancel preserves the previously accepted dataset.

More than 20% of source stock rows missing stock or sales, more than 20% of sales-ledger rows missing quantity, or future sales dates require **Show orders anyway** before the file can be accepted. Separate sales sheets are checked for unmatched products as well as empty quantities. Existing row-level validation still applies: acknowledgement cannot turn an unusable quantity into a valid order.

CSV files retain their established row exclusions and preflight report; this report follows the meaning review where applicable. Workbooks keep the existing column-mapping review. Canonical bundle bridge JSON keeps its established bundle validation rather than interpreting CSV-specific flags.

## Python CLI

Defaults and forecast/order arithmetic are unchanged. Opt in to CSV interpretation with:

```sh
/usr/bin/python3 stock_runway.py synthetic.csv --stock-includes-reserved --incoming-not-in-file --all
```

These flags emit an `Input meaning: {…}` JSON report on stderr, including warnings and affected SKUs. If that interpretation finds missing-row/date/reserved risks, output quantities are blocked until the operator checks the file and explicitly adds `--show-orders-anyway`. This is an acknowledgement, not a repair. The reserved flag is incompatible with `--strict`; the CLI explains that the preflight importer is required to recognize the extra column. CSV interpretation flags do not apply to canonical bundles.

## Proof surfaces

- `tests/input-meaning.test.mjs`: independent synthetic Python/JavaScript parity, exact 20% boundary, missing incoming, reserved subtraction/failures, future months, and separate stock/sales sheets.
- `tests/test_input_meaning.py`: real CLI flags, default preservation, JSON warnings and explicit-risk acknowledgement.
- `standalone/capture-input-meaning.cjs`: real offline browser gate, remembered choices, fresh acknowledgement, Cancel, results warnings and affected rows at 1440/390px. Evidence is under ignored `.scratch/input-meaning/`.
- Existing capture scripts explicitly answer the new review before continuing their prior import/settings assertions; they do not disable validation.

This is local synthetic proof, not evidence of a real ERP connection, installed Desktop runtime or order placement.
