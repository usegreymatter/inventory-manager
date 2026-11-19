Lifecycle: living

# Data docs contract

Inputs: `../../data_contract/validate.py`, `../../bundle_import.py`, `../../samples/synthetic/`.
Job: the canonical bundle contract (`CONTRACT.md`), order-building ledger and proposal spec (`ORDER-BUILDING-SPEC.md`), Arabic glossary (`AR-GLOSSARY.md`, draft).
Outputs: docs only. `../../tests/test_data_contract_docs.py` keeps `CONTRACT.md` and the validator in step.
Human check: `python3 data_contract/validate.py samples/synthetic` reports `"valid": true`; connector schemas in `../architecture/schema/` must describe the same facts.
