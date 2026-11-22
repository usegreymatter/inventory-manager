Lifecycle: living

# Industry setup guides

These presets are **setup guides** for ordering cadence, verified shelf-life prompts and explanations, not better-ordering algorithms or safety/compliance controls. **They do not change order amounts on their own from General defaults.** They do not place orders. Confirming an ordinary-setting change (such as raising insufficient cover or resetting custom settings with General) can change amounts; the preview shows that separately.

Independent synthetic gate `v12-stress3/stress/results/redesigned-gate-both` rejected Pharmacy's proposed 99% model service target: monthly net-profit delta −1649, 95% interval [−2906, −401], with approximately zero fill gain. The weekly aggregate was inconclusive, but one family showed significant profit harm, so the weekly gate also failed. That automatic service change is removed. Gate `v12-stress3/stress/results/redesigned-gate-no99` rates the remaining guides **QUALIFIED_SYNTHETIC_ONLY**: the five non-General guides produce exact quantity no-ops versus General at 7- and 30-day ordering cadence; General is the baseline. This is evidence of no additional quantity policy in that synthetic comparison, **not superiority**, guaranteed service or real-world performance. Archived unchanged summaries: [with automatic 99%](history/changes/redesigned-gate-both.json), [without automatic 99%](history/changes/redesigned-gate-no99.json), and [quantity proof for both comparisons](history/changes/redesigned-gate-quantity-proof.json).

## Review, apply, undo

Desktop: All settings → Industry starting points. Offline page: Settings → Industry starting points. Choose General, Grocery/food, Pharmacy, Fashion/seasonal, Spare parts or Electronics. Choosing opens a preview, not a save. Every changed setting shows old → new and its reason. Confirm apply writes ordinary settings; Cancel changes nothing. An already-matching recipe cannot be confirmed.

The preview asks **“How often do you place orders?”** and uses the existing `review_days` as the actual ordering interval. Change that field in Ordering first if it is wrong. A recipe never silently changes cadence. Product/supplier review overrides are included in each product’s cover floor; lead time is already included by the planner and is not added again. Defaults are monthly ordering, not a daily/weekly assumption.

With current product data loaded, both surfaces run the real forecast/order engine before and after the proposed changes. Preview displays the number of products with changed order quantities, total before → after order quantity and signed change. Products for which either calculation has no numeric quantity are counted separately as unavailable, not counted as zero. Without product data, impact is explicitly unavailable. Quantities summed across different units are a review indicator, not a monetary total or a purchase instruction.

**Only a product’s insufficient cover may be raised to its own review interval via `product_overrides[sku].months_of_cover`. Other product fields, supplier overrides and global shelf assumptions stay unchanged.** No bulk override replacement is offered. Existing precedence remains. There is no background synchronizer; no recipe name drives order maths. Undo restores the exact prior settings, including absent keys, maps and unrelated settings. It stays available for the latest apply until a settings/dataset change; Undo history does not survive reload. Existing dataset/device persistence is unchanged.

## Exact recipes and reasons

Machine-readable source snapshot: [`presets.json`](presets.json). Tests require exact equality with `INDUSTRY_SETTING_PRESETS` in `desktop/plugin.js`. Stress consumers must apply the dynamic floor below, not just copy the literal recipe settings.

All recipes use the existing 30-day-month convention:

```text
chosen global months_of_cover = max(current months_of_cover, recipe months_of_cover)
chosen product cover = product override if present, otherwise chosen global cover
product floor = effective review_days / 30
if product floor > chosen product cover:
    product_overrides[sku].months_of_cover = product floor
```

Effective review intervals use normal file/supplier/product precedence. A product floor never raises global cover or another product’s cover; supplier lead time never contributes to the floor, because the planner already adds it before cover. Existing larger product cover is preserved. A saved product cover is an ordinary override, not a continuously synchronized floor: later global cover edits do not replace it. To inherit global cover again, remove that product’s `months_of_cover` key in settings JSON or use the product’s Reset to defaults (which also clears its other overrides), then review the preview again. Without products, no product overrides are generated and impact is unavailable. An effective review interval exceeding the supported 36-month cover limit blocks Apply; later manual cadence edits require a fresh review. This is input resolution, not a new quantity formula or a universally optimal stock target.

