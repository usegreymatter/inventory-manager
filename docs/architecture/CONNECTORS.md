Lifecycle: proposed (design only, nothing here is implemented yet)

# Connectors: getting data in from any ERP

## In plain words

A connector copies the facts Inventory Manager needs out of a business system: products, stock per warehouse, past sales, open purchase orders, suppliers, costs and lead times. It writes them into the **same local CSV bundle** the app already reads (`docs/data/CONTRACT.md`, version 1.0). The forecast engine never talks to an ERP. It only reads that bundle.

Defaults that never change without the owner's say-so:

- **Read-only.** A connector can't change anything in the ERP. Writing a draft purchase order back is a separate, optional ability. It is off by default and controlled by [AUTOMATION.md](AUTOMATION.md).
- **Dry run first.** The first run of any sync builds the new bundle in a staging folder and shows what changed. Nothing replaces your current data until you apply it.
- **Unknown is not zero.** If the ERP can't provide something (for example Shopify has no supplier list), that part is marked unknown. Purchases that depend on it stay on hold.
- **Secrets never live in the repo.** Passwords and API keys come from Hermes secrets, environment variables or the OS keychain. Mapping files hold secret *names*, never values.
- **Every connector passes the same test kit** (fixtures plus a fake server) before anyone may use it.

The standalone HTML page stays fully offline. It never runs a connector. It loads the bundle JSON that `bundle_import.py` produces.

## 1. Where connectors sit

```text
ERP / shop / files
   │  (read-only: search_read, GET, file read)
   ▼
connector  ──► envelope.json (canonical records, schema/envelope.schema.json)
   │             + warnings + cursors + "unavailable" streams
   ▼
bundle writer (one shared, deterministic module)
   │   aggregates demand lines → monthly net sales in the declared timezone
   │   rolls child locations → warehouses, sums sites → stock.csv on_hand
   ▼
staging/<run_id>/  Contract 1.0 CSV bundle + manifest.json + suppliers.json
   │   data_contract/validate.py must pass (errors block; warnings shown)
   ▼  (only with --apply, after the diff is reviewed)
active bundle  ──► existing load_bundle() / bundle_import.py ──► engine, Desktop, standalone
```

Why the bundle is the seam: the engine, the JS mirror and the parity tests already trust Contract 1.0. A new connector then needs **no engine change and no parity work**. It only has to produce a valid bundle. `suppliers.json` (contacts) sits beside the bundle, never inside the CSVs, so email addresses never reach forecasts, fixtures or AI prompts by accident.

The existing in-process Odoo source (`sources.OdooReadOnly`, 1–50 SKUs, live read per call) stays as it is. The new Odoo connector is a separate bulk path that writes bundles. The two share the allowlist idea, and the new one must never widen `ALLOWED_FIELDS` without owner approval (see §8).

## 2. Adapter interface (Python, standard library only)

```python
class Connector(Protocol):
    id: str                      # "odoo", "shopify", "csv", ... ^[a-z0-9_-]{1,40}$
    version: str
    capabilities: frozenset[str] # subset of STREAMS plus optional "write_po_draft"

    def check(self, config: ConnectorConfig) -> CheckResult:
        """Auth handshake plus one bounded read per stream. No data is kept.
        Returns ok/failed per stream and a generic reason. Never echoes secrets or server text."""

    def read(self, config: ConnectorConfig, stream: str, cursor: str | None,
             *, snapshot_date: date, limit: int = 10_000) -> Iterator[Page]:
        """Yield pages of canonical records (dicts matching schema/<stream>.schema.json),
        each page with next_cursor. Must be restartable from any yielded cursor."""

    # Optional. Absent unless capabilities includes "write_po_draft".
    def write_po_draft(self, config: ConnectorConfig, draft: PoDraft, *,
                       idempotency_key: str, dry_run: bool = True) -> WriteResult:
        """Create an ERP *draft/RFQ* only, never a confirmed PO. dry_run returns the exact
        request that would be sent. Real writes are gated by AUTOMATION.md."""
```

`STREAMS = item, warehouse, stock_level, demand_line, open_po_line, receipt, supplier, supplier_item`.

