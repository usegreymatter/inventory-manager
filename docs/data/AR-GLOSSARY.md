# Arabic glossary — draft, not production-approved

Status: draft Modern Standard Arabic for Inventory Manager, awaiting Kuwait inventory-operator
and Arabic-language review. This is terminology preparation, not a translated UI or RTL
verification. Existing reference: `../terminology.md`. Future feature policy and chip states:
`ORDER-BUILDING-SPEC.md`. English source terms remain the translation keys' meanings; do not
translate CSV headers, SKU values, schema keys, enum tokens or cryptographic payloads.

## Usage and review rules

- Use the same stable string ID across Desktop, standalone, drawer, CLI/chat, tool cards and
  exported human-readable reports. Keep canonical data keys unchanged.
- Prefer standard Arabic inventory terms, with plain help and familiar English abbreviations
  in parentheses. Never translate “service level” as a guarantee. Risk is the complement of
  cycle service, not the fill-rate percentage or the confidence of a forecast.
- MOQ is الحد الأدنى لكمية الطلب; an ERP price-break quantity is not automatically MOQ.
  Pack size means a purchasing multiple; it need not be a carton. This refines the narrower
  existing glossary wording عدد الوحدات في الكرتون, without editing that reference.
- No grammatical gender or plural is inferred from a SKU. Use localized plural templates for
  quantities; review zero, one, two, few and many. A unit dictionary may need singular/dual/
  plural forms; do not append English-style “s”.
- RTL layout/text uses logical spacing. Isolate SKUs, ISO dates, file names, decimal values,
  currency codes, CSV headers and formulas as LTR. Keep chart chronology and numeric axes
  LTR; translate labels, not month ordering or arithmetic. Do not insert invisible bidi
  characters into exported machine identifiers.
- Display locale must not alter decimal computation, unit conversion or signed bytes. Arabic
  number presentation, date presentation and month names require explicit locale review.
  Raw CSV/JSON values stay canonical. KWD remains the machine currency code.
- Hidden is an internal state, not a visible chip. Locked describes missing/invalid evidence,
  not account permissions. On means a usable capability, not a successful order or guarantee.
- All English feature chips below have one to three words. Arabic copy has no artificial
  three-word requirement. Long explanations belong in the drawer, not the main screen.
- “Signed” and “Verified” refer only to offline file binding/MAC checks. They do not establish
  identity, management authority or access control. Retain that warning in Arabic exports.

## CSV-readiness chips — draft, needs native review

These are diagnostic preflight labels, not proof a feature is implemented or ready for approval.

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Stockout adjustment | تعديل الطلب بسبب نفاد المخزون | Lost-sales exposure correction only when justified. |
| Incoming orders | طلبات التوريد القادمة | Outstanding supplier supply; overdue requires review. |
| Customer orders | طلبات العملاء | Confirmed undelivered demand. |
| ABC / XYZ | تصنيف الأهمية ونمط الطلب | Keep ABC/XYZ in help; two independent classifications. |
| Supplier group | مجموعة المورد | Readiness to group compatible supplier lines. |
| Allocate stock | تخصيص المخزون | Distribute available quantities without duplication. |
| Alternatives | البدائل | Approved substitute items, not any similar product. |
| Add together | الإضافة معًا | Complement relationships; not automatic extra demand. |
| Kit parts | مكونات المجموعة | Mandatory linked components only when confirmed. |
| Replaced product | منتج مستبدل | Lifecycle predecessor/successor relation. |
| Rule health | سلامة قواعد إعادة الطلب | Read-only rule diagnostics, not ERP changes. |

