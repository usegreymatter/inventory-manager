Lifecycle: review

# v1.2 final integration candidate

Local synthetic source candidate only. No release, push, install, production inventory or ERP access is authorized by this receipt.

## Integration and protected deltas

Base: `8161314` (v12-int). Integrated the reviewed import branch `1eb2fde` and UI/H1/M1 branch `ca978a2` (including `44eba83`, `ce20b2d` and `715e26d`). Git's three-way merge combined the source changes without source conflicts. CHANGELOG and v1.2 candidate notes retain both import-safety/reliability disclosures and feature/setup-guide fixes.

The original preset, import-helper, H1/M1 and display delta fixtures remain byte-identical. The protected plugin digest remains `0d80862e43d6e32be9f36d8a021e749f12a4f7d2babe012bca3c93dccacc1ea2`; the protected engine digest remains `a26c096356c0e69c6175e6d94aabc25d138b2cb0eb8add9413d27cba8b8aa10d`. Capture guard uses the reviewed immutable importer checkpoints (`de6ded8`) while reconstructing only the reviewed feature/display seams for the frozen maths check.

The full-file historical display guard initially rejected the newly integrated importer bytes, as expected. `tests/fixtures/v12-combined-import-delta.json` (SHA-256 `a79bdba89bf4129159d884ee2df93cc1669eb5d55c254eab3b633a201144e87a`) records the exact ten grouped importer hunks relative to `ca978a2`. The test reverses those literal hunks before the existing display reconstruction to obtain its **unchanged** historical full-file hash. It does not reverse imports in the runtime quantity comparison. Unknown or missing snippet mutations fail closed; appended unknown bytes remain detectable. No broad exclusions or baseline/golden regeneration were added.

## Integration gate receipts

- All eight named templates, default and synthetic demo rebuilt (10 outputs); default equals `option-gm-b`.
- Node suite: **3,711 passed, zero failures**, exit 0 on the final rerun with 1,024 MiB Node heap limit. An initial completed run found only the full-file historical display composition mismatch above; that was corrected and rerun. Interrupted 512 MiB retries were not counted as passes.
- `/usr/bin/python3 -m pytest -q`: 2,221 passed.
- `/usr/bin/python3 -m unittest discover -s tests`: 364 tests, OK.
- Golden comparison: all fields unchanged; never `--write`.
- Eight ERP import examples unchanged; docs checker: zero problems.
- Capture-polish protected guard and all six `sync_*.py --check` scripts pass.
- Unmodified external R3 kit: 562 cases, 9,063 assertions, zero failures.
- Original import-fuzz JS runner with `FUZZ_REPO` targeting this worktree: 13 synthetic reproducer files, complete workbook-reader/report Python/JS equality. Explicit blank-lot snapshot and styled/unstyled 1904 epoch controls pass. Original export runner: 12 cases; formula prefixes remain hardened.
- H1/M1 committed regressions cover cap 10/MOQ 12 (no suggestion plus reason), 2,830 before/after preset quantity, and a 300-unit override explained as 3 months, with Python parity.

Logs and scratch verifier scripts are under ignored `.scratch/A/` and `.scratch/`; the original R3 kit also keeps its own result files. All task shell operations and commits use the assigned isolated subagent worktree, not the parent checkout, following the latest isolation instruction. Parent may fast-forward/merge this local candidate.

## Display rename

Owner decision: Inventory Manager; repository `usegreymatter/inventory-manager`. The display migration covers Desktop page/settings/quick-view/palette/navigation, CLI help and error/command text, all authored standalone templates and purchase-order/print branding, chart email draft text, README, guide, live architecture/data docs, index pages, plugin/catalog attribution and release notes. All ten HTML files were rebuilt from those sources.

Stable filenames (`stock-runway.html`, `stock_runway.py`), plugin id `stock-runway`, `/stock`, `/stock-runway`, directive, JSON/schema keys, exported column names, localStorage keys and internal globals/DOM ids are unchanged. No data migration or storage reset is introduced. Internal descriptive engine/parser comments remain unchanged, as do immutable fixtures, historical receipts and the legal copyright holder in LICENSE/embedded non-rendered license notices.

Machine-readable values changed only where clearly display text: `tools.py` fallback JSON `error` string; canonical schema `title`; catalog `title`/`maintainer`; plugin YAML `author` and Desktop manifest `name`/contribution `title`/`label` strings. No CSV/JSON business-data key or product-name value was rewritten. Workbook sheet titles and weekly summaries already use generic planning labels; the full source search found no former-brand display text there.