| Stream | Kind | Feeds (Contract 1.0) | Required? |
|---|---|---|---|
| `item` | state | `stock.csv` sku/name/unit/category, `product_master.csv` | yes |
| `stock_level` | state, full snapshot | `warehouse_stock.csv`, `stock_states.csv`, summed `stock.csv` on_hand | yes |
| `demand_line` | events | `stock.csv` monthly columns, `sales_history.csv` project flags | yes (≥3 full months) |
| `warehouse` | state | `warehouses.csv` | if more than one site |
| `open_po_line` | state | `incoming_pos.csv` | optional; absent = unknown incoming |
| `receipt` | events | `receipts.csv` (lead-time learning) | optional |
| `supplier_item` | state | `stock.csv` supplier_days, `product_master.csv` supplier/moq/pack/cost | optional |
| `supplier` | state | `suppliers.json` (contacts, outside the bundle) | needed only for email |

Rules every connector follows:

1. Only the operations it declares. A read connector imports no write client and calls no write method. Tests prove this (C1).
2. Fields come from the mapping file and must sit in the connector's built-in allowlist. A mapping can't widen the allowlist.
3. Errors shown to users are generic ("Odoo could not return the requested inventory data."). Vendor fault text, URLs and stack traces go nowhere, as in today's `OdooReadOnly`.
4. Network: HTTPS only, a certificate-verifying default TLS context, 30 s timeout, a response byte cap (default 20 MiB a page), a page cap and a run cap (10,000 records per stream, matching the contract). The base URL comes from config, never from a response or a redirect to another host.
5. Time: every date is turned into a local business date in the mapping's `timezone`. Today's Odoo source buckets months in UTC (README "Known limitations"). Connectors must not copy that; they declare the zone.
6. Units: quantities convert to the item's base unit before they enter a record. If a unit can't be converted, the record is dropped with a warning and the item is held. It is never guessed.

## 3. Canonical data contract

The JSON Schemas live in [`schema/`](schema/) (draft 2020-12). They describe the same facts as `docs/data/CONTRACT.md`, as records rather than CSV columns:

| Schema | Purpose |
|---|---|
| `common.schema.json` | ids (no surrounding whitespace, ≤128), quantities 0..1e12, lead days ≤3650, dates, ISO currency, canonical decimal strings |
| `envelope.schema.json` | one sync result: connector, run_id, snapshot_date, timezone, currency, synthetic flag, mode, dry_run, cursors, streams, `unavailable`, warnings |
| `item`, `warehouse`, `stock_level`, `demand_line`, `open_po_line`, `receipt`, `supplier`, `supplier_item` | one record each |
| `po_draft.schema.json` | the optional write payload (decimal strings so it can be hashed, per ORDER-BUILDING-SPEC §6.1) |
| `mapping.schema.json` | the per-connector mapping file |

Worked synthetic examples: [`examples/envelope.synthetic.json`](examples/envelope.synthetic.json) and [`examples/po_draft.synthetic.json`](examples/po_draft.synthetic.json). They use `samples/synthetic/` values and an `example.invalid` address.

