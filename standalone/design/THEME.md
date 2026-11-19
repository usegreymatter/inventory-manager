# Shipped theme

`theme-gm-b.css` owns the single light palette and its screen-only dark overrides.
Legacy shared styles consume these custom properties with fallback values for the
other design variants. No filtering/inversion is applied to the app or exports.

- Surfaces: `--bg` (canvas), `--surface` (raised/input), `--subtle` (hover/selection).
- Type: `--ink`, `--muted`; hairlines use `--line`, interactive edges `--rule`.
- Actions: `--accent` and paired `--on-accent` (not the canvas colour).
- Meaning: `--red` / `--order-ink`, `--amber`, `--fine`; meaning is also labelled.
- Charts: the same palette plus `--demand`, `--demand-edge`, `--cloud-50`,
  `--cloud-90`, `--stock-area`, `--forecast-shade`. SVG references remain live.
- Overlays: `--backdrop`, `--shadow`, `--warning-surface`.

The synchronous head script resolves `stock-runway.theme` before stylesheet
parsing. System is the default, follows live media-query changes, and manual
choices survive reloads. Denied storage falls back to a usable in-memory choice.
The header menu exposes the labelled Theme select. Native controls and browser
chrome receive matching colour-scheme and theme-color metadata.

Dark overrides are screen-only: print uses the light palette, with a white canvas
and the existing weekly-summary print layout. Excel content is unchanged.

`node standalone/capture-theme.cjs` checks both widths, each preference, live
System changes, reload persistence, early resolution, denied storage, contrast,
white-background leaks (no exceptions), overlays, chart/cloud/tooltip and print.
Evidence and screenshots go to `.scratch/pp`.
