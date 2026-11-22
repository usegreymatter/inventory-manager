# Changelog

## Unreleased

- **v1.2 — Import safety:** blank lot quantities remain unknown without duplicating stock; ambiguous transaction dates and lot-total mismatches require input review. Excel numeric expiry respects the 1904 date system, quoted CR survives Python CSV roundtrips, sale prices cannot change inventory-number inference, and workbook bad-lot rows are set aside individually. Forecast/purchase maths is unchanged.

### Inventory Manager v1.2.0 candidate

- **Fixed — profit shelf cap:** the opt-in suggestion and alternatives now receive the computed shelf ceiling. MOQ/pack conflicts omit the suggestion with an explicit standard-amount fallback; ordinary quantities are unchanged.
- **Fixed — preset cover floor:** each product covers only its own review interval via a product `months_of_cover` override when needed. Delivery time is not added twice, slow suppliers cannot inflate other products, and previews count the actual changed quantities.

[Candidate release notes and validation limits](docs/release-notes/v1.2.0.md). Publication and downloads are separate owner actions.

- **Industry buttons are setup guides**, not quantity optimizers: check ordering rhythm and verified per-product shelf-life facts. They preserve the actual ordering interval rather than silently selecting one, and do not change amounts on their own from General defaults. Confirmed ordinary-setting changes can affect amounts; preview shows the impact, with Cancel and Undo. [Exact settings and evidence](docs/PRESETS.md).
- **Pharmacy's automatic 99% service target is removed** after the independent synthetic gate failed. The chosen service target is preserved. With that change removed, the guides match General quantities at 7- and 30-day ordering cadence; this is synthetic no-op evidence, not superiority or a service guarantee.
- **Product settings documentation** now lists all supported override fields, including profit suggestions, sale price, shelf-life facts and salvage percentage. Explicit per-product no-shelf-life values disable an inherited cap; blank/inherit and Reset remain distinct.

- Opt-in shelf-life ceilings apply after MOQ/pack rounding, subtract usable stock unsold at arrival, keep safety stock within the cap, and explain zero/MOQ conflicts. Global, product/file settings and CLI flags are supported.
- Lot expiry imports (CSV/Excel/ERP aliases) and FEFO commercial **Get rid of by** prompts identify expiry-risk quantities and clearance dates; ambiguous dates retain input-review acknowledgement, month-only dates are flagged, and lot totals are checked. Forecast-unsellable lots explicitly reduce usable planning stock without changing physical chart stock.
- Default-off quantities/import outputs remain unchanged; see [shelf-life arithmetic and limitations](docs/SHELF-LIFE.md).
- **Display-only cost & profit view:** optional `sale_price` import aliases; money tied up, incoming/order value, unit/gross margin, cost-weighted weeks of cover, modelled lost-profit estimate and an expiry-value-at-risk hook. Custom columns, totals and product detail exclude unknown facts rather than guessing. CLI `--json`/`--explain` expose the same metrics. The existing deterministic risk sampler optionally reports mean unmet units without changing its paths/probabilities; purchase quantities and all order/forecast engine bytes stay unchanged. [Formulas, limitations and worked example](docs/COSTS.md).

