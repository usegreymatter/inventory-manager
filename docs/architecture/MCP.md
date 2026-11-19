Lifecycle: proposed (design only, nothing here is implemented yet)

# MCP server: letting any AI assistant use Stock Runway safely

## In plain words

MCP (Model Context Protocol) is a standard way for AI assistants (Claude, ChatGPT desktop apps, Hermes, IDE agents) to call tools. A small local Stock Runway MCP server lets your assistant ask "what should I reorder?", "why this quantity?" or "how sure are you?" and get exact answers from the same engine.

The assistant can **read** and **draft**. It can't approve, send, change settings or raise the automation level. Those stay with a person in the app or CLI.

## 1. Shape

- Process: `python3 -m stock_runway.mcp_server` (planned), **stdio transport only**, so there is no network listener. Standard library JSON-RPC framing; no third-party MCP SDK unless an owner-approved, version-pinned dependency is accepted later.
- Data: reads the **active bundle** (CONNECTORS §1) and the opt-in diary. It never calls an ERP during a tool call. Freshness comes from the last sync.
- Config: `--bundle DIR` (required), `--diary PATH` (optional), `--settings PATH` (optional), `--allow-drafts` (off by default).
- Every response includes `as_of`, `data_age_days` and the `model_version`.

## 2. Read-only tools

| Tool | Input | Output |
|---|---|---|
| `list_reorders` | `{status?: "order_now"\|"order_soon"\|"all", supplier_id?, limit≤200}` | Items with suggested qty, order-by date, run-out, holds and reasons, `big_order` |
| `explain_item` | `{sku}` | The existing "why" breakdown: demand history used, method and why it won, cleaning steps, cover window, stock/on-order deductions, rounding (MOQ/pack), holds |
| `forecast_with_interval` | `{sku, months 1..12}` | p50 per month plus p80/p95 (null when evidence is short), method, coverage stats from the learning loop, and Monte Carlo risk when enabled |
| `data_health` | `{}` | Existing `health.data_health` summary plus validator warnings and unavailable streams |
| `accuracy_report` | `{sku?}` | Learning-loop metrics (WAPE, bias, coverage, sample counts) |
| `sync_status` | `{}` | Last sync per connector: time, counts, warnings, dry-run or applied. No hosts or secrets |
| `list_suppliers` | `{}` | Supplier id, name, allowlist status, automation level. **No email addresses** |

## 3. Draft tool (gated: needs `--allow-drafts`)

| Tool | Effect |
|---|---|
| `draft_po` `{supplier_id, skus?: [...]}` | Builds a `po_draft` from the current proposal (L1 behaviour): a local file in `automation/outbox/` plus a queue event. Returns the draft id, lines and guardrail results. It sends nothing and creates nothing in an ERP |

## 4. Write tools: intentionally absent

`approve_po`, `send_po`, `cancel_po`, `set_automation_level`, `edit_settings`, `apply_sync` and `write_erp_po` are **not exposed through MCP**. Approval and sending are human actions in Desktop or the CLI (AUTOMATION §9). If the owner later wants `cancel_po` exposed (cancelling is the safe direction), that needs its own approved packet. Approve or send through MCP is out of scope for this design.

## 5. Safety rules

- **Untrusted text:** product names, supplier names and notes come from the ERP. They are returned only inside structured fields and never as instructions. The tool descriptions tell the model so.
- **Inputs:** JSON-schema-validated. SKUs must match `common.schema.json#/$defs/sku`. Lists are capped. Unknown keys are rejected. Strings are capped before any regex.
- **Outputs:** capped at 200 items. Errors are generic, with no stack traces or paths.
- **No lethal trifecta:** the server has private data (stock, costs) but no network and no send ability, and it reads no inbox. Don't run it in the same agent session as tools that send email or browse untrusted pages with send rights.
- **Pinning:** client configs reference a fixed version or commit, never a bare `npx -y`/latest package.
- **Audit:** every `draft_po` call is written to `automation/audit.jsonl` with `actor: "mcp:<client name>"`.

## 6. Resources and prompts

- Resources: `stock-runway://docs/AGENTS.md`, `stock-runway://docs/AI-GUIDE.md`, `stock-runway://schema/{name}` (read-only files from this repo).
- Prompt: `weekly_reorder_review`, which calls `data_health` then `list_reorders` then `explain_item` for the top 5, and drafts nothing unless asked.

## 7. Tests (planned, `tests/test_mcp.py`)

- Every tool on the synthetic bundle gives output equal to the CLI/engine for the same inputs.
- Each absent write tool name returns "unknown tool".
- `draft_po` without `--allow-drafts` is refused. With it, the server writes only inside `automation/outbox/` and appends one audit entry.
- Oversized and malformed inputs are rejected. No network sockets are opened (patch `socket.socket` to raise).
