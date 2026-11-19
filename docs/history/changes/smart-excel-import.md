Lifecycle: living

# Smart Excel import — app and power-user CLI

`/usr/bin/python3 scripts/understand_sheet.py <xlsx|csv>` reads only the explicit local file, proposes canonical columns through `smart_import.py`, and runs the existing `csv_import.preflight_csv` validator. It adds **no forecast, purchase, quantity-cleaning or inventory math**. It needs no installation, network, Hermes runtime, Excel library, or ERP credentials. Inspection without output flags writes no data files.

**Review is required even when validation passes.** This is deterministic, bounded pattern recognition, not a promise to literally understand arbitrary or ambiguous spreadsheets. Confidence labels describe the mapping heuristic, not a probability that stock decisions are correct. A successful numeric/schema check cannot establish that a column really means on-hand stock or fulfilled sales.

## App review

Drop an `.xlsx` or a messy `.csv` into **Import Excel or CSV**. The offline app proposes a main stock sheet, finds headers within the first 30 physical rows, recognizes monthly columns or dated sales transactions, and joins auxiliary sheets by exact product code. **We understood your file** shows sheet/header/layout, each detected column and confidence/reason, ignored columns, missing facts, matched/unmatched codes, preflight warnings and the first five products. Low/medium suggestions are editable immediately; **Change** enables all mapping controls. **Use this** confirms the proposal through the existing preflight, while **Cancel** or Escape leaves the current products unchanged.

Confirmed layouts are remembered on this device, not spreadsheet rows. A repeat layout imports automatically only when it is valid, warnings/defaults have not changed, and no rows were omitted/set aside. The visible **Review** action reopens the retained local file. Storage denial falls back to ordinary review. Recognizable legacy CSV files continue through their unchanged preflight path and Import check dialog. Desktop uses the same core with host-local mapping storage and a review panel; standalone uses localStorage and a native modal.

`smart-import-vocabulary.json` is the one supplemental vocabulary source (including Arabic column labels). It extends, rather than replaces or duplicates, existing `sources.py`/Desktop ERP aliases and product-type aliases. `scripts/sync_smart_import.py` embeds the dependency-free JS module and this vocabulary in the Desktop pure block; `--check` rejects stale copies. The standalone builder extracts that same block. There is no CDN, remote upload, formula execution or second inventory-planning pipeline.

## Commands and output handles

Run from the repository root, using authorized local files only:

```sh
mkdir -p .scratch
export TMPDIR=$PWD/.scratch

# Human-readable report: detected columns, confidence/reasons, layout and warnings.
/usr/bin/python3 scripts/understand_sheet.py tests/fixtures/smart-import/wide_months.xlsx

# Machine-readable report, including the complete proposed rows and validation.
/usr/bin/python3 scripts/understand_sheet.py tests/fixtures/smart-import/wide_months.xlsx \
  --json > .scratch/sheet-report.json

# NEW output paths only; an existing file is never overwritten.
/usr/bin/python3 scripts/understand_sheet.py tests/fixtures/smart-import/wide_months.xlsx \
  --mapping-out .scratch/sheet-mapping.json --to-csv .scratch/sheet-canonical.csv \
  --json > .scratch/sheet-export-report.json

# Reuse a reviewed map. Stock is the exact base worksheet name in this fixture.
/usr/bin/python3 scripts/understand_sheet.py tests/fixtures/smart-import/three_sheet_join.xlsx \
  --sheet Stock --json > .scratch/sheet-join-report.json
/usr/bin/python3 scripts/understand_sheet.py tests/fixtures/smart-import/wide_months.xlsx \
  --mapping .scratch/sheet-mapping.json --json > .scratch/sheet-remapped-report.json
```

Output paths must have existing parent folders, differ from the source/mapping input and each other, and not exist (including symlinks). Exclusive creation protects against ordinary overwrite races. Shell redirection of the report is controlled by the shell, **not** this protection: never redirect stdout onto your source file. Files are written independently, not as an all-or-nothing transaction; inspect `outputs` after any failure. In particular, a mapping can be saved for correction while CSV export is blocked.

| Handle | Meaning |
|---|---|
| stdout, default | Human-readable report; no full CSV dump |
| stdout, `--json` | One JSON object; no progress text mixed in |
| stderr | Friendly local-file/output errors in human mode; argparse usage errors remain conventional stderr even with `--json` |
| `--mapping-out PATH` | Suggested UTF-8 JSON, `verified: false`; never marks the source as verified |
| `--to-csv PATH` | Canonical **proposal**, comma-delimited UTF-8 with BOM and LF; only written if no required facts are missing, preflight succeeds, no invalid/inactive/duplicate rows were omitted or set aside (recognized summary/blank-code rows are intentionally skipped), and the file fits the existing 2 MiB loader cap |
| exit 0 | Inspection/preflight succeeded and requested exports succeeded; still needs review |
| exit 2 | Invalid arguments, unreadable/unsupported input, mapping/export error or failed preflight |

