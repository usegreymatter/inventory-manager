Lifecycle: living

# v1.2 H1/M1 feature fixes — local candidate, not release-approved

## Authorized scope and exact protected deltas

Base checkpoint: `44eba83`. H1 passes computed guidance into the profit adapter and its unavailable-reason check. M1 adds validated product-only `months_of_cover` input resolution; neither the order-quantity formula nor any forecast-method implementation changes. `docs/forecast-methods-baseline.json` and its approved-block hashes are unchanged.

The exact three engine spans and seven Desktop core spans are in [`../../../tests/fixtures/v12-feature-approved-delta.json`](../../../tests/fixtures/v12-feature-approved-delta.json). The fixture is SHA-256-pinned (`001604801eab89af6b013a6298adaa8e171f48823220943f1be48eefe386893b`) in `tests/reviewed-v12-delta.cjs`. It restores the exact `44eba83` bytes before the existing preset-delta reconstruction and immutable guards. This follows `preset-approved-delta.json`; no wildcard exclusions or replacement baseline hashes are introduced. Capture and approved-block guards use the same restoration. Unknown mutations still fail. The existing approved preset fixture and golden data are unchanged.

- **H1 rationale:** the profit simulator already supports a cap, but the adapter omitted the computed `shelf_cap_qty`. It now forwards that cap, including zero/fractional values, and withholds suggestions when the positive MOQ/pack grid cannot fit. The exact reason is **Shelf-life cap conflicts with the minimum order or pack size; using standard amount.** Suggestion alternatives receive the same cap. Ordinary guidance is not changed.
- **M1 rationale:** the old preset used the largest product review-plus-lead interval to raise global cover. The planner already adds lead before cover. The preset now chooses global cover using only the existing/recipe cover, then raises each insufficient product cover to its own effective review interval through a product override. Supplier/product review precedence and existing larger product cover are preserved; no product can inflate another product. The new field accepts the existing 0–36 numeric range only for product overrides, not supplier overrides.

## Observed failing-first and before/after reproductions

`node --test tests/v12-feature-fixes.test.mjs` first failed all five initial regressions for the intended missing behavior, before production edits. A sixth regression subsequently caught an explicit low product cover hidden beneath a larger global cover; its failing `1 != 3` assertion preceded the additional preset-floor fix. All six pass, including Python/JS parity and equal-global quantity checks at 0, .25, 2, 3 and 36 months. A seventh compatibility test compares full default-off forecast/guidance/explanation JSON to the exactly reconstructed pre-fix checkpoint without Git history.

- H1 adapter, cap 10, MOQ 12, pack 12, 7-day review: before suggested **72**, including a false “shelf cap respected” claim; after **no suggestion**, with the exact conflict fallback above. Full guidance additionally tests MOQ-only conflicts, pack-only conflicts and feasible whole/fractional packs. The ordinary engine rounds a physical sell-through ceiling down to a pack first, so the full pack-12/10-unit sell-through case reports cap 0; that existing arithmetic is deliberately unchanged.
- M1 supplied `floor.mjs` scenario: nine 10-day-lead products plus one 300-day-lead product. Before preset: **2,830 → 11,727**, all 10 affected, global cover 11 months. After: **2,830 → 2,830**, zero affected, global cover remains 2, no overrides needed. The original scenario was reproduced against `44eba83` and the candidate with the same months and raw inputs; its original harness is bound to another worktree and was not modified.
- Supplied `review-opus-2/me/p.csv`, 90-day review: before **648 → 1,054**, global cover 3⅓ months; after **648 → 946**, global cover 2, product A/B cover overrides 3 months, exactly two affected. The actual supplied CSV was read without modification.

Ignored evidence: `.scratch/v12-red.log`, `.scratch/v12-before-after.json`, `.scratch/v12-node.log`, `.scratch/v12-pytest.log`, `.scratch/v12-unittest-tests.log`, `.scratch/presets-browser-report.json`.

## Verification executed

Environment: `TMPDIR=<local-scratch>/v12/feat-fix`, `PYTHON=/usr/bin/python3`. No installs, network, push, ERP access or fleet admission command.

