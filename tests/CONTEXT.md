Lifecycle: living

# Test contract

Inputs: `../engine.py`, `../sources.py`, `../tools.py`, `../desktop/plugin.js`, `../data/sample.json`.
Job: independent oracle, fake Odoo transport, CSV and tool checks; no live services.
Outputs: pytest and Node test results; save local evidence in ignored `../.scratch/`.
Human check: test assertions retain packet acceptance; use repository `.scratch/` for temp files.

Standalone checks: `test_standalone_build.py` verifies byte-identical regeneration and the exact embedded JS core with no network dependencies. `standalone.test.mjs` compares sample/all ERP CSV guidance, buckets and the actual Desktop order-list expression plus synthetic safety/rounding and purchase-order text cases. `../standalone/capture.cjs` exercises the file:// UI with existing local Playwright/Chrome; see `../standalone/CONTEXT.md`.

Fixture contract: `fixtures/CONTEXT.md` routes immutable original-sample and synthetic stress inputs. `test_a9_stress.py` covers limits and containment; actual React recovery assertions live in `../docs/capture-inventory.cjs`.

A3 coverage extends `test_standalone_build.py`, `standalone.test.mjs` and the actual Desktop Chart parity matrix in `desktop.test.mjs`. The A3 application DOM adapter is logic-only; it does not establish browser interactions, layout or performance. Real browser checks are in `../standalone/capture-a3.cjs`.

MCP: `test_mcp.py` checks `../mcp_server.py` with synthetic CSV/bundle snapshots, CLI equality, modern/legacy protocol, bounded hostile frames and socket denial. Focused check: `python3 -B -m pytest -q tests/test_mcp.py` from the root; local evidence in `../.scratch/mcp-builder/`. Real clients and broad regression are separate controller gates.
