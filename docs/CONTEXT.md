Lifecycle: living

# Docs contract

Inputs: the source tree; synthetic fixtures only.
Job: user reference, data contract, forecast-method spec, roadmap designs and development history.
Map:
- `GUIDE.md`: full user reference (settings, CLI, CSV/ERP import, Odoo, Desktop plugin, number rules).
- `terminology.md`, `data/`: plain-English terms, CSV bundle contract, order-building spec, Arabic glossary.
- `forecast-methods-spec.md`, `forecast-lab/`: forecast methods and the offline lab report.
- `erp-examples/`: synthetic example exports from eight ERPs (used by import tests).
- `AI-GUIDE.md`, `architecture/`, `ROADMAP-CONNECT.md`: AI task recipes and **proposed** connector/automation/MCP designs (not implemented).
- `history/`: phase notes with before/after tables, QA logs, old plans and screenshots. Historical; may reference ignored local `.scratch/` evidence.
- `img/`: README screenshots. `index.html`: static GitHub Pages entry.
- Harness files (`harness.html`, `harness-entry.js`, `sdk-shim.js`, `capture-*.cjs`, `stress-fixtures.mjs`): local browser checks of the Desktop plugin against an SDK shim; they prove the harness, not the real app. The two maintained legacy captures and offline run recipe are documented in [capture maintenance](history/changes/capture-maintenance.md).
- Baselines (`*-baseline.json`): byte pins used by tests.
Human check: `python3 scripts/check_docs.py` (relative links resolve, JSON parses).

Import-meaning behavior and proof boundaries: [input meaning](history/changes/input-meaning.md).
