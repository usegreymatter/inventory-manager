Lifecycle: living

# AI guide: task recipes

Short, checkable steps for AI assistants and new developers. Read [AGENTS.md](../AGENTS.md) first. Recipes marked *(planned)* depend on [ROADMAP-CONNECT](ROADMAP-CONNECT.md) packets that are not built yet. Follow them only inside that packet.

## Orientation in 60 seconds

| Question | Answer |
|---|---|
| Where does the maths live? | `engine.py` (Python) and `desktop/plugin.js` (JS mirror). Keep them identical |
| What input does the engine trust? | A Contract 1.0 bundle ([data/CONTRACT.md](data/CONTRACT.md)) or a single `stock.csv` |
| How does ERP data get in today? | `csv_import.py` + `sources.normalize_erp_rows` (alias headers), `bundle_import.py`, or `sources.OdooReadOnly` (read-only, 1–50 SKUs) |
| Where are "why" explanations? | `engine.why_breakdown` and the matching JS |
| What does learning store? | Opt-in JSONL diary and log (`learning.py`); in the standalone page, `localStorage` |
| What must never happen? | Live writes, live data in tests, secrets in the repo, Python/JS drift, forecast method changes before Nov 2026 actuals |

## Recipe: run a dry run on sample data (works today)

**Missing-data gates.** Missing incoming supply stays unknown in source data and exports, but purchase estimates assume 0 incoming; check existing orders before buying. Missing or invalid stock or sales holds advice (at least 3 complete sales months are required). Missing supplier lead time uses the configured fallback (14 days by default, marked `used_default_lead`); clearing that fallback without another valid lead holds purchase advice, not the physical forecast. A supplied source lead of 0 is valid. Invalid supplied incoming holds advice.

```sh
python3 stock_runway.py samples/synthetic --bundle --today 2026-11-01 --all
python3 stock_runway.py docs/erp-examples/odoo.csv --today 2026-11-01 --all
python3 data_contract/validate.py samples/synthetic   # contract check
```
Nothing here touches a network or an ERP. Compare with `scripts/golden_diff.py` if you changed engine code.

## Recipe: map my ERP's CSV export (works today)

1. Export items with stock (and monthly sales if available) to CSV.
2. Run `python3 stock_runway.py my_export.csv --today YYYY-MM-DD`. Recognised headers are mapped by `sources.ERP_ALIASES` (Python) / `ERP_ALIASES` (JS).
3. If a needed header isn't recognised, rename it in the export, **or** add the alias in **both** `sources.py` and `desktop/plugin.js`. Then add a fixture under `docs/erp-examples/`, run `scripts/verify_import_examples.py`, both test suites, and `standalone/build.py`.
4. Never map a price-break quantity to MOQ, or a display name to SKU (CONTRACT "Required semantics").

## Recipe: map my ERP fields with a mapping file *(planned, P1)*

1. Copy the closest example from [architecture/mappings/](architecture/mappings/) (`odoo`, `shopify`, `csv`).
2. Edit `fields` so every canonical field (see [architecture/schema/](architecture/schema/)) points to your vendor field. Use only the listed transforms.
3. List secret **names** in `secrets`. Put values in Hermes secrets / env / keychain, never in the file.
4. Leave `verified: false` until the owner checks the mapping read-only on the real system.
5. Run `stock_runway.py sync --connector <id> --mapping <file>` (dry run). Read the counts, `unavailable` streams and diff. Use `--apply` only when it looks right.

## Recipe: add a connector *(planned, P1.3+)*

1. Read [architecture/CONNECTORS.md](architecture/CONNECTORS.md) §2, §5, §9 and §10.
2. Write the vendor evidence table: each endpoint/model and field, with an official doc link, marked ASSUMED until verified. Don't invent API details.
3. Add synthetic fixtures + golden bundle under `tests/conformance/` **first** (RED).
4. Implement `check()` and `read()` only. Use `safe_fetch()`, the built-in field allowlist, generic errors, and secrets by name.
5. Pass C1–C13. Add an example mapping. Update the table in CONNECTORS §8.
6. Any write ability (`write_po_draft`) or new OAuth scope needs **owner approval** in its own packet.

## Recipe: change or add a worklist column (works today)

1. The spec lives in `standalone/design/COLUMNS.md`. Update the definition first, including its missing-data behaviour.
2. Columns are display-only. They must not change quantities, forecasts or CSV parsing. If the change would, it is an engine change: do it in both `engine.py` and `desktop/plugin.js` with parity tests.
3. Edit the design sources (`standalone/design/*`, `desktop/plugin.js`), never `standalone/stock-runway.html`. Rebuild with `python3 standalone/build.py`.
4. Run `node --test --test-concurrency=1 tests/*.test.mjs` and `python3 -m pytest -q`. Capture a harness screenshot under `.scratch/`.

## Recipe: add a contract field (works today, careful)

1. Add it as **optional** in `docs/data/CONTRACT.md` with its missing-value meaning.
2. Update `data_contract/validate.py`, `bundle_import.py`, the engine and the JS mirror together. Add a synthetic sample column. `tests/test_data_contract_docs.py` keeps docs and the validator in sync.
3. If connectors are built, add it to the matching `architecture/schema/*.schema.json` and the bundle writer.

## Recipe: draft a purchase-order email *(planned, P2)*

Produce a `po_draft` ([schema](architecture/schema/po_draft.schema.json)) and a local `.eml` only. The recipient comes from `suppliers.json`. Never send. Sending is L2/L3 and owner-gated ([AUTOMATION](architecture/AUTOMATION.md)).

## Recipe: look at forecast accuracy (works today)

```sh
python3 stock_runway.py samples/synthetic --bundle --today 2026-11-01 --forecast-diary .scratch/diary.jsonl
```
Scoring is done by `learning.score_diary` once later months complete. Don't change forecast methods. Propose them per [LEARNING-LOOP](architecture/LEARNING-LOOP.md) §5.

## Before you say "done"

List files changed, commands run with real pass counts, `golden_diff` result if engine-adjacent, whether `standalone/build.py` was run, and a `Not checked:` line.