## A. Shared states, navigation and existing product vocabulary

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Inventory Manager | مدة كفاية المخزون | Product name may remain Inventory Manager with this descriptor. |
| Hidden | مخفي | No feature chip is rendered. |
| Locked | يتطلب مراجعة | Missing data/policy or a conflict; not a locked user account. |
| On | مفعّل | Inputs valid for this feature. |
| Basic | أساسي | Simple fallback; not a confidence grade. |
| Data health | سلامة البيانات | Completeness, validity and consistency. |
| Why this number | لماذا هذه الكمية؟ | Calculation explanation drawer. |
| All settings | جميع الإعدادات | Existing settings entry. |
| Advanced | إعدادات متقدمة | Optional specialist settings. |
| Order today | طلبات اليوم | Queue heading; no automatic placement. |
| Order now | اطلب الآن | Urgent item status. |
| Order soon | اطلب قريباً | Upcoming order-by date, after lead-time allowance. |
| OK | كافٍ حالياً | No earlier warning applies. |
| Overstocked | مخزون زائد | Above configured cover threshold. |
| No sales | بدون مبيعات | Observed lack of recent sales, not missing history. |
| Not enough history | بيانات غير كافية | Existing bucket includes other planning-data gaps too. |
| Needs data | يحتاج إلى بيانات | Required facts are absent or invalid. |
| Out of stock | نفاد المخزون | Current state; distinguish forecast running low. |
| Running low | المخزون يوشك على النفاد | Forecast warning, not current zero. |
| Order by | اطلب بحلول | Latest planned ordering date; preserve inclusive meaning. |
| Runs out | ينفد في | Estimated physical run-out date. |
| Suggested order | الكمية المقترحة للطلب | Estimate, not an executed purchase order. |
| Order quantity | كمية الطلب | Quantity to buy in the declared unit. |
| Order cover | تغطية الطلب | How long the order should last after arrival. |
| Each order should last (months) | مدة كفاية كل طلب (بالأشهر) | Existing cover control. |
| Lead time | مدة التوريد | Days from placing an order to delivery. |
| Default delivery time | مدة التوريد الافتراضية | Fallback only when item lead is unknown. |
| Safety stock | مخزون الأمان | Extra stock for delays or unexpected demand. |
| Reorder point | نقطة إعادة الطلب | Stock threshold for initiating replenishment. |
| MOQ | الحد الأدنى لكمية الطلب | Minimum order quantity accepted by supplier. |
| Minimum order quantity | الحد الأدنى لكمية الطلب | Same concept as MOQ. |
| Pack size | مضاعف التعبئة للطلب | Purchase in multiples of this base-unit quantity. |
| On order | قيد الطلب | Ordered but not received; may be undated. |
| Unit cost | تكلفة الوحدة | Cost per base unit, same currency. |
| EOQ | الكمية الاقتصادية للطلب | Most economical order size under stated cost assumptions. |
| Most economical order size | حجم الطلب الاقتصادي | EOQ is a candidate, not a mandatory minimum. |
| Service level | مستوى الخدمة | Chosen cycle-service target, not guaranteed performance. |
| Risk of running out | احتمال نفاد المخزون | Complement of the cycle-service target. |
| Some risk | احتمال نفاد أعلى | Existing 90% choice: about 1 cycle in 10 at risk under assumptions. |
| Low risk | احتمال نفاد منخفض | Existing 95% choice: about 1 cycle in 20. |
| Very low risk | احتمال نفاد منخفض جداً | Existing 99% choice: about 1 cycle in 100. |
| Review period | فترة المراجعة | Days between buying reviews/orders. |
| Ordering cost | تكلفة إصدار الطلب | Shipping/admin cost per order under declared model. |
| Cost per order | تكلفة كل طلب | Same cost concept. |
| Holding cost | تكلفة الاحتفاظ بالمخزون | Annual cost percentage, not stock value. |
| Demand variability | تفاوت الطلب | Existing sales-pattern descriptor. |
| Steady | مستقر | Display bucket, not certainty. |
| Up and down | متذبذب | Moderate variation. |
| Very uneven | شديد التفاوت | High variation. |
| Lean | مقتصد | Smaller explicit cover/buffer scenario. |
| Recommended | موصى به | Selected default policy, not an optimum. |
| Stock-up | تعزيز المخزون | Larger explicit cover/buffer scenario subject to caps. |
| Plan confidence | موثوقية التقدير | Historical evidence for the displayed plan, not a promise. |
| Forecast quality | جودة التنبؤ | Evaluation of the actual displayed method. |
| Big-order check | مراجعة الطلب الكبير | Warning for unusually large purchases. |
| Overstock threshold | حد المخزون الزائد | Configured months-of-stock boundary. |
| Supply gap | فجوة التوريد | Demand precedes timely available supply. |
| Check item data | راجع بيانات الصنف | Unplannable item; no invented quantity. |
| Item | الصنف | Existing compact-table heading. |
| Product | المنتج | Product detail/name. |
| Stock | المخزون | Context determines physical or usable. |
| Per month | شهرياً | Rate/quantity per calendar month. |
| Month | الشهر | Timeline/table heading. |
| Now | الآن | Snapshot boundary in a chart, not necessarily wall-clock time. |
| Delivered | الكمية المستلمة | Observed receipt quantity in a time bucket. |
| Past sales | المبيعات السابقة | Historical sales disclosure. |
| Forecast demand | الطلب المتوقع | Separate visually from observed history. |
| Historical demand | الطلب التاريخي | Observed demand series. |
| On-hand inventory | المخزون الفعلي | Gross physical stock before unusable-state exclusions. |
| All | الكل | Existing filter. |
| All SKUs | جميع رموز الأصناف | Flat item browser. |
| By type | حسب الفئة | Category grouping. |
| Other | أخرى | Missing category, not a synthetic SKU. |
| Look ahead | أفق التوقع | Forecast horizon control. |
| Open full page | افتح الصفحة الكاملة | Quick-view navigation. |
| Quick view | عرض سريع | Compact inventory view. |
| Sample | بيانات تجريبية | Synthetic/demo source. |
| My file (CSV) | ملفي (CSV) | Local user-selected source. |
| Load CSV | تحميل ملف CSV | Local reading, not network upload. |
| Choose another file | اختر ملفاً آخر | Recovery action. |
| Back to sample data | العودة للبيانات التجريبية | Recovery action. |
| Copy purchase order | نسخ مسودة طلب الشراء | Copy text only; does not send/place an order. |
| Reset to defaults | استعادة الإعدادات الافتراضية | Clears applicable local overrides. |
| Planning (optional) | التخطيط (اختياري) | Existing advanced section. |
| Costs (optional) | التكاليف (اختياري) | Existing advanced section. |
| Add safety stock to suggested orders | إضافة مخزون الأمان إلى الكميات المقترحة | Existing optional behavior, not silently changed by spec. |
| Turn off safety stock | إيقاف إضافة مخزون الأمان | Does not erase the physical stock forecast. |