- `node --test --test-concurrency=2 tests/*.mjs`: **3,652 passed**, zero failed/skipped.
- `/usr/bin/python3 -m pytest -q`: **2,195 passed**.
- `/usr/bin/python3 -m unittest discover`: exits 0 but collects **zero**; not counted as coverage. Supplementary `/usr/bin/python3 -m unittest discover -s tests`: **338 passed**.
- `/usr/bin/python3 scripts/golden_diff.py`: all fields unchanged, never run with `--write`.
- `/usr/bin/python3 scripts/verify_import_examples.py`: **8/8 files**, all hashes unchanged.
- `/usr/bin/python3 scripts/check_docs.py`: **156 relative links / 72 JSON files**, zero problems after staging the new fixtures.
- `node docs/capture-polish.cjs --label after --guard-only`: pass with exact reviewed-delta restoration and all existing pins retained.
- External unmodified `<local-scratch>/sr-r3-prep/run_r3.sh "$PWD"`: **562 cases / 9,063 assertions**, zero failures; synthetic import and CLI parity.
- `scripts/sync_profit_order.py` followed by canonical `standalone/build.py`: exact authored module embedded. Rebuilt shipped page, all eight named design variants and the 1,000-product demo through repository scripts. Full Python build tests verify byte-identical regeneration.
- Extended `tests/presets-browser.cjs`: **32 checks** at 390/1440 × light/dark using isolated local Google Chrome Beta via `qa-chrome`; six recipe preview/apply/exact-undo cases, a nine-product-only floor/count/persistence case, and native no-shelf-life action per combination. Zero page errors/network requests/overflow. Node heap limited to 1 GB.

## History-free archive/default-off gate

A staged source-tree archive was extracted below `.scratch/v12-archive` and tested with `GIT_CEILING_DIRECTORIES` preventing discovery of the original repository. Node passed **3,652/3,652**, zero skips. The first archive pytest attempt exposed a pre-existing test dependency on the unavailable `v1.1-freeze` Git tag: **2,185 passed / 10 setup errors**, not accepted as a pass.

The test harness now prefers an exact SHA-pinned 34-file CLI-dependency snapshot from `v1.1-freeze` (`c3109d5c4ac7137d5c875db44c3e3a685ad1e82f`). Every extracted member was independently compared byte-for-byte with that Git object, and all original CLI-output comparisons remain active. Fixture `tests/fixtures/baselines/v1.1-freeze-cli.tar.gz` SHA-256: `4802d55bb7b854a3e80db2292f8963276afbd76c75db5766e65efc189d01b7bf`. No current-engine substitution and no skips.

After re-export, the **complete archive Node and Python suites passed: 3,652 and 2,195**, plus golden unchanged, eight import examples and capture guard. Per-process RSS sampling during those archive suites peaked at **325,744 KiB** (Node) / **269,328 KiB** (pytest), below 2 GiB. The documentation script returned zero checked files without Git and that result was not treated as coverage. Initializing the same export with one local root commit, zero remotes and a matching source/export Git tree then checked **156 relative links and 72 JSON files**, zero problems. The original tag is absent from that export. All evidence remains local and ignored; no branch was published.

## Opus review disposition — additional authority required

Independent `claude-opus-5-5` review confirms H1 cap propagation, product-specific quantities and default-off identity, but **does not sign off this candidate for release**. Its source review and synthetic probes found adjacent consumers outside the two explicitly authorized engine seams:

1. **High:** `why_this_amount`/`whyThisAmount` and product-detail copy still describe raw global cover, although the new quantity uses product cover. Reproduced independently: a 3-month product override gives quantity 300, but the sentence says “2 months cover.” CLI and Desktop risk specs also still read global cover and can simulate the wrong horizon. Fixing these requires explicit expansion to the pinned attribution helpers, `stock_runway.py` risk input, and Desktop display consumers. They were not silently edited in this packet.
2. **Medium:** attribution for manual product zero-cover/global nonzero (and the inverse) reads the global switch; totals still reconcile but labels can be wrong. Same additional input-consumer seam is needed.
3. Product cover is an ordinary override, not a permanent automatic floor: later global cover edits do not replace it. Documented explicitly in the preset reference; no precedence change is authorized here.
4. Reviewer questions the MOQ/pack fallback wording for a zero ceiling with default pack 1 and no explicit MOQ. This candidate preserves the requested exact fallback whenever no positive grid quantity fits, including zero caps; the adapter regression makes that decision explicit. A different zero-cap reason/precedence requires owner disposition, not an unreviewed message change.

