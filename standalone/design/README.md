Lifecycle: living

# Two review candidates — not a replacement

For a store operator deciding what to buy, make the stock trajectory the evidence and the order quantity the action. No marketing paragraphs, boxed panels, or new forecast rules.

- **A / Hero chart:** one selected product on a large chart; order-today and later-order selectors beside it on desktop, order-today selectors above it on phone.
- **B / Chart rows:** stock trajectories aligned across every item; open a row for its large, keyboard/touch-explorable chart. Urgent items first.

## Build and open

From the repository root:

```sh
mkdir -p .scratch
export TMPDIR=$PWD/.scratch
python3 standalone/build.py --template option-a
python3 standalone/build.py --template option-b
open standalone/design/option-a.html
open standalone/design/option-b.html
```

Both outputs are dependency-free single files; opening either over `file://` works offline. `template.html`, `styles.css`, `chart.js` and `app.js` here are authoring sources, embedded by the builder. The accepted `../stock-runway.html` and `../template.html` are untouched. The baseline remains the builder's default.

## System and data contract

One system font, 16px base, tabular numbers. Neutral open layouts, hairlines, 6px flat buttons. Blue action/forecast: `#3f5687` light / `#7e93bf` dark. Teal dots mean fine, amber urgency, red out. All statuses have words; color is redundant. Text/background and chart-stroke contrast are checked in the browser. No gradients or third-party assets.

System theme at first use; a remembered light/dark override is stored under `stock-runway.standalone.theme.v1`. Only settings and this theme persist, never CSV contents. Closed native disclosures hold file loading, settings, planning context and standard inventory terms.

Every output embeds the exact Desktop pure core, plus the baseline's helper block verbatim (including purchase-order membership/format). The renderer uses the existing evaluated projection, inventoryHistory, stockPath, historyStats, niceStep, tickLabel and stockCell. It changes only chart coordinates and presentation, never demand, dates, buckets or order quantities. The full chart faithfully ports Desktop Chart: past demand bars, outlined forecast demand bars, side-by-side deliveries, stock line and month-end dots, dashed Now divider, shaded forecast region, red run-out dot/label and dashed out-of-stock segments. Its axis unit, peak/ticks, timeline, point construction and geometry match Desktop. Past stock is reconstructed only when the core can reconstruct it; otherwise the stock history is absent (past demand bars remain). The tiny B-row sparkline omits its past segment when stock history is unavailable, and labels that absence in its accessible description. Incomplete history remains warned. The last historical month and rounded forecast start share the snapshot boundary. Forecasts include listed receipts but exclude a new suggested order; zero is the stock floor, not an invented negative shelf count.

The full chart's run-out marker and label come from stockPath exactly as in Desktop. B's mini-chart adds the order-by marker from orderGuidance; the full chart keeps Desktop geometry without added markers or thresholds. The seasonal and rounded-start explanations retain Desktop wording inside a closed About this chart disclosure. Node tests render the actual React Chart using the existing Desktop test shims and compare every sample item's bar values/coordinates, inventory polyline and dots, forecast region, Now divider, out-of-stock segments, axis unit and run-out marker against the vanilla SVG at phone and desktop widths. Hover/tap tooltips show month, demand, deliveries and stock. These may differ from simple date subtraction when receipts or calendar boundaries matter. Exact conditional core order sentences remain in the expanded view. 'Later' quantities are future suggestions, not current stock. A supply gap with zero purchase quantity stays visible as 'Check delivery' and never enters copied orders.

Charts support pointer hover, tap, arrow keys and Escape. Entry draw is 260ms ease-out; crosshair is 70ms; reduced-motion disables both. Tap targets are at least 44px. Browser proof captures 390×844 and 1440×900 in both themes, plus tooltip states, checks zero network/console errors, contrast, no overflow, label containment, selection/expansion, keyboard/touch pointers, settings, copy fallback, denied storage and all eight checked-in ERP fixture uploads.

```sh
# Uses an already available Playwright and Chromium; no installation.
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node standalone/capture.cjs --design
```

Screenshots and browser receipts stay under `.scratch/design/`. This is local Chromium proof, not a deployed service, a live ERP test, or supplier order.