`tests/fixtures/v12-rename-approved-delta.json` (SHA-256 `db0212e8db5191c13f541ea4f970df8d6bba6dc20d147f2644164518aa25a8ea`) pins ten exact plugin display lines and the one tool fallback error line. Before full-file historical plugin comparison, the guard reconstructs the display name, then integrated importer hunks, then the pre-existing display delta. Capture-polish reconstructs only the one tool error string before checking its **unchanged** frozen hash. The engine, mathematical digests, importer pins, golden outputs and original delta fixtures are not re-pinned.

New automated checks verify CLI help, authored display strings, the exact pre-rename plugin hash, rejection of unknown rename mutations and stable contribution identities. Separate offline browser acceptance checks rendered text/title/accessible labels in all ten standalone outputs plus Desktop page, quick view and settings (SDK shim, not installed Desktop). The README contains the single requested former-name notice. Remaining source matches are historical/legal/non-rendered descriptive text or literal old-byte reconstruction/test allowlists, not current UI labels. Final gate counts and exact grep counts are recorded in [the closing receipt](v12-final-verification.json). Current README light/dark screenshots and the demo GIF were regenerated from the renamed offline UI; the GIF is 960×600, 16 seconds / 160 frames, fully decoded and visually checked across its four actual UI states. Historical screenshot archives are unchanged.

### Final renamed-candidate gates

All required gates pass after rename: 3,713 Node checks, 2,221 pytest tests, 364 unittest tests, unchanged goldens, 8/8 import examples, six mirror checks, protected capture guard, and the unchanged external R3 kit (562 cases / 9,063 assertions / zero failures). The original fuzz runners were repeated on 13 reproducer files with complete reader/report parity plus 12 CSV export cases. Browser proof: all **33/33** standalone capture scripts exit 0; the preset browser matrix has **36 checks** across 390/1440 px and light/dark, with zero page/network errors; the new rendered-name check covers **13 surfaces**. The broader browser/media batch completed 37/37 commands including README captures and demo-state capture.

The first browser attempt was a launcher failure: the background shell lacked `PLAYWRIGHT_MODULE`. Every capture exited immediately before running browser assertions. The launcher now supplies the existing local module, isolated `qa-chrome`, synthetic fixture directory and inherited HOME/browser environment explicitly, with stdout/stderr retained. No capture assertion was relaxed. Earlier assertion-label edits change only the owner-requested display name. A Node 22 synchronous-child I/O stall was also captured (Python blocked reading stdin while Node waited in `SyncProcessRunner`); the final complete renamed suite used the already-installed Node 26.12.1 with a 1,024 MiB heap limit, without installs or product-code workarounds.

Independent recomposition also matches the final plugin (after reversing only the literal display-name delta) and worklist byte-for-byte to Git's automatic three-way merge of `c187f8e`, `1eb2fde`, `ca978a2`. Fourteen single-branch source modules match their reviewed branch exactly; the worklist's additional shared CSV serializer is the approved importer delta, not a lost UI change.

## Independent final review

One independent final review covered `8161314..4903c973061b30db2b5c71ac470b5edc5e2422b3`. Trusted native delegation metadata attests **Anthropic `claude-opus-5-5`, high effort**, normal completed exit, no output truncation, 20 API calls. Verdict: **GO, no code/safety blockers**. The reviewer independently recomposed the merge, verified exact branch/module identities, pinned-delta fail-closed behavior, storage/route/command identities, branded CLI launch, golden comparison, capture guard and 21 focused Node checks. It reproduced H1/M1 and the 300-unit/3-month explanation. This is local synthetic sign-off, not release authority.

It identified two importer/reliability bullets omitted from CHANGELOG during the conflict resolution. Although their complete disclosures remained in the release notes and the reviewer marked this nonblocking, final merge fidelity requires retaining both reviewed changelog additions: both exact original bullets are restored in the final documentation-only closeout. No production code, tests, fixtures, generated HTML or media changed after the reviewed revision.

Range `git diff --check 8161314..HEAD` reports one inherited trailing-space line in the newly vendored immutable `tests/fixtures/baselines/de6ded8/csv_import.py:416`; it exactly matches the reviewed `de6ded8` source. The immutable fixture is intentionally not normalized. Working-tree/current-closeout diff checks are clean. Review disposition and trusted route metadata are recorded in [the review receipt](v12-final-opus-review.json).

Not checked: installed Hermes Desktop, live ERP/customer data, hosted release, physical Safari/iPhone or real-business financial outcomes.