Contract rules carried over unchanged: case-sensitive ids, blank means unknown, `0` means measured none, base units everywhere, one currency per bundle, no inferred MOQ (a price-break quantity is **not** an MOQ), a manifest snapshot equal to the final complete month-end. Versioning: a new optional field is a minor change (schema stays `"1"` and the writer ignores it until it's supported). A changed meaning needs schema `"2"` plus a converter.

## 4. Sync modes

| Mode | How it starts | Good for | Notes |
|---|---|---|---|
| **File drop** | User or ERP export job places files in a watched local folder; `stock_runway.py sync --connector csv --from DIR` | Any ERP with export (SAP B1, Sage, QuickBooks Desktop, SFTP downloads) | No credentials at all. SFTP fetching is a separate step done by the business's own tool; Inventory Manager reads only local files |
| **Scheduled pull** | Hermes cron or launchd runs `stock_runway.py sync --connector odoo` | API ERPs (Odoo, Zoho, ERPNext, Xero, QuickBooks Online, Shopify) | Default schedule: daily after close of business. The run still lands in staging. Auto-apply needs `apply: auto` in config plus a clean validation and diff limits (§6) |
| **Webhook** (later, P5+) | ERP calls a local endpoint saying "something changed" | Near-real-time stock | The webhook is **only a trigger**: it schedules a pull. The payload is never used as data. Signature checked with a constant-time compare **before** parsing, body capped, event id deduped. It needs a listening server, so it ships last and needs owner approval |

## 5. Incremental sync and idempotency

- **State streams** (`item`, `stock_level`, `open_po_line`, `supplier*`, `warehouse`) are read in full every run. They are small next to events, and a full read catches deletions. If a source is too big, `item` and `supplier_item` may go incremental by `updated_at`, with a weekly full reconcile.
- **Event streams** (`demand_line`, `receipt`) use a cursor: `(updated_at, record_id)` as the high-water mark, with ties broken by id. Each run re-reads an **overlap window** (default 3 days before the cursor) to catch late edits and clock skew. Records dedupe on `(connector, stream, source_ref.record_id)`. The last version seen wins.
- **Run identity:** `run_id` is random (a 16-byte token from `secrets.token_hex`). The bundle written for a given input is **byte-identical** across reruns (stable sort by key, fixed CSV quoting, no timestamps inside the CSVs). A rerun with the same cursors therefore changes nothing and is detected as "no change".
- **Atomic apply:** write to `staging/<run_id>/`, validate, then `os.replace` a `current` pointer file. A crash leaves the previous bundle active. Cursors are saved only after a successful apply, so a failed run repeats safely.
- **Write idempotency:** `write_po_draft` gets `idempotency_key = sha256(draft canonical bytes)`. The connector first searches the ERP for a draft carrying that key in a reference field (`TODO: verify a suitable field per vendor`) and returns the existing one instead of creating a duplicate.

## 6. Dry run and apply

```sh
python3 stock_runway.py sync --connector odoo --mapping mappings/odoo.json            # dry run (default)
python3 stock_runway.py sync --connector odoo --mapping mappings/odoo.json --apply    # promote staging
```

The dry-run output always shows: record counts per stream, `unavailable` streams, validator errors and warnings, and a diff against the active bundle (new/removed SKUs, on-hand change, demand-month change, open PO change). Auto-apply on a schedule refuses when any of these hold:

- validator errors;
- active SKU count changes by more than 20%;
- on-hand total changes by more than 50%;
- the newest complete sales month is older than the active bundle's;
- the newest month is more than 45 days old (the existing freshness rule).

All limits are configurable.

## 7. Mapping files

One JSON file per connector instance (`mapping.schema.json`). JSON rather than YAML because the engine is standard-library only. It maps vendor fields to canonical fields, names the secrets to read, and records whether each stream has been `verified` read-only against the real instance.

- [`mappings/odoo.example.json`](mappings/odoo.example.json): uses today's allowlisted models (`product.product`, `stock.quant`, `stock.move`, `stock.location`, `product.supplierinfo`, `uom.uom`). Streams marked **NEW** (`purchase.order.line`, `res.partner`) need an owner-approved allowlist change first.
- [`mappings/shopify.example.json`](mappings/shopify.example.json): Admin GraphQL. There is no supplier master (the product `vendor` text becomes the supplier id), and open POs are listed as unavailable until verified. Every path is marked unverified.
- [`mappings/csv.example.json`](mappings/csv.example.json): plain export files. Headers not listed fall back to `sources.ERP_ALIASES`.

Transforms are a closed list (`relation_id`, `relation_name`, `date_local`, `decimal`, `bool`, `negate`, `lowercase`, `sum_children`). No expressions, templates or code run from a mapping file.

## 8. Planned connectors

Vendor API details below are **not verified in this repo**. Each connector packet must check them against vendor docs and record the evidence, following CONTRACT.md's ASSUMED/documented convention.

| Connector | Transport (verify) | Notes / open points | Official docs |
|---|---|---|---|
| CSV / file drop | local files | Reuses `normalize_erp_rows` aliases plus the mapping file. P1 | – |
| Odoo 17–19 | XML-RPC `search_read` (as today) | Open POs and partner emails need allowlist expansion (owner approval). Write = draft RFQ only | https://www.odoo.com/documentation/17.0/developer/reference/external_api.html |
| Shopify | Admin GraphQL, read scopes | No supplier master. Open POs: TODO verify. Webhook HMAC header: verify | https://shopify.dev/docs/api/admin-graphql |
| Zoho Inventory | REST + OAuth | Data-centre-specific base URL: verify | https://www.zoho.com/inventory/api/v1/ (verify) |
| ERPNext / Frappe | REST (`/api/resource/...`), token auth | Bin, Stock Ledger Entry, Purchase Order Item doctypes: verify | https://frappeframework.com/docs/user/en/api/rest (verify) |
| QuickBooks Online | REST + OAuth 2 | Inventory depth is limited; demand likely from invoice/sales receipt lines. Verify | TODO |
| Xero | Accounting API + OAuth 2 | Tracked inventory items only. Purchase orders exist: verify fields | TODO |
| SAP Business One | Service Layer (REST) or file export | Start with file drop (`docs/erp-examples/sap-business-one.csv`) | TODO |
| Generic REST | owner-written mapping over JSON GET endpoints | Allowlisted host from config. Pagination styles: link/offset/cursor | – |

OAuth connectors (Zoho, QuickBooks, Xero, Shopify custom apps) keep refresh tokens in the OS keychain through Hermes secrets. The OAuth redirect listener binds to `127.0.0.1` only, uses an exact redirect URI, and checks `state` and PKCE. Request the narrowest read-only scopes. A scope list is part of each connector's packet and needs owner sign-off.

## 9. Config and secrets

- Config file (`connectors/<instance>.json`, outside the repo or git-ignored): connector id, mapping path, schedule, staging dir, apply policy, diff limits. **No secret values.**
- Secrets are resolved by name through Hermes `agent.secret_scope.get_secret` (as `OdooReadOnly` does today), then env vars, then the OS keychain. Never from chat, CLI flags, mapping files, query strings or logs.
- `.env*` files are git-ignored except `.env.example` (names only). A secret that ever lands in git is rotated, not just deleted.
- Logs and envelopes may contain host labels, but never tokens, passwords, cookies, full auth headers or URLs with userinfo. Test C8 greps all outputs for the fixture secret values.
- Server-side fetches use one `safe_fetch()`: HTTPS only, host must equal the configured host, private and reserved IPs refused (DNS resolved first), redirects not followed across hosts, timeout plus byte cap. AI models never supply URLs.
- Least privilege: the docs for each connector tell the owner to create a dedicated **read-only API user** in the ERP. Inventory Manager's own allowlist is the second lock, not the only one.

## 10. Conformance kit (every connector must pass)

Location (planned): `tests/conformance/`. Standard library only. Runs offline.

- `fixtures/<connector>/`: synthetic vendor-shaped responses (pages, errors, unit cases, deleted records, late edits). No real customer data, no real addresses (`example.invalid`).
- `mock_server.py`: `http.server` on `127.0.0.1` with a self-signed test cert. It replays fixtures by route and records every request. XML-RPC fixtures run through an injected `server_proxy_factory`, as `tests/test_odoo.py` does today.
- `expected/<connector>/bundle/`: the golden Contract 1.0 bundle that the fixtures must produce, byte for byte.
- `test_conformance.py`: parametrised over every registered connector.

| # | Check |
|---|---|
| C1 | Read-only: the recorded request log contains only allowlisted read methods. Any write verb or method fails |
| C2 | Field allowlist: a mapping naming a non-allowlisted field is refused before any request |
| C3 | Pagination: all pages read, page and run caps enforced, an oversized body rejected |
| C4 | Idempotent: two runs on the same fixtures give byte-identical bundles. A rerun from a mid-run cursor gives the same bundle |
| C5 | Incremental: a late edit inside the overlap window is picked up, and duplicates collapse |
| C6 | Units convert to base. Unconvertible gives a warning and a held item, never a guess |
| C7 | Missing stream ends up in `unavailable` and in a locked feature, never zeros |
| C8 | Secrets: the fixture secret values never appear in stdout, stderr, logs, envelope, bundle or exception text |
| C9 | Errors are generic. Vendor fault strings don't leak |
| C10 | HTTPS only. URL with userinfo, query or fragment refused. Redirect to another host refused. Timeout honoured |
| C11 | Output validates with `data_contract/validate.py` (0 errors) and `schema/*.schema.json` |
| C12 | Deterministic order and timezone: a fixture crossing a month boundary in local time lands in the correct month |
| C13 | Dry run writes nothing outside `staging/`. The active bundle is unchanged |
| C14 | `write_po_draft` (if present): dry run returns the request without sending, a repeat key doesn't duplicate, and only draft state is ever requested |

A connector counts as "supported" only after C1–C13 (plus C14 if it writes) pass and its mapping has been checked read-only on one real instance by the owner. Test passes on synthetic fixtures alone don't prove live correctness.
