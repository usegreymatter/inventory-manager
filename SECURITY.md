# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue. Use GitHub's "Report a vulnerability" (private security advisory) on this repository. Include steps to reproduce and the affected file or version. We aim to reply within 7 days.

## Scope and data handling

- Stock Runway runs locally. The offline page and the CLI make no network requests, collect no analytics and send no data anywhere. Imported files, settings and local order lists stay in your browser storage or on your disk.
- The optional Odoo source is read-only. Credentials come from environment variables or your secret store and are never written to output.
- Useful reports include: a crafted spreadsheet/CSV that executes script in the page, formula injection in exported CSV, a way to make the page fetch a remote URL, or credential leakage in CLI output.

## Supported versions

Only the latest release receives fixes.
