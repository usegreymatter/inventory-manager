Lifecycle: living

# Security policy

## Report a vulnerability

Please report vulnerabilities privately through this repository’s [Security tab → Report a vulnerability](https://github.com/usegreymatter/inventory-manager/security/advisories/new). Include the affected version, steps to reproduce and a small synthetic example. Do not include credentials, customer data or private inventory in a report, and do not post vulnerabilities in public issues.

Replies and fixes are best effort, with no guaranteed response time. There is no bug bounty or paid reward program. Only the latest release receives fixes.

## Scope

Reports about the offline HTML page, Python CLI and local read-only MCP server are welcome. Examples include script execution from a spreadsheet, formula injection in exports, unexpected network access, local file exposure or sensitive information in errors.

The offline page processes files locally. The CLI’s CSV/bundle route and local MCP server do not upload data or send orders. The optional CLI Odoo source makes read-only requests only when explicitly configured. No surface places an order or writes to an ERP. Browser settings and local order lists may persist on the device; imported product data stays in page memory.
