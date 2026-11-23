Lifecycle: living

# Scripts contract

Inputs: repo sources and synthetic data only.
Job: offline tools: `golden_diff.py` (reviewed golden numbers vs current JS/Python/CLI), `verify_import_examples.py` (ERP example imports), `make_samples.py` / `synth_demand.py` / `make_demo_catalog.py` (synthetic data), `bench_scale.*` and `benchmark_*` (measurements, not CI limits), `sync_smart_import.py` (embeds `../desktop/smart-import.js` and shared import vocabulary in `../desktop/plugin.js`), `sync_cleaning_lab.py` (embeds the JS lab into the Desktop/standalone core).
Outputs: stdout or files under ignored `../.scratch/` unless a script says otherwise.
Human check: no script reads live data, credentials or the network.
