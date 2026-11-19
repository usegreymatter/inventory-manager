Lifecycle: living

# Validator contract

Inputs: a Contract 1.0 bundle directory (`../docs/data/CONTRACT.md`).
Job: standard-library validation of files, headers, keys, units, dates and cross-file rules; `--today` defaults to snapshot + 1 day, never the wall clock.
Output: JSON report on stdout (`valid`, errors, warnings). No network, no writes.
Human check: `python3 data_contract/validate.py samples/synthetic`; tests in `../tests/test_data_contract.py` and `../tests/test_data_contract_docs.py`.