The callback replacement hardening suggested by review was applied to the delta-restoration helper; no production bytes changed for that adjustment. Low-priority candidate-set presentation and large-preview performance suggestions are not part of this fix.

Not checked: live ERP, installed Hermes Desktop, physical Safari/iPhone hardware, hosted release, industry-performance or real-money outcomes. The adjacent cover explanation/attribution/risk findings above remain unresolved and are release blockers, not passing checks.

## Authorized cover-consumer and zero-cap follow-up (supersedes open items above)

The owner expanded scope to cover explanations, zero-cover attribution, Desktop/offline product detail and risk-display inputs, and CLI risk inputs. All read the existing `resolve_order_settings` / `resolveOrderSettings` product-resolved cover; none changes forecast or order arithmetic. The profit adapter's explanatory cover now also reads its resolved settings when called directly with raw global settings. An explicit product cover of zero is retained (not replaced by a truthy fallback). The Arctic product inputs report identifies product cover as **Product**, not **Default**.

For a cap with no positive six-decimal quantity tick, including cap 0, the unavailable reason is now exactly **Shelf life is too short for any order to be sold in time; using standard amount.** A positive cap forced below the minimum order or pack grid still uses the MOQ/pack conflict reason. The same eligibility condition withholds the same suggestions as before; only wording changes. The engine's pre-existing rounded shelf cap and ordinary order quantities are untouched.

### Additional exact protected deltas

[`../../../tests/fixtures/v12-display-approved-delta.json`](../../../tests/fixtures/v12-display-approved-delta.json) records two exact engine spans and six Desktop spans against `ce20b2d`. SHA-256 `f5cce9e9de3ad2108054c4b464870ea0d423816ec8646a9714384429e6d65181` is pinned in `tests/reviewed-display-delta.cjs`. These restore `ce20b2d` before the original H1/M1 restoration. The spans cover only unavailable-reason/adapter text, ledger input selection, why-text, and Desktop detail/risk display. The original H1/M1/preset fixtures, approved forecast blocks, immutable baseline pins and goldens are unchanged. Tests compare full restored-file hashes to the original `ce20b2d` blobs and reject unknown mutations; no exclusions or broad hash refresh.

### Failing-first and quantity identity proof

All six `tests/resolved-cover.test.mjs` regressions failed before edits: quantity **300** was already correct but why-text said **2 months cover**, zero-cover attribution used global policy, a direct profit adapter call said **60-day** rather than **90-day** cover, cap 0 claimed MOQ/pack conflict, and CLI/Desktop/offline risk and input reports read global cover. They now pass with Python/JS explanation, attribution and adapter parity; ledgers still exactly reconcile.

`tests/display-quantity-identity.test.mjs` and `tests/quantity_identity_bridge.py` reconstruct `ce20b2d` without Git history and compare exact ordinary, uncapped, shelf-cap, suggested-profit and alternative quantities before/after in both languages. The SHA-pinned compressed synthetic fixture contains **573 datasets**, including all **558 parsed R3 cases** (eight ERP examples included), every golden input, the sample, the actual supplied reviewer `p.csv` before/after preset settings and the M1 long-lead reproduction. Each also runs product-cover 0 and 3 controls: **1,719 dataset/settings combinations**, plus **eight opt-in profit/shelf-life combinations** with exact before/after suggestion and alternative quantities (**1,727 total**) and exact cross-language parity. The four rejected R3 cases are separately retained by the unmodified external kit, not converted to synthetic quantities. Fixture SHA-256: `c4aad32e2b16491c4259d847ab255e6d362dc7f2b09a627285bc06c322f0a17a`.

The external unmodified R3 kit ran on `ce20b2d` before edits and again on the follow-up: both **562 cases / 9,063 assertions / zero failures**. Exact extracted quantity comparisons also passed for **1,568 case/runtime pairs** (562 Python, 562 JS, 444 original-CSV CLI runs). Golden comparison and all eight imported-example hashes remain unchanged.

### Follow-up gates executed

