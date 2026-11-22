Lifecycle: living

# Standalone offline page contract

Inputs: `../desktop/plugin.js` after the React/SDK import block and before `const pageStyle`; `template.html`; sample and synthetic ERP CSV fixtures only.
Job: `python3 standalone/build.py` embeds the exact, unmodified JavaScript core in one offline HTML module. No independent maths, dependencies, network, Hermes installation or live ERP access. Fail closed if extraction anchors or SDK dependencies drift. Edit the template, never the generated file.
Outputs: committed `inventory-manager.html` and `inventory-manager-demo-1000.html`; old `stock-runway*.html` paths are redirects. Eight review variants remain in `design/`; Python drift/dependency tests and Node plugin-equivalence/PO/series tests; ignored visual and browser proof in `../.scratch/standalone/` and `../.scratch/design/`. The owner-selected Arctic gm-b is the shipped page, and the original baseline is preserved as `design/baseline.html`.
Human check: regenerate byte-identically; run old and new suites; review 390/1440 light/dark file:// screenshots and copied sample purchase-order text. Browser proof is local only, not a GitHub Pages deployment or a real supplier order.

Design thesis: for a store operator deciding what to buy, put the plain order sentence first in a quiet, system-font list; demote uploads, settings, other items and terminology. Use neutral open rows, one green copy action, amber urgency, native disclosures, visible labels and 44px controls. Respect system light/dark. Show sample/snapshot provenance and uncertainty, never imply a sent order.

Arctic settings alone persist under dataset-keyed `stock-runway.standalone.order-settings.v2:<length>:<fingerprint>` keys; the sample can migrate existing `stock-runway.standalone.order-settings.v1` settings. Other named variants retain the v1 key. Selected CSV contents never persist. Clipboard permission failures expose a selected, read-only textarea. Text from files is inserted only with textContent. Date, snapshot, settings normalization, guidance and buckets mirror Desktop Page; zero-quantity attention items stay visible but do not enter the purchase list.

A3 additive route: [design/CONTEXT.md](design/CONTEXT.md) and [design/A3.md](design/A3.md). `build.py --template option-a3` generates only `design/option-a3.html`; `capture-a3.cjs` writes local evidence under `../.scratch/design/`. A3 intentionally defaults to white in all system themes and has no supply bars.
