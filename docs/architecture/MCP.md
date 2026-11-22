Lifecycle: living

# Local MCP server: implemented read-only scope

The client-visible server name is `inventory-manager`.

`mcp_server.py` exposes exactly `list_reorders`, `explain_item` and `data_health` over newline-delimited UTF-8 JSON-RPC on stdio. Python standard library only. It loads one local synthetic or owner-selected CSV/bundle once at startup; restart to refresh. It never connects to Odoo, opens a network listener, writes a diary, drafts or sends orders, or edits source files. Forecasts remain estimates.

## Startup and snapshot

```sh
python3 -B /absolute/checkout/mcp_server.py --csv /absolute/data/stock.csv
python3 -B /absolute/checkout/mcp_server.py --bundle /absolute/data/bundle --settings /absolute/data/settings.json --today 2026-11-01
```

Replace absolute placeholders with real paths in a fixed, reviewed checkout. Source paths are startup arguments only; tools cannot choose files. Settings use the CLI validator, including its `show_costs` presentation option. Single CSVs use the CLI's input-meaning review. Flagged risks refuse startup unless the owner checks the file and explicitly adds `--show-orders-anyway`. Acknowledgment does not repair invalid rows. CSV-only `--stock-includes-reserved` and `--incoming-not-in-file` have the CLI meanings. Missing incoming remains unknown and purchase estimates assume zero; check open orders. Invalid stock/sales/incoming retain the existing importer and engine safety behavior.

The planning date freezes at startup (local today unless `--today YYYY-MM-DD` is supplied). Every successful tool payload includes `planning_date`, source `as_of`, signed `data_age_days` (negative for future snapshots), `model_version` and `source_loaded_once`. Model and server versions identify this 1.2.1-beta package. No automatic reload or learning diary writes occur.

## Tools

| Tool | Arguments | Result |
|---|---|---|
| `list_reorders` | `status`: `order_now` (default), `order_soon`, `all`; `limit`: integer 1–200 (default 200) | Exact CLI JSON rows in source order; `items`, `total`, `returned`, `truncated` |
| `explain_item` | required `sku` | Exact CLI JSON row in `item`, including `why_breakdown`, `why_this_amount` and input warnings |
| `data_health` | empty object | Existing `health.data_health` result in `health`, whitelisted validator diagnostics, import summary/warning count/review status, unknown incoming streams |

`order_now` filters internal `order`; `order_soon` filters `running-low`. Returned row statuses are unchanged. Supplier identity is not reliably retained by these loaders, so a supplier filter is not available. SKU matching is exact and case-sensitive. SKU identifiers follow [common schema](schema/common.schema.json) `#/$defs/sku`: 1–128 characters, no surrounding whitespace or embedded newline. Unknown tool arguments are rejected; boolean/fractional limits are rejected.

All arrays are capped at 200 recursively. `array_truncations` reports shortened array paths, original totals and returned counts; `array_truncations_total` reports the number of such arrays (the report itself is capped at 200). Top-level reorder counts describe the selected rows before the limit. Scalar identities and quantities are never shortened. The entire serialized response is capped at 2 MiB; oversized responses return a generic error rather than partially cutting a row. `import_summary` exposes available `rows_imported` and `products_ready` scalar counts plus lengths of `accepted_rows`, `rows_set_aside` and `ignored` (ignored columns). Importer paths, cell contents and exception text are excluded from health diagnostics. Product/supplier labels remain untrusted JSON values, never instructions or tool descriptions.

## Protocol and safety

The server implements dual eras, not an initialization-only “latest” protocol:

- Modern **2026-07-28**: every request independently supplies `params._meta` with `io.modelcontextprotocol/protocolVersion` (string) and `io.modelcontextprotocol/clientCapabilities` (object); `io.modelcontextprotocol/clientInfo` is optional. No initialize required. `server/discover` returns supported versions and tools capability. Successful results carry `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`. Unsupported modern versions return `-32022` with `data.supported` and `data.requested`. Missing required metadata is invalid params.
- Legacy **2025-11-25**, **2025-06-18**, **2024-11-05**: `initialize` negotiates an exact supported legacy revision, otherwise prefers 2025-11-25. `notifications/initialized` enables tools. `ping` is available. Modern requests do not depend on legacy session state.
- No batches, resources, prompts, draft tools, optional future tools or write tools. Unknown methods return `-32601`; invalid requests `-32600`; parse errors `-32700`; invalid tools/arguments `-32602`. Notifications receive no response; stray response messages are ignored. Client envelope metadata and progress tokens are allowed.
- Requests are limited to 1 MiB per line, read with bounded binary buffers. Oversized lines are discarded through the next newline before resuming. Duplicate JSON keys, NaN/Infinity, invalid UTF-8, excessive nesting and huge integer parsing failures are rejected. RPC ids are bounded nonempty strings or safe integers, never booleans/null/objects. Serialization uses ASCII escapes and rejects nonfinite values. Errors contain no raw paths, inputs or tracebacks; stdout contains protocol messages only.
- Source inputs must be regular files (bundle immediate CSV/JSON files are checked before loading). No network tools, auth configuration or secrets are required. Read-only annotations describe behavior, not authorization for other tools in the assistant's session.

Protocol references: [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), [legacy lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

## Local client configuration

These are format-verified examples, not real-client runtime proof. Replace `/absolute/python3` with the absolute path to an existing Python interpreter and all checkout/data placeholders. Keep the checkout fixed at a reviewed revision. Add risk acknowledgment only after reviewing the file; the examples deliberately omit it. No package installer or remote launcher is needed.

The following JSON works as the server entry format for Claude Desktop (`claude_desktop_config.json` via Settings → Developer → Edit Config), Claude Code (project `.mcp.json` or a temporary file passed using `--mcp-config`), Gemini CLI (project `.gemini/settings.json`) and Cursor (project `.cursor/mcp.json`). Merge with existing configuration rather than replacing it.

```json
{
  "mcpServers": {
    "inventory": {
      "command": "/absolute/python3",
      "args": ["-B", "/absolute/checkout/mcp_server.py", "--csv", "/absolute/data/stock.csv"]
    }
  }
}
```

Official format references: [Claude Desktop](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers), [Claude Code](https://code.claude.com/docs/en/mcp), [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), [Cursor](https://prod.cursor.com/docs/mcp).

Codex uses TOML in its `config.toml`:

```toml
[mcp_servers.inventory]
command = "/absolute/python3"
args = ["-B", "/absolute/checkout/mcp_server.py", "--csv", "/absolute/data/stock.csv"]
```

See [official OpenAI documentation](https://developers.openai.com/codex/mcp/). ChatGPT's app requires a remote HTTPS MCP endpoint; this local stdio server does not provide one.

## Verification and future boundaries

Run `python3 -B -m pytest -q tests/test_mcp.py` with an existing pytest development environment and `python3 -B scripts/check_docs.py`. Tests use synthetic fixtures, real CLI subprocess equality, modern/legacy framing, malicious input containment and a patched socket during startup and all three tools. Focused proof is local; full regression suites, independent review and real-client proof are separate controller gates.

The earlier design's `forecast_with_interval`, `accuracy_report`, `sync_status`, `list_suppliers`, `draft_po`, resource URIs and weekly-review prompt remain proposals only. Approve/send/cancel/settings/sync/ERP-write tools are absent. [Connector roadmap](../ROADMAP-CONNECT.md) and [automation](AUTOMATION.md) remain designs outside this read-only packet.