## B. Phase 4 feature chips

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Needs replacement | يتطلب بيانات البديل | Missing successor history parameters. |
| Replacement history | سجل الصنف السابق | Enabled history carryover, not stock transfer. |
| Needs similar item | يتطلب صنفاً مماثلاً | Analog/scale not confirmed. |
| Similar item | صنف مماثل | Explicitly chosen forecast analog. |
| Check substitutes | راجع البدائل | Eligibility/allocation unresolved. |
| Substitute plan | خطة البدائل | Conserved fulfillment plan. |
| Needs coverage | يتطلب تحديد التداخل | Must state whether companion demand is already embedded. |
| Linked demand | طلب مترابط | Valid ratios with explicit coverage mode. |

## C. Phase 5 feature chips

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Needs costs | يتطلب بيانات التكلفة | Incomplete annual cost ranking. |
| ABC priority | أولوية ABC | Consumption value at cost, not business criticality alone. |
| Needs history | يتطلب سجلاً تاريخياً | Missing complete eligible months. |
| XYZ pattern | نمط XYZ | Variation class independent of ABC. |
| Check service | راجع مستوى الخدمة | Class/criticality or target unresolved. |
| Service target | مستوى الخدمة المستهدف | Cycle-service assumption. |
| Needs supplier | يتطلب تحديد المورد | Unknown supplier on a selected line. |
| Supplier order | طلب المورد | Grouped proposed lines; not a placed PO. |
| Needs limits | يتطلب حدوداً | Active resource limits unknown/violated. |
| Shipment fit | الشحنة ضمن الحدود | Every active limit checked. |
| Needs headroom | يتطلب سعة متاحة | Cannot yet offer a feasible top-up. |
| Add to shipment | أضف إلى الشحنة | Opt-in suggestion; triggers a new proposal revision. |
| Needs site demand | يتطلب طلب المستودع | Warehouse forecast shares/routes/mapping missing. |
| Transfer first | حوّل أولاً | Timed internal transfer before new purchase. |
| Check allocation | راجع التخصيص | Conflicting or incomplete shortage assignment. |
| Shortage plan | خطة العجز | Allocated scarce units with unmet demand visible. |
| Check order limits | راجع حدود الطلب | MOQ/maximum/pack conflict. |
| Order limits | حدود الطلب | Positive quantity fits all item constraints. |

