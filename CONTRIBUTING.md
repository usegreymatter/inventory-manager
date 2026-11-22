# Contributing

Thanks for helping. Small, focused pull requests with a test are easiest to review.

## Ground rules

- **Python/JS parity.** The engine lives in `engine.py` and is mirrored in `desktop/plugin.js` (and `forecast_methods.py` ↔ `forecast_methods.js`). Change both, add a parity test, and rebuild the offline page.
- **Don't edit generated files.** `standalone/inventory-manager.html`, `standalone/inventory-manager-demo-1000.html` and `standalone/design/option-*.html` are built by `standalone/build.py`.
- **No real data.** Fixtures must be synthetic. Never commit customer data, credentials, ERP URLs or personal details.
- **Forecast outputs are pinned.** If `scripts/golden_diff.py` changes, explain why in the PR.
- **Nothing sends or writes.** Features that place orders, email suppliers or write to an ERP are roadmap items behind explicit owner approval ([docs/ROADMAP-CONNECT.md](docs/ROADMAP-CONNECT.md)).
- Python: standard library only. JS: no runtime dependencies in the shipped page.

## Checks

Run from the repository root (Python 3, Node 18+). The shipped Python runtime
uses only the standard library. The **full Python test suite** needs pytest as a
development-only dependency; install it in a local environment, not the runtime:

```sh
python3 -m venv .scratch/venv
. .scratch/venv/bin/activate
python3 -m pip install pytest
```

```sh
node --test tests/*.mjs
python3 -m pytest -q
python3 scripts/golden_diff.py
python3 scripts/verify_import_examples.py
python3 scripts/check_docs.py
```

For a **partial, no-install quick check** only:

```sh
(cd tests && PYTHONPATH=.. python3 -m unittest test_forecast_methods)
```

Unittest does not collect pytest function tests. Broad unittest discovery also
imports pytest-dependent modules, so it is neither a no-install full suite nor
a substitute for `python3 -m pytest`.

After changing `desktop/plugin.js` or anything in `standalone/`, rebuild:

```sh
for t in baseline option-a option-a2 option-a3 option-b option-gm-a option-gm-b option-gm-c; do python3 standalone/build.py --template $t; done
python3 standalone/build.py
python3 standalone/build.py --data data/demo-1000.json --out standalone/inventory-manager-demo-1000.html
cmp standalone/inventory-manager.html standalone/design/option-gm-b.html
```

Optional browser checks use an existing Playwright install: `PLAYWRIGHT_MODULE=/path/to/playwright/index.js CHROMIUM_EXECUTABLE=/path/to/chrome node docs/capture-readme.cjs` (regenerates `docs/img/`). Put local evidence in `.scratch/` (ignored).

## Where things are

[AGENTS.md](AGENTS.md) and [CONTEXT.md](CONTEXT.md) map the repository; each folder has a `CONTEXT.md`.
