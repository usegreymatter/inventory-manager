Lifecycle: living

# UI polish and accessibility stress results

## Outcome and scope

Current-source Chromium stress run: **316 assertions passed**, exit 0, zero page errors and zero HTTP(S) requests. The smart-import fixture regression run passed **1,265 assertions across 30 runs** (15 synthetic fixtures × 1440/390 widths). Focused Node tests passed **57/57**, exit 0.

This is **local source proof**, not live, hosted, real supplier, or ERP proof. `standalone/capture-stress-ui.cjs` builds only `.scratch/pp/stress-ui-source.html`, then adds read-only inspection hooks in a separate scratch probe. No tracked HTML was rebuilt. No forecast/order mathematics, golden-diff script, examples or live inventory data were changed by this workstream.

Source-build SHA-256 for the recorded 316-check run:
`7179de72fbd5415e356c2f1fdc3a876974d026d869bb7b21de3e5bc0f9ff632e`.

## Repairs

| Finding | Repair | Regression evidence |
|---|---|---|
| Review content ended too close to the pinned footer; inherited sheet geometry also crowded viewport edges. | Centered, inset dialog; independently scrolling, border-box body; 48px desktop / 40px phone bottom padding; wrapping footer. Removed outer reserved scrollbar gutter. | At scroll end, last report content clears footer by 48.44px at 1440, 39.69px at 390, 39.52px at 320. No remaining scroll distance. All three footer buttons remain hit-testable and at least 44px high. |
| Vague “Change” action and repetitive exact-header explanations. | “Edit mappings”; high-confidence reasons retained in hover title and accessible label, while medium/low reasons remain inline. | Label, quiet-high and visible-low checks at 1440/390/320. |
| Phone native select clipped the selected mapping. | Full selected label below narrow selects on phones, hover title on all sizes; stronger control border. | DOM checks at 390/320 plus inspected mobile screenshot: full “Stock on order” remains readable. |
| Editing a mapping rebuilt its select and lost keyboard focus. | Restore focused select by sheet/index (or stable ID), preserve scroll; Edit mappings moves focus to the first select. | Keyboard mapping edits retain focus at all three widths. |
| Native dialog Tab boundary reached BODY/browser chrome. | Arctic native-dialog Tab/Shift+Tab boundary loop using visible, enabled controls. | Repeated containment checks for smart import, nested product settings, email and weekly summary; full product-page trap also exercised. |
| Enter on View/disclosure summaries was intercepted by worklist row navigation. | Exclude summary/link controls from worklist navigation shortcuts. | Keyboard opens Main menu, file panel and View → Weekly summary without opening an unrelated product. |
| Marking ordered could disable/remove the email opener; Escape then tried to focus a disabled fallback. | Return to a connected, enabled opener, otherwise an enabled product action / All products control. | After mark → Excel → Escape, focus remains on an enabled product control; second Escape returns to worklist. |
| Valid JSON with `customOrder: 17` / null saved views crashed startup. | Allow-list saved preference fields and array types; filter malformed saved views without writing over stored bytes. | Browser malformed-shape mode plus five source-level Node tests. |
| Failed local-order saves only updated the background worklist message behind the email modal. | Echo the actual storage error into the active email dialog's `role=status`. | Denied, quota-full and corrupt storage: zero persisted orders, with matching error announced inside the active dialog. |

Shared review styling/rendering lives in `standalone/design/smart-import.css` and `.js`, rather than the `*-gm-b` adapter; therefore the focused shared changes are there. Arctic-only focus and worklist changes are in `import-gm-b.js` and `worklist-gm-b.js`.

## What actually ran

### Keyboard and focus

Desktop journey used Tab/Enter to open Main menu → file panel → file chooser, confirmed the import, opened product → nested settings → email, copied the draft, marked ordered, downloaded Excel, escaped to the enabled product control, then back to worklist and opened weekly summary. Playwright supplied the synthetic file through the chooser event; no OS file picker automation or real email sending occurred.

Tab and Shift+Tab were exercised repeatedly inside the named modal surfaces. Settings inputs were checked for labels. Escape preserved the old dataset when cancelling import. A successful mark was read back from application state, and failed storage writes were verified not to create records.

### Data and environment