- `node --test --test-concurrency=2 tests/*.mjs`: **3,660 passed**, zero failed/skipped.
- `/usr/bin/python3 -m pytest -q`: **2,195 passed**.
- `/usr/bin/python3 -m unittest discover -s tests`: **338 passed**.
- `/usr/bin/python3 scripts/golden_diff.py`: every field unchanged, never `--write`.
- `/usr/bin/python3 scripts/verify_import_examples.py`: **8/8**, all hashes unchanged.
- `/usr/bin/python3 scripts/check_docs.py`: **156 links / 73 JSON files**, zero problems.
- `node docs/capture-polish.cjs --label after --guard-only`: pass, original pins retained.
- External `run_r3.sh "$PWD"`: **562 cases / 9,063 assertions**, zero failures.
- `scripts/sync_profit_order.py --check`: exact authored/embedded module. Canonical builder regenerated the shipped HTML, eight named variants and 1,000-product demo; full build tests confirm byte identity.
- Extended `tests/presets-browser.cjs`: **36 checks**, **390/1440 × light/dark**, Chrome Beta **159.0.8154.13** through `qa-chrome`. All original preset preview/apply/exact-undo checks plus visible product report **3 months / Product**, matching why-text and resolved risk input. Zero page errors, HTTP(S) page requests or overflow. A first added report-visibility probe toggled an already-persisted detail view closed; the harness now respects the real existing toggle state and the full matrix passes.
- Final Node/pytest runs sampled descendant processes every 200 ms: peaks **309,504 KiB / 257,328 KiB**, each below 2 GiB. Node heap capped at 1 GiB.

Evidence: ignored `.scratch/resolved-red.log`, `.scratch/display-focused.log`, `.scratch/display-node-final.log`, `.scratch/display-pytest-final.log`, `.scratch/display-unittest.log`, `.scratch/display-memory-receipts.json`, `.scratch/r3-before/`, `.scratch/r3-after.log`, `.scratch/presets-browser-report.json`. No installs, push, ERP access or `gv-lane`. The attempted CLI review preflight found Claude Code logged out; review uses the configured Opus read-only reviewer route instead, without touching credentials.

### Independent whole-change Opus re-review — local candidate signed off

The single requested Opus re-review covered **`44eba83` (`ce20b2d^`) through `715e26d62d4698f9ab9956b87e63bbd7eef0d3c6`**, including the original H1/M1 changes and this consumer/wording follow-up. Trusted native runtime metadata confirms **Anthropic `claude-opus-5-5`, high effort**, normal completion, no truncation. Verdict: **SIGN-OFF for the local candidate; no blockers. This is not a live-release approval.** No production or test fixes were requested after review.

The reviewer independently reran **18 focused Node checks**, golden comparison, exact module sync and **107 focused Python checks**. Its separate full-archive synthetic probe reported **500 seeded cases / 1,475 products**, checking `44eba83`, `ce20b2d` and the candidate in Python and JS: zero follow-up quantity/suggestion/alternative differences and zero final parity mismatches. The reviewer also checked the original default-off identity, cap propagation, resolved cover/zero-cover labels and CLI risk consumers. Its full historical profit-adapter comparison complements the committed bridge, whose reconstructed engine intentionally shares current dependencies.

Nonblocking observations were retained without expanding scope: normalized raw-only preset-helper callers retain pre-existing behavior; restoration helpers rely on their immutable outer hash guards for out-of-span mutations; product cover remains an ordinary override rather than a permanent automatic floor. No blockers remain from the earlier Opus list.

A bounded outside-family `deepseek-flash` read-only second-check corroborated the controller's suite, browser, R3 and memory headline counts with no discrepancies. Parent reran all **18 focused checks** after review, confirmed the reviewed commit and clean source tree, and obtained **ACCEPT / DONE / zero reasons** from the existing `accept_result.py` evidence checker. Review/runtime/acceptance evidence is in ignored `.scratch/review-acceptance/`; observer receipt append and trusted model-route metadata were checked. This closing documentation records the review; all code, generated HTML, fixtures and tests remain byte-identical to the signed-off `715e26d` candidate.

Not checked: live ERP, installed Hermes Desktop, Safari or physical iPhone, hosted release, production data or real-money outcomes. No release/publish action was taken.