The JSON object retains the core's fields: `sheets`, `sheet_used`, `header_row` (one-based), `layout` (`products`, `wide`, `long`), `mapping` (zero-based `index`, `source`, `field`, `confidence`, `reason`), `unmapped`, `missing`, `warnings`, `match_report`, `fingerprint`, and `canonical_rows`. Added fields are:

- `review_required: true`, always.
- `validation.ok`, `validation.import_report` and, when preflight rejects the proposal, `validation.error`. The import report is the existing validator's report, not a second implementation. Its row numbers refer to the **canonical proposal CSV**, not physical workbook rows. A partial preflight with usable products can have `ok: true` and set-aside rows; these remain visible and block `--to-csv`.
- `outputs.mapping` / `outputs.csv`: absolute paths of files actually written, never merely requested paths.
- `error`: local read/mapping/export failure. Before understanding/validation is available, errors return the smaller `{error, review_required, outputs}` object. A validation failure preserves the understood report for correction.

`--sheet` selects an exact **base sheet name**, not a numeric index, and does not isolate that sheet. The core can still join other product/stock/sales sheets using exact trimmed SKU. The default base is chosen by the core. No fuzzy name-based product joins occur.

## Reviewing and reusing a mapping

The CLI checks the mapping contract available at:

```sh
git show connect-design:docs/architecture/schema/mapping.schema.json
```

Exports use a compatible subset: `mapping_version: "1"`, `connector: "spreadsheet"`, a short description and `streams`. Each stream names an exact worksheet in `source`, has `verified: false`, and maps canonical fields to `{"from": "column:N"}` (zero-based positional references). This is a **local spreadsheet dialect**, not a verified or directly executable future connector configuration. Example:

```json
{
  "mapping_version": "1",
  "connector": "spreadsheet",
  "description": "Review every positional reference before reuse.",
  "streams": {
    "Stock": {
      "source": "Stock",
      "verified": false,
      "fields": {
        "sku": {"from": "column:0"},
        "name": {"from": "column:1"},
        "on_hand": {"from": "column:2"}
      }
    }
  }
}
```

For `--mapping`, a field can alternatively use a unique exact header string (`"sku": "Item Code"`) or `{"from": "Item Code"}`. Missing/ambiguous headers, absent sheets, out-of-range column indices, duplicate JSON keys, unknown targets and multiple targets for a source column are rejected rather than silently ignored. The supported target vocabulary is the core's canonical aliases plus `date`, `quantity`, `YYYY-MM` and `rcv:YYYY-MM`. No transform/constant/default/filter/cursor is executed; secrets and unit-conversion references are not supported. The CLI is not a general JSON Schema validator for arbitrary connector files.

For explicit ignore rules or duplicated monthly targets, `--mapping` also accepts the core's raw override object:

```json
{"Stock:0": "sku", "Stock:1": "name", "Stock:2": "on_hand", "Stock:7": ""}
```

An empty string ignores that column. Omitted rules still use automatic detection. Rules already agreeing with detection retain the original confidence/reason rather than artificially changing header scores. If an actual override moves the detected header row, the CLI fails closed instead of silently treating a product row as a header and dropping data; make the workbook's headers unambiguous and re-export. Mapping exports contain recognized fields only; they do **not** preserve explicit ignore rules. Keep the raw override file when ignore decisions matter. Positional maps do not pin the workbook fingerprint or header row: recheck headers, offsets, base sheet and meaning whenever the export layout changes. `fingerprint` is a structural core report value, not a cryptographic identity or authorization token.

Schema limits restrict mapping export to **10 sheets**, **40 recognized fields per sheet**, and **120-character sheet names**. Duplicate targets within a sheet (for example two columns for the same sales month) cannot be represented losslessly by this mapping dialect, so mapping export refuses rather than dropping one. These are mapping-export limits, not inspection limits. Use raw overrides without `--mapping-out` where appropriate. Mapping input is capped at **2 MiB**.

## Bounds and interpretation limits