| Button (key) | Literal ordinary settings proposed | Reason |
| --- | --- | --- |
| General (`general`) | `forecast_method=current`, `months_of_cover=2`, `service_level=0.95`, `buffer_days=0` | Preserve v1.1 defaults when starting from defaults, with actual cadence retained and cover never cut. Explicit General selection may reset a custom method/service/buffer; preview shows that. |
| Grocery/food (`grocery`) | `months_of_cover=2` | Withdraw the failed seven-day-cover/two-day-ordering assumption. Use broad cover; shelf life must be verified per product. |
| Pharmacy (`pharmacy`) | `months_of_cover=2` | Setup guide only; preserve the user's model service target. The automatic 0.99 target failed the independent monthly profit gate and is withdrawn. |
| Fashion/seasonal (`fashion`) | `months_of_cover=2` | Withdraw the failed 15-day-cover/weekly-ordering assumption and forced last-year forecast. Review season-end products individually. |
| Spare parts (`spare-parts`) | `months_of_cover=2` | Withdraw the failed one-month-cover/weekly-ordering assumption and forced SBA. Preserve the user's forecast choice. |
| Electronics (`electronics`) | `months_of_cover=2` | Withdraw the short-cover/weekly-ordering assumption and forced SES; no blanket obsolescence cap. |

The table's cover value is a **floor**, not an overwrite of larger current cover. Only General resets method/buffer/service to v1.1 defaults. Other recipes preserve method, buffer and service, including Pharmacy. The separate manually editable 0.99 setting remains available; it is not selected by any industry guide. They leave lead defaults, MOQ, pack, economics, stockout correction, learning and every unlisted field unchanged. They do not force seasonal_naive, SBA, SES, Auto or Recommended. Recommended per product remains a separate opt-in choice. Model service level is not a guaranteed fill rate.

All six guides match General quantities for default-configured shops in the independent weekly/monthly gate. They are intentionally conservative and **not eligible for a superiority claim**. The failed aggressive recipes and automatic Pharmacy service increase are withdrawn rather than presented as improvements.

## Shelf life is a product fact, not an industry default

No recipe writes, clears or guesses `shelf_life_days`, `arrival_age_days` or `min_remaining_life_days` globally. Preview prompts the user to enter verified values only for applicable products or import shelf/lot/expiry columns. Unknown total life stays blank; mixed catalogues do not get a blanket 14-day cap. Existing manually configured global values are not silently removed by a recipe.

Global total shelf life still requires an integer from 1 to 36500. Product settings accept positive integers or an explicit **no shelf life**: JSON `null`, numeric `0`, or string `"none"`. These values persist and disable that product's shelf-life cap even when a global total exists. An absent override means inherit; explicit `null` does not mean inherit. Boolean false, negative/fractional life, arbitrary strings and unknown keys remain invalid. Age/acceptance margins retain the existing integer ranges. Actual lot-expiry warnings and FEFO stock treatment remain active; disabling a guessed total-life cap does not erase lot facts.

CSV/XLSX/ERP shelf cells accept `none`, `null` or `0` as explicit opt-outs (case-insensitive text), canonicalized to product `null`. Blank cells are absent/inherit. Settings JSON `"null"` and `"0"` are deliberately not aliases: use JSON null or numeric zero. Offline product settings offer **No shelf-life cap** and show explicit disabled values as 0, distinct from a blank inherited value. Reset removes the product override. Python and JavaScript resolve these values identically, including the separate profit-estimate inputs. Commercial clearance prompts are not food/medicine safety controls.

## Compatibility and verification

The existing `industry_preset` names (`none`, `distributor`, `retail`, `spare-parts`, `restaurant`, `pharmacy`, `seasonal`, `ecommerce`) remain importable and advisory. The CLI's existing `--preset` behavior/names are unchanged; it is not an alias for these UI recipes. The separate Use suggested method action still changes only `forecast_method`. CLI settings JSON accepts the same product opt-outs.

Focused checks: `node --test tests/preset-redesign.test.mjs tests/presets*.test.mjs` and `python3 -m pytest -q tests/test_product_no_shelf.py tests/test_preset_storage.py`. Full Node/Python suites, `scripts/golden_diff.py`, `scripts/verify_import_examples.py` and `scripts/check_docs.py` remain release gates. Generated standalone HTML is rebuilt by integration, not committed by this lane. Local Chromium acceptance covers preview/count/apply/undo at 390px; this is not a physical phone, Hermes Desktop runtime or independent industry-performance test.
