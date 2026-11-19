Lifecycle: living

# Package contract

Inputs: `plugin.yaml`, `engine.py`, `sources.py`, `csv_import.py`, `smart_import.py`, `forecast_methods.py`, `tools.py`, `__init__.py`.
Job: a read-only reorder planner (Python engine/CLI, Hermes Desktop plugin, offline HTML page) with one set of maths.
Outputs: package code; local verification evidence in ignored `.scratch/`.
Human check: run the checks in [CONTRIBUTING.md](CONTRIBUTING.md); forecasts stay estimates, nothing places orders.
Folder routes: `desktop/CONTEXT.md`, `standalone/CONTEXT.md`, `tests/CONTEXT.md`, `docs/CONTEXT.md`, `data/CONTEXT.md`, `scripts/CONTEXT.md`, `forecast_lab/CONTEXT.md`, `data_contract/CONTEXT.md`.
Roadmap designs (not implemented): `docs/architecture/CONTEXT.md`, `docs/ROADMAP-CONNECT.md`.
Development history (phase notes, QA logs, old plans): `docs/history/`. Design variants: [standalone/design/CONTEXT.md](standalone/design/CONTEXT.md).
