# Changelog

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
