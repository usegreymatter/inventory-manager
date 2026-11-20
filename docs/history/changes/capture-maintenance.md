Lifecycle: living

# Offline Desktop capture checks

The SDK-shim Desktop harness is still active; neither capture is retired or
excluded from checks. These scripts prove only a disposable offline harness,
not an installed Hermes Desktop session. All inputs are synthetic. They do not
read live inventory, contact an ERP, install packages, or place an order.

## Existing local tools only

Run from the repository root, supplying paths to already-installed tools:

```sh
mkdir -p .scratch
export TMPDIR="$PWD/.scratch" PYTHON=/usr/bin/python3
export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js
export CHROMIUM_EXECUTABLE=/path/to/chromium
/path/to/node_modules/esbuild/bin/esbuild docs/harness-entry.js --bundle --format=esm \
  '--define:process.env.NODE_ENV="production"' \
  --alias:@hermes/plugin-sdk=./docs/sdk-shim.js \
  --alias:react=/path/to/node_modules/react/index.js \
  --alias:react-dom/client=/path/to/node_modules/react-dom/client.js \
  --alias:react/jsx-runtime=/path/to/node_modules/react/jsx-runtime.js \
  --outfile=.scratch/harness.bundle.js
node docs/capture-harness.cjs > .scratch/capture-harness.json
node docs/capture-inventory.cjs > .scratch/capture-inventory.json
/usr/bin/python3 scripts/check_docs.py
git diff --check
```

The production React bundle is intentional. A development React bundle currently
emits existing `Page` child-key warnings, which the inventory capture correctly
rejects. This is not a claim that development-console warnings were fixed.
No shipped/generated standalone output needs rebuilding for capture-only edits.

## Maintained contracts

Both captures freeze the decision date to **11 Nov 2026**, abort HTTP(S) page
requests and use fresh browser contexts. New evidence stays in ignored
`.scratch/`; the harness capture no longer overwrites historical screenshots.

- `capture-harness.cjs`: four width/theme combinations (360/1440, light/dark),
  chart/product selection, current **My file (CSV)** control, real canonical CSV
  upload, exact order/date answer, rejected out-of-range CSV retaining the good
  product, and Settings/default-horizon persistence. A bare `bad` file now opens
  smart column review, so it is not an honest rejection fixture.
- `capture-inventory.cjs`: six width/theme inventory/chart/disclosure/search
  combinations (360/390/1440, light/dark), the five-product sample with exactly
  two current order rows, actual React recovery and stale-upload cancellation,
  and ten timeline configurations with sample/fractional/maximum fixtures
  (including 200%-equivalent narrow viewport reflow).
- Its six synthetic order matrices check structured quantity/date metrics,
  exclusive filter counts, search independent of the daily list, keyboard
  settings drafts/validation, persistence/reset, supplier fallback removal,
  receipt gaps and earliest dates, 61-row **Show all / Show top 10**, and
  horizon-independent long-cover guidance.

The daily panel is **Order today**, not the exclusive **Order now** filter.
It includes upcoming orders and zero-purchase attention rows; the focused
11-product fixture has seven daily rows but five `Order now` filter rows.
The former panel/filter equality, search-filtered daily list, prose-only order
buttons, `Next:` empty-state prose and internally scrolling 61-row list are
obsolete contracts, not current product expectations. The current checks use
`data-order-today`, structured order metrics, current filter labels and explicit
show-all controls instead. The older numerical policy examples in
[VALIDATION-LOG](../VALIDATION-LOG.md) remain historical, not active capture pins.

Fractional checks retain **0.7 l** snapshot stock, **0.04 l/month** demand and
**0.24 l** six-month forecast shortage. Current purchase guidance is one unit
at 0.7 stock, two units at near-zero/zero stock. The delayed-upload probe wraps
`File.arrayBuffer`, the current reader; its former `File.text` wrapper no longer
intercepted a read. Per-item fault injection throws within sales validation,
not from a property getter that also throws while constructing the held item.
