Lifecycle: living

# Desktop contract

Inputs: `plugin.js`, `smart-import.js`, `../smart-import-vocabulary.json`, `../scripts/sync_smart_import.py`, `../data/sample.json`, `../docs/sdk-shim.js`, `../docs/harness-entry.js`.
Job: SDK-only sample/CSV inventory page and settings; no network or credentials.
Output: `plugin.js` (also the JS engine embedded by `../standalone/build.py`); local harness evidence belongs in ignored `../.scratch/`.
Human check: Node oracle/sample parity plus `../docs/capture-inventory.cjs` 360/390/1440 light/dark harness screenshots. The SDK shim proves only the local harness; real Desktop proof is separate.

Workbook identity helpers and the Unicode casefold table live in `smart-import.js`; regenerate the embedded plugin span with `../scripts/sync_smart_import.py` before rebuilding standalone pages. CSV and workbook name-generated identities share these helpers.
