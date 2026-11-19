# CLI CSV byte budget

`stock_runway.py --max-bytes N` sets an explicit per-file byte budget for a
single stock CSV and its optional `--receipts` CSV. The default remains
**2097152 bytes (2 MiB)**. Existing commands need no changes.

```sh
# Allow up to 8 MiB per input CSV; this does not place an order.
/usr/bin/python3 stock_runway.py synthetic-stock.csv --max-bytes 8388608 \
  --today 2026-11-12 --all -o synthetic-orders.csv

# The same budget applies separately to stock and receipts, including strict mode.
/usr/bin/python3 stock_runway.py synthetic-stock.csv --receipts synthetic-receipts.csv \
  --strict --max-bytes 8388608 --today 2026-11-12 --all
```

## Contract and safety

- `N` is an unsigned ASCII decimal integer greater than zero, below
  `sys.maxsize`, with at most `len(str(sys.maxsize))` digits. There is no suffix,
  sign, whitespace, decimal, scientific notation, underscore or non-ASCII digit
  syntax. Invalid values exit with status 2 and an argparse error.
- Each file may be exactly `N` bytes. Larger files fail with status 2 and no CSV
  output. The budget is per file, not the sum of stock and receipts.
- Reads remain bounded to `N + 1` bytes, including a file that grows after the
  initial size check. Chunked reads avoid preallocating the chosen budget for
  a small file. Raising the limit still permits higher memory use; choose only
  the budget needed for a trusted local export.
- Stock preflight also applies the budget to decoded UTF-8 text, preserving the
  existing encoding safety checks. For UTF-16 stock CSVs, both the original
  file size and its decoded UTF-8 representation must fit. Receipts retain their
  existing UTF-8/UTF-8-BOM requirement.
- This is only an import-boundary option. Schema, row-count, quantity and date
  validation remain in place. It does not change forecasting, ordering math,
  default CSV output or saved settings.
- Canonical `--bundle` imports retain their existing independent limits. A
  **nondefault** `--max-bytes` combined with `--bundle` fails explicitly rather
  than silently ignoring the override. Omitting the flag or passing its default
  leaves bundle behavior unchanged.
- Settings JSON, learning files, Desktop, standalone and plugin tool defaults
  are not made configurable by this flag.

## Python callers

The import boundary accepts a keyword-only `max_bytes` on `sources.load_csv`,
`sources.load_receipts`, `csv_import.import_csv` and `csv_import.preflight_csv`.
Defaults remain 2 MiB; booleans, non-integers and values outside the CLI's numeric
range are rejected with `SourceError`. Limits are per call: no module-level
constant is mutated, so one larger CLI import cannot relax another caller.

## Focused regression check

Standard library only; all generated files are synthetic and temporary under
ignored `.scratch/`. No inventory pilot, network or installed Hermes is used.

```sh
export TMPDIR=$PWD/.scratch
/usr/bin/python3 -m unittest discover -s tests -p test_cli_max_bytes.py -v
```

Coverage includes unchanged default output, valid and invalid limits, exact-byte
and UTF-8 boundaries, larger stock imports in both review and strict modes,
receipts, post-stat growth containment, native-range budgets without huge
preallocation, invalid library arguments, the unchanged 10000-row guard and
Python CLI exports against the existing reviewed golden snapshot.

The Python golden comparison is not the cross-runtime `scripts/golden_diff.py`
check; the latter and its fixtures are left unchanged.
