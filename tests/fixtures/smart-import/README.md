# Synthetic Smart Excel import fixtures

All names, SKUs, quantities and suppliers are fictional. No network or live data.

Regenerate with `/usr/bin/python3 scripts/generate_smart_import_fixtures.py`; verify without writes by adding `--check`. Requires Python standard library only.

`manifest.json` enumerates each input and independently intended mappings. Each `.expected.json` carries its canonical months/items oracle and physical header coordinates. These files describe acceptance intent, not importer output or a confirmation that any current parser supports these layouts. Mapping JSON is deliberately importer-independent; importer-specific proposal fields can be derived by the consumer while retaining this oracle.

Most cases normalize to exactly A-001/B-002, stock 12/8, supplier lead time 14/21 days, and January–March 2026 sales [3,6,9]/[2,4,6]. Long-layout stock is repeated metadata, not additive. The join starts from Stock and reports UNMATCHED-999 without creating it. The missing-SKU workbook must be blocked.

OOXML includes STORE and DEFLATE ZIPs, fixed member timestamps and permissions, shared and inline text, numeric and boolean cells, date styles 14/164, 1900/1904 date systems, and a merged title. There are no formulas, macros, external links or volatile generation timestamps. Native Excel rendering is not asserted.