- **v1.2 — Import safety:** set-aside/rejected-row CSV exports reuse the normal order export's formula-cell hardening, including markers after leading whitespace, LF or BOM. Imported values remain unchanged in memory.
- **v1.2 — Known limits:** the opt-in most profitable amount shows a reliability warning for an effective order rhythm under 30 days or positive incoming stock. The warning changes no quantity or maths. [Candidate notes](docs/release-notes/v1.2.0.md#known-limits).

## v1.1.0 (2026-11-20)

[Release notes and offline download instructions](docs/release-notes/v1.1.0.md).

- **Final input-warning polish:** the worklist keeps a visible warning summary with affected-product count and session-only dismissal; row text markers and product/detail advice retain item warnings. Joined no-stock allocations no longer cause false reserved-missing warnings. Only conflicting lead times/units gate metadata review; other metadata differences become one compact informational summary (up to ten SKU examples). Filled stock is described accurately and single-sheet missing-reserved notices are de-duplicated. All forecast/order formulas remain unchanged.

- **Round-3 re-check:** joined ledger incoming retains known provenance; CSV contributor metadata conflicts require the same acknowledgement as workbooks. Summed stock sheets now require named-sheet confirmation, and exact identical blank-location rows require duplicate-export acknowledgement. Affected products retain those warnings plus named missing-reserved-sheet warnings. Numeric SKU warning lists use matching Python/JS ordering. Quantities and forecast/order formulas are unchanged.

- **Simple view** is the first-device default, with six decision columns and Low/Medium/High risk chips. **Show detail** reveals the chart, settings and expanded columns without changing the forecast.
- **Why this amount** explains the purchase ledger with human-readable decimal rounding and an explicit `[display rounding]` term when needed; the exact ledger remains in JSON. CLI `--explain` adds the sentence to CSV; `--json` includes the sentence and exact ledger.
- **Input-meaning check** reviews available versus reserved stock, unknown incoming and matching units before orders. Missing data, future dates and a latest month still in progress can require **Show orders anyway**; acknowledgement is not a data repair.
- **Import guard** retains current products until acceptance, reopens review when warnings/exclusions/defaults change, and never remembers risky-file acknowledgement. Existing invalid-row and file-size checks remain in force; frozen engine/import-math guards protect the unchanged calculation policy.
- **CLI review** now runs for every single CSV. Added `--show-orders-anyway`, `--stock-includes-reserved` and `--incoming-not-in-file`; input review needing acknowledgement exits **2** before export, as do argument/file/output errors. Interpretation flags do not apply to canonical bundles; reserved subtraction requires non-strict preflight. `--incoming-not-in-file` ignores undated incoming while retaining unknown status and separately supplied confirmed receipts.
- **Safari-related fixes** cover sticky grouped rows, product navigation after marking an order, device-local order provenance, short-height controls and workbook downloads. Local WebKit/Chromium regression coverage is not real Safari/iPhone hardware verification.
- **Font notices corrected:** all HTML retains MIT and third-party notices; only `option-gm-c` embeds Poppins/Tajawal and the full OFL text. Arctic and its demos use system fonts.
- **Review-round fixes** preserve joined workbook incoming quantities, distinguish policy adjustments from MOQ/pack rounding, reconcile visible decimal explanations, subtract reserved stock exactly, warn on oversold/already-available stock, retain remaining-order explanations and label beyond-view advice without changing planner arithmetic.
- **Blank-sales review:** leading blank months before the first sale mean not yet launched; all-blank, internal and trailing blanks still count as missing, with acknowledgement above the 20% missing-row threshold. Warehouse reserved quantities are netted per SKU before flooring; partial incoming preserves known quantities with an unknown-supply warning.

- **Review round 3 — joined input facts:** review and planning consume the same adjusted canonical workbook facts, including joined incoming, reserved stock and distinct stock/sales units. Original source-row completeness, unit/date evidence and missing-mapping/history gates are retained; canonical aggregation is not a substitute for those checks.
- **Warehouse contributors:** repeated blank Warehouse/Location cells aggregate as **Unspecified** with a duplicate-export warning; duplicates without a location column or at the same named location are still rejected after the first usable row. Compatible non-ledger warehouse sheets sum stock, reserved, on-order and monthly sales with named-sheet provenance; ledger snapshots are never added as another warehouse. Conflicting lead times/units or incompatible quantity schemas keep the first/base value and require acknowledgement; other metadata conflicts retain the first value with a compact informational warning. CSV `accepted_rows` identifies actual contributing parsed records, including correct identities around multiline cells and blank records.
- **New-product disclosure:** affected products show **New product: N months before first sale ignored** for leading blank history. This is informational and excludes those cells only from missing-data review, not from the numeric series or forecast window. No forecast/order formula changes. [Round-three scope, observed TDD and completed local verification](docs/history/changes/review-round-3.md).
- **Canonical warning order:** one shared priority contract drives Python, desktop and every offline output. Affected-product warnings and acknowledgement reasons are unique and consistently ordered; the unmodified round-three parity kit passes 562 cases / 9,063 assertions.

## v1.0.0 (2026-11)

First public release.

- **Offline page** (`standalone/stock-runway.html`): single-file worklist of what to order, how much and by when; product page with sales chart and before/after order preview; browse by status, category and supplier; light and dark themes; English and Arabic text support.
- **Smart Excel/CSV import** with an import check (matched, ignored and set-aside rows) before anything is replaced; recognises common ERP export headers.
- **Order maths:** run-out date, order-by date, order quantity with months of cover, safety stock (added to orders by default), MOQ and pack rounding, optional EOQ, stock-out adjustment (off by default). Unknown values hold the item instead of becoming zero.
- **Forecast methods:** Current (default) and Auto plus named methods (experimental, opt-in).
- **Local order lists** kept in the browser; copy or export as CSV. Nothing is sent.
- **Settings** import/export with validation.
- **Python CLI** (standard library) with the same engine; canonical CSV bundle contract v1.0; optional read-only Odoo source.
- **Hermes Desktop plugin** using the same engine (JS mirror).
- **Roadmap designs** (not implemented): connectors, approval-gated automation, learning loop, MCP server.

Development history before v1.0.0 is summarised in [docs/history/](docs/history/).