## D. Phase 6 feature chips

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Resolve issues | عالج المشكلات | Proposal blocked by unresolved evidence/constraints. |
| Signed proposal | مقترح محمي برمز تحقق | Shared-key MAC, not a personal/public-key signature or identity proof. |
| Verify proposal | تحقّق من المقترح | Imported file not yet verified or verification failed. |
| Verified approval | موافقة متحقّق منها | Exact offline file binding only; not identity proof. |
| Arabic draft | ترجمة عربية أولية | Language/RTL review not complete. |
| Arabic ready | العربية جاهزة | Requires actual human review and UI proof. |
| Needs rule data | يتطلب بيانات القواعد | Missing export or unknown semantics. |
| Rule check | مراجعة قواعد الطلب | Offline diagnostic, no ERP write. |

## E. Planning concepts used in the specification

These terms are drawer/help/report vocabulary, not extra main-screen chips. Technical
pseudocode identifiers such as `max_order_qty` stay unchanged; their human meanings are below.

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Supersession | إحلال صنف محل آخر | Feature label; directed lifecycle relationship. |
| New-product analog | صنف مرجعي لمنتج جديد | Feature label; explicit comparator and scale. |
| Substitutes | البدائل | Feature label; requires accepted compatibility. |
| Complements/kits | الأصناف المكمّلة والمجموعات | Feature label; ratios and coverage mode required. |
| ABC | تصنيف ABC | Feature label; annual consumption value at cost. |
| XYZ | تصنيف XYZ | Feature label; eligible-month variation pattern. |
| Service presets | إعدادات مسبقة لمستوى الخدمة | Feature label; proposed policy, not a guarantee. |
| Shipment caps | الحدود القصوى للشحنة | Every active resource limit applies. |
| Shipment suggestions | مقترحات إضافات الشحنة | Optional only, never automatic buying. |
| Warehouse transfers | التحويلات بين المستودعات | Directed timed moves, not stock writes. |
| Shortage allocation | تخصيص المخزون عند العجز | Preserve units and show unmet demand. |
| Offline proposal | مقترح دون اتصال | Frozen exported calculation. |
| Offline approval | موافقة دون اتصال | File-bound review, not authorization control. |
| Arabic/RTL | العربية واتجاه العرض | Language and layout feature gate. |
| Reorder-rule check | مراجعة قواعد إعادة الطلب | Feature label; source export only. |
| New | جديد | At most one new-feature indicator per release. |
| Chart | الرسم البياني | No hidden change to dates, ratios or chronology. |
| Status | الحالة | One primary urgency status per item. |
| Order-by date | آخر موعد للطلب | Inclusive order deadline under saved assumptions. |
| Inventory draw | السحب من المخزون المتاح | Customer demand less exact reserved-order relief. |
| Customer demand | طلب العملاء | Full demand used for companion ratios. |
| SKU | رمز الصنف | Keep original identifier exactly, LTR-isolated. |
| Base unit | وحدة القياس الأساسية | Unit in which this SKU's stock and demand are expressed. |
| Purchase unit | وحدة الشراء | Convert explicitly before purchase rounding. |
| Sales unit | وحدة البيع | May differ from base/purchase units. |
| Unit conversion | تحويل وحدات القياس | Explicit positive factor. |
| Conversion factor | معامل التحويل | Target units per source unit. |
| Issue quantum | أصغر كمية للصرف | Smallest confirmed issue unit, not necessarily purchase pack. |
| Box | صندوق | Generic sample unit; review كرتون if local product packaging requires it. |
| Bag | كيس | Sample adhesive/grout unit. |
| Piece | قطعة | Sample edge unit. |
| Unit | وحدة | Generic fallback. |
| m² | متر مربع | Area, not a box count. |
| CBM | الحجم بالمتر المكعب | Cubic meters; volume per unit or shipment total. |
| Weight | الوزن | Separate from volume. |
| kg | كغ | Kilograms. |
| Currency | العملة | One declared currency per comparison/group. |
| KWD | دينار كويتي | Keep KWD in machine files. |
| Gross on-hand | إجمالي المخزون الفعلي | Includes disjoint blocked/reserved states. |
| Usable stock | المخزون المتاح للاستخدام | Gross less damaged, quarantine, returns and reservations. |
| Physical stock | المخزون الفعلي | Actual stock; a proposal does not change it. |
| Damaged | تالف | Unusable state included in gross. |
| Reserved | محجوز | Reserved for a specific obligation, not freely allocatable. |
| Quarantine | قيد الفحص والحجز | Unavailable pending release. |
| Returns | مرتجعات قيد المعالجة | Unavailable return-pending state in this contract. |
| Free to use | متاح للاستخدام | Do not silently equate gross and free stock. |
| Snapshot date | تاريخ لقطة البيانات | Close-of-day stock/source anchor. |
| Planning date | تاريخ التخطيط | Explicit scenario date, not inferred current time. |
| Data freshness | حداثة البيانات | Age under an explicit freshness rule. |
| Stale data | بيانات قديمة | Outside the saved freshness rule. |
| Manifest | بيان حزمة البيانات | Version, date, currency and provenance. |
| Synthetic data | بيانات اصطناعية تجريبية | Not live company stock. |
| Provenance | مصدر البيانات وتسلسلها | Where a fact or adjustment came from. |
| Assumption | افتراض | Explicit, not a business fact. |
| Override | قيمة بديلة يحددها المستخدم | Saved value/reason; does not silently waive constraints. |
| Calculation trace | تسلسل الحساب | Auditable named steps. |
| Waterfall | تسلسل أثر التعديلات | Visual breakdown, not a second forecast. |
| Baseline | الطلب الأساسي | Forecast before named adjustments. |
| Simple average | المتوسط البسيط | Fallback benchmark. |
| Backtest | اختبار على بيانات سابقة | Held-out forecast evaluation. |
| Out-of-sample error | خطأ التنبؤ خارج عينة التدريب | Not fitted residuals. |
| Forecast range | نطاق التنبؤ | Range under explicit coverage assumptions. |
| Rough range | نطاق تقريبي | Not calibrated confidence. |
| Confidence interval | فاصل الثقة | Distinguish from service policy and prediction range. |
| Band coverage | نسبة احتواء نطاق التنبؤ | Measured coverage of observed outcomes. |
| Protection horizon | أفق الحماية | Demand window protected by stock and buffer. |
| Cover horizon | أفق التغطية | Explicit purchasing cover endpoint. |
| Seasonality | الموسمية | Needs sufficient eligible history and baseline comparison. |
| Trend | اتجاه الطلب | Not inferred automatically from thin history. |
| Demand change % | نسبة تغير الطلب | Explicit adjustment applied once. |
| Intermittent demand | طلب متقطع | More than half eligible months are observed zeros. |
| In-stock days | أيام توفر المخزون | Used only under stated lost-sale assumptions. |
| Stock-out correction | تصحيح أثر نفاد المخزون | Corrects censored sales; not valid by default with backorders. |
| Backorder | طلب مؤجل لنقص المخزون | Customer waits; not necessarily lost sales. |
| Lost sale | مبيعات مفقودة | Customer demand lost during unavailability. |
| Project sales | مبيعات المشاريع | Whole flagged month excluded from baseline here. |
| One-off sales | مبيعات استثنائية | Explicitly flagged, not blindly removed as an outlier. |
| Eligible history | سجل صالح للتخطيط | Complete and valid after explicit exclusions. |
| Committed demand | طلبات عملاء مؤكدة | Confirmed undelivered orders. |
| Customer order | طلب عميل | Not a supplier purchase order. |
| Forecast included | مشمول في التنبؤ | Consumes baseline rather than adds again. |
| Netting | احتساب الصافي دون ازدواج | Reconcile baseline, commitments and supply once. |
| Reservation mapping | ربط الحجوزات بالطلبات | Link reserved quantities to exact confirmed lines. |
| Confirmed incoming | توريد وارد مؤكد | Remaining supply with valid dated availability. |
| Incoming purchase order | طلب شراء وارد | Supplier supply, not observed receipt. |
| PO line | بند طلب الشراء | Unique remaining-balance record. |
| Remaining quantity | الكمية المتبقية | Unreceived balance, not original ordered amount. |
| Confirmed | مؤكد | Count only under dated eligibility rules. |
| Draft | مسودة | Not counted as supply/commitment. |
| Cancelled | ملغى | Excluded, not silently rescheduled. |
| Overdue | متأخر | Expected date passed; new date needs confirmation. |
| Receipt | استلام | Observed completed receipt, not a future PO. |
| Promised date | التاريخ الموعود | Supplier promise, distinct from actual receipt. |
| Received date | تاريخ الاستلام | Actual receipt date. |
| Delivery date | تاريخ التسليم | Dated customer/supply event, with stated context. |
| Due date | تاريخ الاستحقاق | Explicit event date. |
| Lead-time spread | تفاوت مدة التوريد | Independent completed-PO observations required. |
| Typical lead time | مدة التوريد المعتادة | Statistical summary with stated method. |
| Slow case | حالة التأخر | Explicit slower lead-time scenario. |
| Date buffer | هامش زمني احتياطي | Not a second copy of quantity uncertainty. |
| Lifecycle | دورة حياة الصنف | Active, new, discontinued or superseded context. |
| Active | نشط | Eligible subject to other gates. |
| New product | منتج جديد | Launch-aware history; prelaunch zeros not observations. |
| Discontinued | متوقف عن التوريد | No automatic new purchase. |
| Predecessor | الصنف السابق | History source, not physically merged stock. |
| Successor | الصنف اللاحق | Final replacement destination. |
| History carryover | ترحيل السجل التاريخي | Attributed once; original observations preserved. |
| Effective month | شهر بدء السريان | Explicit boundary/window policy. |
| Launch month | شهر طرح المنتج | Starts eligible own-product observations. |
| Analog | صنف مرجعي مماثل | User-selected comparator, not automatic compatibility. |
| Scale | معامل التحجيم | Explicit analog demand assumption. |
| Blend weight | وزن المزج | Weight of own history versus analog rate. |
| Substitute | بديل | Requires confirmed eligibility. |
| Compatibility | التوافق | Size/shade/grade/customer acceptance. |
| Complement | صنف مكمّل | Does not itself block source sale. |
| Kit | مجموعة مترابطة | All required components needed together. |
| Ratio | نسبة الاحتياج | Target base units per source base unit. |
| Forward | اتجاه واحد | Source to target only. |
| Both | كلا الاتجاهين | Reciprocal conversion for substitutes; cycle check for companions. |
| Embedded demand | طلب مشمول مسبقاً | Target baseline already covers linked sales. |
| Incremental demand | طلب إضافي مستقل | Target baseline explicitly excludes linked sales. |
| Coverage mode | نمط تداخل الطلب | Embedded versus incremental; not forecast confidence. |
| Demand lineage | تسلسل منشأ الطلب | Prevents triggering the same relationship twice. |
| Conservation | الحفاظ على الكميات | No duplicated demand fulfillment or supply. |
| Source-equivalent units | وحدات مكافئة للصنف الأصلي | Cross-unit substitution conservation basis. |
| Component bottleneck | المكوّن المحدِّد | Limits whole-kit fulfillment. |
| Annual usage value | قيمة الاستهلاك السنوي | Eligible annual demand times unit cost. |
| ABC override | تصنيف ABC يدوي | User-set class retained with provenance. |
| A / B / C | A / B / C | Keep class codes, explain thresholds in help. |
| X / Y / Z | X / Y / Z | Keep class codes, not translated unit names. |
| Coefficient of variation | معامل الاختلاف | Population standard deviation divided by mean. |
| Critical item | صنف حرج | Explicit importance overrides low-cost service presets. |
| Service preset | إعداد مسبق لمستوى الخدمة | Proposed class-based cycle-service policy. |
| Cycle service level | مستوى الخدمة لكل دورة توريد | Chance of no stock-out over stated protection horizon. |
| Fill rate | نسبة تلبية الطلب | Fraction of units supplied; not cycle-service probability. |
| Supplier | المورد | Exact grouping identity. |
| Supplier grouping | تجميع الطلبات حسب المورد | Also binds currency, destination and departure window. |
| Supplier minimum | الحد الأدنى للمورد | Value or named-unit quantity, explicitly confirmed. |
| Shipment | الشحنة | Proposed grouped inbound supply. |
| Container | حاوية | Shipment resource limits need actual values. |
| Container fill | استغلال سعة الحاوية | Not an objective that overrides demand/cash/space. |
| Volume cap | الحد الأقصى للحجم | CBM ceiling. |
| Weight cap | الحد الأقصى للوزن | Separate kilogram ceiling. |
| Value cap | الحد الأقصى للقيمة | Declared shipment value ceiling. |
| Cash budget | الميزانية النقدية | Shared across groups when so declared. |
| Space budget | السعة التخزينية المتاحة | Incremental free space after committed inbound. |
| Open to buy | ميزانية الشراء المتاحة | Not current stock value. |
| Headroom | السعة المتبقية ضمن الحدود | Every active resource must have enough remaining capacity. |
| Top-up | إضافة إلى الشحنة | Optional pack block; never automatic demand. |
| Maximum forward cover | الحد الأقصى للتغطية المستقبلية | Restricts speculative stock-up. |
| Landed cost | التكلفة الواصلة | Includes declared freight/duty only if actually provided. |
| Price break | شريحة خصم الكمية | Not necessarily supplier MOQ. |
| Warehouse | المستودع | Site identity retained exactly. |
| Warehouse demand share | حصة المستودع من الطلب | Explicit demand allocation, not inferred from stock. |
| Destination | الوجهة | Receiving site. |
| Internal transfer | تحويل داخلي | Proposed stock movement between sites. |
| Transfer lead time | مدة التحويل | Directed route travel time. |
| Donor warehouse | المستودع المورِّد داخلياً | Must preserve all its own dated protection. |
| In transit | قيد النقل | Not yet available at destination. |
| Allocation | تخصيص المخزون | Assign scarce supply without duplicating units. |
| Customer priority | أولوية العميل | Explicit if available, otherwise equal priority. |
| Surplus | فائض متاح | After own dated demand and safety protection. |
| Shortage | عجز | Demand not covered by timely supply. |
| Unmet demand | طلب غير ملبّى | Remains visible even if purchase caps prevent replenishment. |
| Protection floor | حد المخزون المحمي | Stock floor at each date, not just final horizon. |
| Quantity modifiers | ضوابط كمية الطلب | MOQ, maximum and pack in specified order. |
| Maximum order quantity | الحد الأقصى لكمية الطلب | Per-SKU proposal purchase cap, not rule target stock. |
| Pack rounding | التقريب إلى مضاعف التعبئة | Final purchases only, no intermediate forecast rounding. |
| Partial proposal | مقترح تغطية جزئية | Feasible quantity may leave explicit shortage. |
| Reorder-rule health check | فحص سلامة قواعد إعادة الطلب | Offline comparison, not an ERP repair. |
| Reordering rule | قاعدة إعادة الطلب | Exported ERP min/max policy. |
| Rule ID | معرّف القاعدة | Exact source identifier. |
| Minimum stock | الحد الأدنى للمخزون | Rule trigger threshold, not supplier MOQ. |
| Maximum stock | مستوى المخزون المستهدف | Rule max target, not maximum purchase quantity. |
| Multiple | مضاعف الطلب | Exact decimal quantum; may differ from pack. |
| Route | مسار التزويد | Buy, transfer, manufacture or order-specific route mapping. |
| Trigger | آلية تفعيل القاعدة | Auto/manual semantics require source confirmation. |
| Auto | تلقائي | ERP rule mode; SR still makes no live changes. |
| Manual | يدوي | Explicit review/replenishment action mode. |
| Buy | شراء | Comparable procurement route when confirmed. |
| Manufacture | تصنيع | Outside this reselling comparison. |
| MTO | تزويد حسب الطلب المؤكد | Make-to-order/order-linked policy; do not label min/max weak by default. |
| 0/0/1 | 0/0/1 | Keep exact special-policy token; confirm meaning with exporter. |
| Missing rule | قاعدة غير موجودة | Diagnose only in a confirmed complete export scope. |
| Duplicate rule | قاعدة مكررة | Overlapping active scope needs review, not summed limits. |
| Diagnostic | ملاحظة تشخيصية | Explains a check and assumptions, not an applied change. |

