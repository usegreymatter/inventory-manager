Lifecycle: proposed

# Roadmap: connect, automate, learn

## Status today (v1.1.0)

Shipped: smart Excel/CSV import with preflight, the canonical CSV bundle, a read-only Odoo source, forecast methods (Current default; Auto experimental), light/dark themes, local order lists kept in the browser, the Python CLI, and the [local read-only MCP server](architecture/MCP.md) (`list_reorders`, `explain_item`, `data_health`). **Not built:** the phases below (mapping-file connectors and `sync`, email drafts, auto-reorder, ERP write-back, webhooks, MCP draft/write extensions). The remaining phases below are a plan; P6's read-only subset has shipped.

## In plain words

Six phases. Each ships something useful on its own and keeps today's numbers unchanged unless a packet says otherwise. Phases that could **send, write or spend** are marked **OWNER APPROVAL**. They don't start until the owner signs off on that packet.

| Phase | Ships | Owner approval? |
|---|---|---|
| P1 | Canonical schema, CSV + read-only Odoo bulk connectors, conformance kit, `sync` dry-run | Only the Odoo allowlist expansion (P1.4) |
| P2 | Local email drafts (.eml) + approval queue + audit log | No (nothing leaves the machine) |
| P3 | Learning loop snapshots v2 + metrics + shadows | No (record and score only; methods frozen) |
| P4 | L2 one-click send with caps; mailbox drafts; L3 behind guardrails | **Yes** |
| P5 | More connectors; ERP draft-PO writeback; webhooks | Writeback, webhooks and each new OAuth scope list: **yes** |
| P6 | Local MCP server (read + draft) | `--allow-drafts` default and client rollout: yes |

Design docs: [CONNECTORS](architecture/CONNECTORS.md), [AUTOMATION](architecture/AUTOMATION.md), [LEARNING-LOOP](architecture/LEARNING-LOOP.md), [MCP](architecture/MCP.md).

## Rules for every packet

- One writer per worktree. Tests first (RED, then GREEN). Standard library only. No network in tests. Synthetic fixtures only (`example.invalid` emails).
- If engine or JS output can change: update **both** Python and `desktop/plugin.js` and pass the parity suites, run `scripts/golden_diff.py` (expected: unchanged unless the packet says otherwise), and rebuild with `python3 standalone/build.py`.
- Checks: `python3 -m pytest -q` and `node --test --test-concurrency=1 tests/*.test.mjs`.
- Done report: files, commands, real pass counts, blockers, and `Not checked:`.
- Forecast methods stay frozen until November 2026 actuals are reviewed.

---

## P1: Canonical schema, first connectors, conformance kit