- Core file cap: **20 MiB** compressed/input bytes; XLSX expanded ZIP cap: **80 MiB**, at most **4096 ZIP entries**. Across the workbook: **200,000 rows**, **16,384 columns per row**, **2,000,000 materialized cells**, including sparse positions. XML nesting is bounded; allocation is also capped at 500,000 XML elements across parts and 200,000 shared strings before creating trees. DTDs/entities, encrypted archives and unsupported compression are rejected.
- Header candidates come from the first **30 rows**; some value-based suggestions examine up to **20 following rows**. Titles/totals can be recognized, but arbitrary multi-row headers, narrative sheets or unusual business semantics are not guaranteed.
- `.xlsx` and UTF-8/BOM-marked UTF-16 CSV are supported. `.xls`, `.xlsb`, password-protected files and other formats need a local re-export. The reader does not execute macros, formulas or external links. Formula cells use cached values where present; recalculation and stale-cache detection are not provided. Never interpret a cache as a verified current stock count.
- Yearless month names use the core's inferred year, or a fixed **2000 placeholder** with a warning if no year is found. Inspect and map explicit months before planning. Textual date conventions are heuristic, not locale configuration.
- SKU joins are exact: leading zeros and unit distinctions matter. Only distinct warehouse locations with agreeing stock units may combine; repeated/unknown locations and conflicting units are omitted with warnings. Inactive rows and summary/blank-code rows are omitted. Varying stock balances in a dated ledger block import: supply a stock snapshot instead. Missing required values and unmatched product history block import rather than becoming invented names, stock or zero demand. Auxiliary-only codes are reported, not silently added to the main stock sheet. Multi-sheet merging is not arbitrary relational reconciliation.
- Missing business facts (SKU/name/on-hand) are not invented. A missing stock unit can default to `units`; supplier lead time remains unknown. Supplying the true stock unit, order-to-delivery lead time and sales meaning remains the owner's job.
- Canonical proposals retain fixed/optional planning fields, unit cost, MOQ, pack size, monthly sales and receipts. Active/inactive/location metadata is used for row selection and safe warehouse aggregation, not copied as product facts. Preserve the source file for original row provenance. Existing direct CSV preflight remains the authoritative path for established ERP CSV behavior. CSV delimiter/number conventions are reused; ambiguous numeric text is rejected rather than silently scaled.
- Validation retains existing rules, including at least **3 consecutive sales months**, **10,000 product rows**, quantity/calendar bounds, negative-sales handling, missing lead-time disclosure and set-aside rules. `--to-csv` cannot bypass these, and refuses files exceeding the downstream loader's **2 MiB** cap (including BOM). Reader limits are deliberately larger than planner/CSV-loader limits.
- `--to-csv` serializes the **core proposal**, not preflight's cleaned item records. Preflight can clamp negative sales or interpret number formats with warnings; rerun existing import validation when consuming the CSV. Successful export is not literal Excel safety: original formula-like text identifiers/names are preserved for round-trip fidelity. Treat it as machine interchange; do not open untrusted proposals directly in Excel. Use the existing formula-hardened order-export path for display exports.
- Reports, maps and CSVs may contain inventory data. They stay local; stdout redirection/export is an explicit operator action. Do not publish or commit private reports.

## Verification record

The local evidence summary is [`smart-excel-import-verification.json`](smart-excel-import-verification.json). It records source/artifact hashes, 38 core and 20 CLI unittest results, 3,432 passing Node tests, 30 fixture/viewport browser runs, all required regression captures, unchanged eight ERP import examples and unchanged order-math goldens. Three Smart import screenshots were visually inspected; scrolling and footer reachability were also exercised, not inferred from still images.

Only the Desktop pure-block hash was refreshed in `docs/import-logic-baseline.json`. Its engine/CSV backend hashes were already stale at task entry; rather than rewriting those historical hashes, `docs/capture-polish.cjs` binds those two exact files to immutable `e036646` bytes. Other backend/sample pins remain intact, and all mutation-rejection tests pass. No engine, legacy CSV importer, source aliases, tools or sample bytes changed during this task.

Not checked: actual Desktop host rendering, native Excel/LibreOffice, Safari/real iPhone, private/live owner exports or ERP services. The protected `AGENTS.md` AI-guide edit was not authorized and remains unchanged; README and this guide document the CLI.

## Offline verification

```sh
mkdir -p .scratch
export TMPDIR=$PWD/.scratch
/usr/bin/python3 -m unittest discover -s tests -p test_understand_sheet.py -v
```

The CLI tests use temporary synthetic CSV/XLSX files only. They check report/core equality, reuse of the existing preflight report, exact base-sheet selection and joining, mapping round-trips and supported schema shape, caps, friendly errors, no-clobber paths and blocked invalid/partial exports. They also compare serialized existing preflight results for all **8 committed ERP CSV examples** with `6fca685`, byte for byte. This is local Python proof, not Excel/LibreOffice, hosted UI, live-owner-file or ERP integration proof.
