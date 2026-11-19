Lifecycle: proposed (design only, nothing here is implemented yet)

# Automation: from suggestion to auto-reorder, with guardrails

## In plain words

Stock Runway can do four levels of work for you. You pick the level, per supplier if you like. It starts at **L1**: it writes the purchase order and the supplier email, and you send them yourself.

| Level | What Stock Runway does | What you do |
|---|---|---|
| **L0 Suggest** | Shows what to order and why (today's behaviour) | Everything else |
| **L1 Draft** *(default)* | Prepares the PO and an email draft (a file, or a draft in your mailbox) | Read, edit, send |
| **L2 One-click** | Queues the PO. You press Approve and it sends after a short cancel window | Approve or reject each order |
| **L3 Auto-send** | Sends on its own, but only inside limits you set (spend caps, approved suppliers, quantity sanity, quiet hours) | Watch the daily summary. Hit the kill switch any time |

Things that never happen silently:

- No email or ERP purchase order is created or sent at L2/L3 until the owner turns that level on in writing (a settings change that is itself recorded in the audit log).
- The AI assistant can draft. It can never approve or raise the level.
- Every step is written to a tamper-evident log.
- One switch stops all sending instantly.

## 1. Pipeline

```text
engine run (existing guidance, purchase lines, holds, big_order flags)
   ▼
proposal  ── ORDER-BUILDING-SPEC §6.1 envelope: canonical payload, SHA-256 digest, HMAC
   ▼
po_draft per supplier (schema/po_draft.schema.json), state=drafted
   ▼  guardrail check (§4) → decides the highest level allowed for THIS draft
   ├─ L0: show only
   ├─ L1: write email draft (.eml file / mailbox draft) → state stays drafted
   ├─ L2: state=pending_approval → human approves → scheduled → (cancel window) → sent
   └─ L3: guardrails pass → scheduled → (cancel window) → sent; any fail → falls back to L1/L2
```

**Effective level = min(owner's level for this supplier, global level, guardrail ceiling for this draft).** A failed guardrail lowers the level for that draft only, and says why. It never blocks drafting.

Engine holds still win. A held item (stale data, late unconfirmed PO, unknown reservations, unknown lead time, unsafe rounding) never enters a draft above L0.

## 2. States and the approval queue

```text
drafted → pending_approval → approved → scheduled → sent
   │            │               │           │
   └────────────┴───────────────┴───────────┴──► cancelled | expired | failed
```

- A draft is bound to its `proposal_digest`. If the data snapshot or settings change before approval, the digest no longer matches. The draft becomes `expired` and is rebuilt. Nobody approves numbers that have moved.
- Approval records who approved, when, which digest, and which level. With the **two-person rule** on, a draft needs two approvals from different named people, and the person who edited a line can't be its only approver. Names here are local labels, not authentication. Real identity needs the hosted/multi-user design, which is out of scope.
- Queue location: CLI keeps `automation/queue.jsonl` (append-only state events). Desktop reads the same file through the plugin. The standalone page has L0/L1 only (it never sends), so it has no queue.
- `expires_on` defaults to the proposal's expiry (planning date + 3 days). Expired drafts never send.

## 3. Cancel window and rollback

- **Scheduled → sent** waits a cancel window: default **10 minutes at L2** and **60 minutes at L3**, configurable from 0 to 24 h. The window is never 0 at L3. Cancel works from the queue, the CLI (`stock_runway.py automation cancel DRAFT_ID`) or the kill switch.
- Email can't be unsent. After `sent`, "rollback" means a prepared **correction/cancellation email draft** to the same supplier. It is always created at L1, so a human sends it.
- ERP writeback (when enabled) creates only a **draft/RFQ** PO and never confirms it. Rollback cancels that ERP draft if it is still draft. If someone has confirmed it in the ERP since, Stock Runway does nothing and tells the owner.

## 4. Guardrails (all must pass for L3; the first four also gate L2)

| Guardrail | Default | Fails when |
|---|---|---|
| Kill switch | off (sending allowed) | `automation.enabled=false` in settings, **or** the file `automation/STOP` exists, **or** env `STOCK_RUNWAY_AUTOMATION_OFF=1`. Checked right before every send, not only at queue time |
| Data health | – | Any engine hold on a line, validator errors, or data older than 45 days |
| Supplier allowlist | empty (nobody) | Supplier is not on the allowlist **with a verified email** fingerprint (see §6) |
| Contact change | – | The supplier email differs from the address verified at enrolment. Drops to L1 and alerts (common invoice-fraud pattern) |
| Per-order cap | owner sets, no default | Draft total value > cap, or unit cost unknown |
| Per-supplier monthly cap | owner sets | Sent value this calendar month + this draft > cap |
| Total monthly cap | owner sets | Across all suppliers |
| Quantity sanity | 1.5× | Any line qty > 1.5 × `forecast_cover_qty`, or the line is flagged `big_order` (existing README rule) |
| First order | always | First-ever order to a supplier, or for a SKU from this supplier |
| Price change | 10% | Unit cost moved more than 10% since the last sent PO |
| Duplicate | – | An open PO or a `scheduled`/`sent` draft already covers this SKU/supplier within the lead time |
| Quiet hours | 20:00–08:00 and weekends, owner timezone | Send time falls inside quiet hours. Stays `scheduled` until the window opens |
| Rate limit | 20 sends/day | Daily send count reached |
| Anomaly stop | – | Sync failed or was skipped, demand for a line is more than 3× its 6-month median, forecast WAPE got worse by more than 25% vs last month ([LEARNING-LOOP.md](LEARNING-LOOP.md)), or the SKU count dropped by more than 20%. An anomaly stops **all** L3 until a human clears it |
| Two-person rule | off | On, and fewer than two distinct approvers |

Caps have **no defaults on purpose**. L3 can't be turned on until the owner enters them. Caps are in the bundle currency, and a draft in another currency fails the cap check.

## 5. Audit log

- `automation/audit.jsonl`, append-only, written with the same locked append-and-fsync as `learning.append_jsonl`.
- Each entry: `{seq, at, actor, kind, draft_id, proposal_digest, level, details, prev_hash, hash}` where `hash = sha256(canonical(entry without hash))` and `prev_hash` is the previous entry's hash (genesis = 64 zeros). Canonical bytes follow ORDER-BUILDING-SPEC §6.1 (sorted keys, no spaces, ASCII, no NaN).
- Logged kinds: level changes, guardrail config changes, allowlist changes, every draft state change, guardrail fail reasons, kill-switch on/off, send results (message id only, never body credentials), ERP write requests and responses (ids only).
- `stock_runway.py automation verify-log` recomputes the chain and reports the first broken link. This is **tamper-evident, not tamper-proof**: anyone with disk access can rewrite the whole chain. The daily summary prints the head hash, so an off-machine copy (the summary email or chat) anchors it.
- Never logged: email bodies with contact data beyond the supplier id, secrets, tokens, full ERP responses.

## 6. Email

Draft-first in every provider. The order of work is: a local file first (no credentials), then a mailbox draft, then send.

| Provider | Draft | Send | Credentials | Docs |
|---|---|---|---|---|
| **Local .eml / mailto** (P2 default) | `.eml` file written to `automation/outbox/`, opens in the mail app | User sends | none | – |
| SMTP | – (SMTP has no drafts; use .eml) | `smtplib` with STARTTLS or implicit TLS, certificate verified | app password in keychain | https://docs.python.org/3/library/smtplib.html |
| Gmail API | `users.drafts.create` | `users.drafts.send` | OAuth refresh token in keychain; narrowest scopes (verify: compose vs send) | https://developers.google.com/gmail/api/reference/rest/v1/users.drafts |
| Microsoft Graph | create message (draft) | send message | OAuth; `Mail.ReadWrite` / `Mail.Send` (verify) | https://learn.microsoft.com/en-us/graph/api/user-post-messages |

Email safety rules:

- The recipient comes **only** from `suppliers.json` contacts with `role=purchasing`, matching the verified fingerprint. Never from chat, AI output, ERP free-text notes or a reply.
- Subject and body are built from a fixed template (per supplier `language`, English and Arabic at first) with escaped values. CR and LF are removed from header values (header injection). No HTML email in v1 (plain text plus a PO CSV attachment), so no HTML injection either.
- AI may suggest wording for a **draft** at L1. At L2/L3 the body is the template only.
- **Inbox reading is out of scope.** The process that can send never reads supplier replies. That keeps untrusted input away from a send-capable tool (the "lethal trifecta" rule in secure-coding-guardrails).
- Message ids are stored for audit and for rollback correction emails.

## 7. ERP PO writeback (gated)

- Needs: connector capability `write_po_draft`, owner approval of the exact model and fields (an allowlist entry like today's read allowlist), and a dedicated ERP user that can **create draft POs only**.
- It creates the draft only after the email step reaches `sent` (L2/L3) or after a human marks the order "sent manually" (L1). The ERP then mirrors what was actually ordered.
- It sends the idempotency key, so a retry finds the existing draft (CONNECTORS §5). It never confirms, never receives goods, never touches invoices.
- Dry run (default) writes the exact request to `automation/outbox/<draft_id>.erp.json`.

## 8. Notifications

- Per event: draft ready (L1), approval needed (L2), scheduled with time-to-send and a cancel link/command (L2/L3), sent, failed, anomaly stop, kill switch changed.
- Channels: the Desktop badge and the Hermes chat message (existing surfaces). Email-to-owner is optional and reuses the email provider.
- Daily summary: drafts, sends, spend vs caps, guardrail fails, anomalies, audit head hash.
- Notifications never include full supplier contact data or secrets.

## 9. Level change rules

- L0→L1: any time, no approval (nothing leaves the machine).
- L1→L2 and L2→L3: owner only, through the CLI or Settings with typed confirmation. Recorded in the audit log. Never via chat tool or MCP.
- Suggested bar before L3 for a supplier (owner decides): at least 3 months at L2, at least 6 approved orders, and under 10% of lines edited before approval.
- Any anomaly, contact change or verify-log failure drops affected suppliers back to L1 until a human clears it.