**P1.1 Schema validator + bundle writer**
- Scope: a standard-library JSON-Schema-subset validator (the `jsonschema` package isn't available or allowed) for `docs/architecture/schema/*.json`. Then `connect/bundle_writer.py`: envelope → Contract 1.0 bundle + `manifest.json` + `suppliers.json`, deterministic bytes, local-timezone month aggregation, site roll-up.
- Files: `connect/schema_check.py`, `connect/bundle_writer.py`, `tests/test_bundle_writer.py`.
- Tests: `examples/envelope.synthetic.json` → bundle passes `data_contract/validate.py` with 0 errors. Rerun is byte-identical. A month-boundary timezone case lands correctly. Negative net month is reported, not clamped. Missing stream → no file written (unknown).
- Acceptance: `samples/synthetic` round-trips (bundle → envelope → bundle) with identical CSV bytes for the covered tables.
- Risk gate: none (local files).

**P1.2 `sync` CLI with staging, diff, apply**
- Scope: `stock_runway.py sync --connector X --mapping M [--apply]`, staging dir, diff summary, atomic `current` pointer, cursor store, auto-apply refusal rules (CONNECTORS §6).
- Files: `stock_runway.py` (subcommand only), `connect/sync.py`, `tests/test_sync.py`.
- Tests: dry run leaves the active bundle untouched (hash before = after). An apply crash midway leaves the old bundle active. Each diff limit refuses as expected.
- Acceptance: existing CLI flags and outputs unchanged (`tests/test_cli.py` green).
- Risk gate: none.

**P1.3 Conformance kit + CSV connector**
- Scope: `tests/conformance/` (mock server, fixtures, golden bundles, checks C1–C13). CSV/file-drop connector using the mapping file plus `normalize_erp_rows` fallback.
- Files: `connect/connectors/csv_files.py`, `tests/conformance/**`, `docs/architecture/mappings/csv.example.json` (already drafted).
- Tests: C1–C13 for `csv`. All 8 files in `docs/erp-examples/*.csv` import (as `scripts/verify_import_examples.py` does today).
- Acceptance: kit is parametrised so adding a connector means adding fixtures + golden only.
- Risk gate: none.

**P1.4 Odoo bulk read-only connector**
- Scope: a bundle-writing Odoo connector reusing `OdooReadOnly`'s guarded `_call`. Streams: item, warehouse, stock_level, demand_line, supplier_item. Batching beyond 50 SKUs by paging.
- Files: `connect/connectors/odoo.py`, `tests/conformance/fixtures/odoo/**`, `mappings/odoo.example.json`.
- Tests: C1–C13 against a fake `server_proxy_factory`. `ALLOWED_METHODS` still `{"search_read"}`. The existing `tests/test_odoo.py` stays unchanged and green.
- Acceptance: synthetic Odoo fixtures produce the golden bundle. No live server touched.
- Risk gate: **OWNER APPROVAL** before adding `purchase.order.line` (open POs) or `res.partner.email` (supplier contacts) to the allowlist. Without approval those streams ship as `unavailable`. Live verification on the owner's instance is an owner-run, read-only step.

## P2: Local email drafts, approval queue, audit log

**P2.1 Audit log (hash-chained)**
- Files: `automation/audit.py`, `tests/test_audit.py`. Scope per AUTOMATION §5 plus `automation verify-log`.
- Tests: chain verifies. Editing, deleting or reordering any line is detected at the exact seq. A torn final line is quarantined (reuse the `learning` locking pattern).
- Risk gate: none.

**P2.2 Drafts + queue (L0/L1 only)**
- Scope: proposal → per-supplier `po_draft` (schema-valid) → `.eml` plus PO CSV in `automation/outbox/`. Queue states `drafted`, `expired`, `cancelled`. Digest binding. Template in English and Arabic (Arabic marked draft per AR-GLOSSARY).
- Files: `automation/drafts.py`, `automation/queue.py`, `automation/templates/`, tests.
- Tests: held items never drafted. A digest change expires the draft. CR/LF stripped from headers. The recipient comes only from `suppliers.json`. The `.eml` parses with `email.parser`. Nothing opens a socket.
- Acceptance: the Desktop/standalone "Copy purchase order" text and the `.eml` body show identical lines (parity test).
- Risk gate: none (no send).

**P2.3 Desktop queue view**
- Scope: list drafts, open `.eml`, mark "sent manually", cancel. Standalone page gets `.eml` download only.
- Tests: Node tests on the queue reducer. Harness capture under `.scratch/`.
- Risk gate: none.

## P3: Learning loop snapshots and metrics (record only)

**P3.1 Diary v2 + reconciliation + metrics**
- Scope: LEARNING-LOOP §2–§4 in Python **and** JS: v2 rows, h=1..3 scoring, pinball loss, per-class reports, restatement handling.
- Files: `learning.py`, `engine.py` (diary writer), `desktop/plugin.js`, `standalone/design/learning-a3.js`, tests both sides.
- Tests: hand-computed fixtures equal in Python and JS. v1 rows still score identically. Goldens unchanged.
- Risk gate: none. **The freeze holds**: no selection or forecast change.

**P3.2 Shadow models**
- Scope: shadows (Croston, SBA, seasonal naive, ETS variants, bootstrap quantiles) recorded in CLI v2 rows. Standalone records the champion only.
- Tests: golden byte-identical with shadows on and off. Bootstrap uses the shared PRNG with test vectors.
- Risk gate: none (not shown as answers).

**P3.3 Calibration display + Monte Carlo (display only)**
- Scope: LEARNING-LOOP §6 with the shared PRNG in both languages, risk shown in the item drawer, scale benchmark.
- Tests: PRNG vectors are cross-language. Fixed seed gives identical risk. Zero variance gives the deterministic result. 1,000-SKU benchmark under budget.
- Risk gate: **OWNER APPROVAL** before the calibration multiplier or risk number feeds safety stock or quantities (a separate later packet).

**P3.4 Challenger promotion (after Nov 2026 actuals)**
- Scope: only if P3.1–P3.2 data meets the promotion bar. One packet per method.
- Risk gate: **OWNER APPROVAL** plus parity, golden before/after table and standalone rebuild.

## P4: L2 send with caps (OWNER APPROVAL)

**P4.1 Mailbox drafts** (Gmail or Graph *draft* only, owner picks one)
- Scope: OAuth with loopback redirect, PKCE and state; token in keychain via Hermes secrets; narrowest draft scope (verify against vendor docs).
- Tests: fake provider server. Token never appears in logs (C8-style grep). Drafts only, no send endpoint called.
- Risk gate: **OWNER APPROVAL** of provider, scopes and account.

**P4.2 L2 one-click send + guardrails**
- Scope: `pending_approval → approved → scheduled → sent`, cancel window, kill switch checked at send time, guardrails 1–4 from AUTOMATION §4, caps required, notifications, daily summary with audit head hash. Send via SMTP or the chosen API.
- Tests: every guardrail has a failing fixture. Kill switch set during the cancel window blocks the send. Expired digest blocks. Rate limit enforced. Two-person rule enforced when on. A fake SMTP server (`127.0.0.1`) receives exactly the approved body.
- Risk gate: **OWNER APPROVAL**, plus the first real send done by the owner to their own address, then to one allowlisted supplier.

**P4.3 L3 auto-send within guardrails**
- Scope: the full guardrail table, anomaly stop, contact-change drop, promotion bar per supplier.
- Risk gate: **OWNER APPROVAL** per supplier, with caps entered first. Starts with one supplier for one month.

## P5: More connectors, writeback, webhooks

- **P5.x connectors:** Zoho Inventory, ERPNext, Shopify, QuickBooks Online, Xero, SAP B1 (file drop first, Service Layer later), generic REST. Each: verified vendor-doc evidence table, mapping example, fixtures, C1–C13 green. Risk gate: **OWNER APPROVAL** of each OAuth scope list. Reads only.
- **P5.w ERP draft-PO writeback:** `write_po_draft` for Odoo first (draft RFQ only), idempotency key, C14. Risk gate: **OWNER APPROVAL** of exact model, fields and dedicated ERP user.
- **P5.h webhooks:** local receiver, signature check before parse, body cap, event dedupe, trigger-only. Risk gate: **OWNER APPROVAL** (opens a listener).

## P6: MCP server (read-only subset implemented)

- Implemented: `list_reorders`, `explain_item`, `data_health` over local stdio; see [current MCP contract](architecture/MCP.md).
- Remaining proposed scope: `draft_po` behind `--allow-drafts`. No approve/send tools.
- Files: `mcp_server.py`, `tests/test_mcp.py`, client config examples (version-pinned).
- Tests: `tests/test_mcp.py`; see the MCP contract verification section.
- Risk gate: none for read-only. **OWNER APPROVAL** to enable `--allow-drafts` by default or to add any further write tool.

## Open questions for the owner

1. Odoo: may we read open POs (`purchase.order.line`) and supplier emails (`res.partner`)? That is a read-allowlist expansion plus personal data.
2. Email: which provider first after `.eml`: SMTP, Gmail or Microsoft 365? Which mailbox?
3. Caps: per-order, per-supplier monthly and total monthly limits for L2/L3 (no defaults on purpose).
4. Two-person rule: on or off by default? Who are the approvers?
5. Quiet hours and timezone: is `Asia/Kuwait`, 08:00–20:00, Sunday–Thursday right?
6. Which ERP after Odoo and CSV: Zoho, Shopify, ERPNext, QuickBooks/Xero or SAP B1?
7. After November 2026 actuals: who reviews the scores, and what bar triggers a method change?
8. Should Monte Carlo risk ever drive order quantities, or always stay advisory?