- Synthetic five-product import mixes long realistic names, short “Jo”, Arabic text, and literal hostile HTML in product/supplier names.
- Hostile `<img ... onerror>` / `<svg onload>` names remained text on import preview, worklist, full product page, email draft, summary and print DOM. No attacker element/event handler was created or executed.
- Import layout, footer reachability and mapping edits: 1440×900, 390×844, 320×844. This is not a claim of every product-page interaction at every width.
- Reflow proxy for 200% desktop browser zoom: 720×450 CSS viewport. Dialog remains in bounds; all expanded content scrolls to the end with 48.44px footer clearance.
- **CSS body `zoom: 2` is not equivalent to browser zoom:** it doubled the `dvh`-sized modal and produced top −402 / bottom 1302 in a 900px viewport. This observation is recorded rather than hidden or counted as a pass. No app feature sets body zoom. Actual browser-toolbar 200% zoom remains unverified.
- Reduced-motion media preference was active; no running Web Animations were observed at the checked endpoint.
- localStorage getter denied, writes throwing `QuotaExceededError`, invalid JSON across app keys, and malformed worklist preference shapes all preserved startup/import. Denied/corrupt orders fail closed; quota-full writes report no changes. Malformed non-order view preferences fall back safely and still allow a normal saved order.

### Clock and exports

Playwright fixed the UTC clock and dispatched the normal focus refresh across Nov→Dec, Dec→Jan, Feb 28→29 and leap-day→March boundaries. Seven decision dates updated correctly. Separate fresh imports exercised the real keyboard mark-ordered flow with 14-day lead times:

| Ordered on | Expected on |
|---|---|
| 2026-12-31 | 2027-01-14 |
| 2028-02-15 | 2028-02-29 |
| 2028-02-29 | 2028-03-14 |
| 2027-02-15 | 2027-03-01 |

The downloaded `.scratch/pp/stress-ui-email.xlsx` was independently opened with Python stdlib ZIP/XML parsing: CRC verified, five XML entries parsed, sheets `Purchase order` / `All products`, row counts **1 / 5**, zero formula elements.

Print media showed only the weekly summary with controls hidden and literal hostile names intact; a real `.scratch/pp/stress-ui-summary.pdf` was produced. Physical printing and a human PDF pagination/content review were not performed.

### Manual accessibility checks, not axe

A recursive stdlib directory-name search was limited to `/path/to/node_modules` (5,325 directories at search time); **no `axe-core` directory was present**. Nothing was installed or searched elsewhere.

Manual/DOM checks covered named dialogs, native modality, focus containment, keyboard operations, settings labels, live status messages, text+color confidence states and 44px import actions. Measured text contrast ratios against the review background: muted explanatory text **5.73:1**, confidence text **17.79:1**, primary button **7.26:1**. These are scoped checks, not full WCAG certification or screen-reader proof.

## Reproduction and evidence

From repository root:

```sh
export TMPDIR=$PWD/.scratch
export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.js
export CHROMIUM_EXECUTABLE=/path/to/chrome
node standalone/capture-stress-ui.cjs
node standalone/capture-smart-import.cjs --source-ui
node --test tests/ui-stress.test.mjs tests/arctic.test.mjs tests/local-orders.test.mjs tests/smart-import.test.mjs tests/weekly-summary.test.mjs
```

The second command splices current shared review JS/CSS into the existing built page in scratch. Its 30-fixture result verifies that review surface; it is not a current-source build of every Arctic adapter. The first command is the current-source full integration probe.

Evidence:
- `.scratch/pp/stress-ui-report.json` — 316 passed assertions, source-build hash, observed CSS zoom limitation.
- `.scratch/pp/smart-import-report.json` — 1,265 passed assertions / 30 fixture runs.
- `.scratch/pp/stress-ui-node.log` — 57/57 focused Node tests.
- `.scratch/pp/smart-import-polished-1440.png`
- `.scratch/pp/smart-import-polished-390.png`
- `.scratch/pp/stress-ui-email.xlsx`
- `.scratch/pp/stress-ui-summary.pdf`

Both polished screenshots were inspected with `vision_analyze`. Final desktop review found no visible clipping, footer overlap or stray blue edge. Final phone review confirmed full selected-mapping text, visible buttons and intact viewport margins. Still images do not prove scroll reachability; the geometry/hit-test assertions provide that separate evidence.

## Limitations / remaining gates

No network/install/push/live access was used. Other workers shared this worktree and committed separately; their parser/scale results are not included in this workstream's totals. The scratch build includes the source present at execution time, not a detached baseline.

Not checked: actual browser-toolbar 200% zoom; Safari/Firefox/real phone/screen reader; full WCAG audit; shared review styling in non-Arctic themes; native mail client or any sent order; physical printing or human PDF review; full repository Python/Node suite and tracked-generated-artifact drift after these source changes; hosted/live/ERP behavior. Parent integration must regenerate tracked deliverables when authorized and run its full release gates.