## F. Offline review, cryptography and scope wording

| English source | Arabic draft | Meaning / review note |
| --- | --- | --- |
| Proposal | مقترح طلب | Read-only frozen calculation, not an actual purchase order. |
| Proposal revision | إصدار المقترح | Any edit requires a new digest/approval. |
| Approval | موافقة على الملف | Offline review decision only. |
| Approve | موافقة | Bound to an exact proposal digest/revision. |
| Reject | رفض | Never unlocks purchase/export as approved. |
| Reviewer label | اسم المراجع المدوّن | Editable label, not authenticated identity. |
| Proposer label | اسم مُعدّ المقترح المدوّن | Same identity caveat. |
| Accepted gaps | فجوات مقبولة صراحةً | Specific nonblocking shortages, not waived invalid data. |
| Blocker | مانع للاعتماد | Invalid calculation/evidence must be resolved. |
| Validity deadline | آخر تاريخ للصلاحية | Explicit expiry bound. |
| Expired | منتهي الصلاحية | Not current verified approval. |
| Tamper-evident | قابل لكشف التعديل | Modification detectable under stated key assumptions; not tamper-proof. |
| Access control | التحكم في الوصول | Not provided by offline file approval. |
| Identity verification | التحقق من الهوية | Not established by reviewer label or shared-key MAC. |
| Separation of duties | فصل المهام | Not enforced by this design. |
| Audit log | سجل التدقيق | Local files are not a trusted immutable audit log. |
| Offline review only | مراجعة دون اتصال فقط | No live authorization or execution. |
| Signature | توقيع | HMAC is not a personal/public-key signature. |
| MAC | رمز توثيق الرسالة | Shared-key message authentication code. |
| HMAC-SHA-256 | HMAC-SHA-256 | Keep algorithm name; explain as MAC with shared key. |
| SHA-256 | SHA-256 | Digest algorithm; unkeyed hash alone is not a signature. |
| Digest | بصمة رقمية | Hash of canonical bytes. |
| Shared key | مفتاح مشترك | Anyone holding it can create both proposal/approval MACs. |
| Key reference | مرجع المفتاح | Local identifier, never the secret itself. |
| Canonical JSON | JSON بصيغة معيارية ثابتة | Deterministic serialization under exact schema. |
| Input hash | بصمة ملف الإدخال | Hash exact file bytes, not translated display. |
| Constant-time comparison | مقارنة بزمن ثابت | MAC verification implementation requirement. |
| Replay | إعادة استخدام الملف | Only local repeat detection, no global protection claimed. |
| Read-only | للقراءة فقط | No ERP/stock mutations or actual PO placement. |
| Purchase order | طلب شراء | Distinguish real supplier PO from proposed/copy-only text. |
| Export | تصدير | Local file, not transmission to a supplier. |
| Import | قراءة ملف | Local validation; does not mean ERP data update. |
| Arabic | العربية | Locale selection. |
| RTL | من اليمين إلى اليسار | Text/layout direction; numeric timeline remains LTR. |
| LTR | من اليسار إلى اليمين | Identifier/number isolation and timeline direction. |
| Human review | مراجعة بشرية | Required linguistic and operator sign-off. |
| Not implemented | غير منفّذ | Specification only, not a working planning feature. |

Required Arabic scope warning for proposal review (draft):

> هذه مراجعة لملف دون اتصال، مع إمكانية كشف التعديل باستخدام مفتاح مشترك. لا تثبت هوية
> المُراجع، ولا تفرض صلاحيات وصول أو فصل مهام، ولا تُصدر طلب شراء فعلياً. أي تعديل على
> المقترح يتطلب إصداراً جديداً وموافقة جديدة.

## Review acceptance

Before production use, a native Arabic inventory operator must review terminology, packaging
units, urgency, probability wording and the scope warning. A UI reviewer must check mixed
Arabic/English product text, SKU/date/number isolation, logical spacing, keyboard/screen-reader
behavior, chart chronology, 390/1440 light/dark layouts, truncation and export integrity.
Passing glossary coverage alone does not make Arabic ready. No linguistic sign-off or actual
RTL UI execution is claimed by these documents.
