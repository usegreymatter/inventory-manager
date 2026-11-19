# Inventory terminology

Common industry terms lead, followed by a short plain meaning. Less familiar jargon is plain-first, with the standard term in parentheses or grey text. Internal data keys are unchanged.

| Standard term | What it means | Who sets it (you / calculated) | Arabic |
| --- | --- | --- | --- |
| Reorder point | Order when stock drops to this amount. | calculated | نقطة إعادة الطلب |
| Safety stock | Extra kept for delays or surprise demand. | calculated | مخزون الأمان |
| Lead time | Days from order to delivery. | you | مدة التوريد |
| Out of stock | No stock left now. | calculated | نفاد المخزون |
| Order soon | Order-by date falls within your soon window, after lead time; no earlier warning applies. | calculated | اطلب قريباً |
| Order now | Out of stock, a supply gap, or order-by date falls within your urgent window after lead time. | calculated | اطلب الآن |
| Order by | Latest order date allowing for delivery before stock runs out. | calculated | اطلب قبل |
| Runs out | Forecast date when stock is used up. | calculated | ينفد في |
| Overstocked | More months of stock than your threshold, with no earlier warning. | calculated | مخزون زائد |
| No sales | Stock remains but the last three months had no sales, with no earlier warning. | calculated | بدون مبيعات |
| MOQ | Smallest order the supplier accepts (minimum order quantity). | you | الحد الأدنى للطلب |
| Pack size | Order in multiples of this number of units. | you | عدد الوحدات في الكرتون |
| On order | Already ordered, not yet arrived. | you | قيد الطلب |
| Suggested order | Calculated amount to buy after stock, incoming, cover and order rounding. | calculated | الكمية المقترحة |
| Unit cost | What one unit costs you. | you | تكلفة الوحدة |
| EOQ | Most economical order size (economic order quantity), using your costs and forecast demand. | calculated | الكمية الاقتصادية للطلب |
| Service level | Your chosen risk of running out; a planning assumption, not a guarantee. | you | مستوى الخدمة |
| Review period | How often you order, in days. | you | فترة المراجعة |
| Ordering cost | Cost per order, such as shipping and admin. | you | تكلفة الطلب |
| Holding cost | Percentage of item cost per year: storage, money tied up and damage. | you | تكلفة الاحتفاظ بالمخزون |
| Order cover | How many months each order should last after delivery. | you | تغطية الطلب |
| Demand variability | Sales pattern: Steady, Up and down or Very uneven. | calculated | تفاوت المبيعات |

Sales patterns use the last 3–12 months: standard deviation / mean below 0.25 is Steady; below 0.6 is Up and down; otherwise Very uneven. Zero mean and zero variation is Steady; missing variation has no label. These are display buckets only.

Status rules retain their existing priority and calculations. Order now / Order soon windows refer to the order-by date after allowing for lead time, not a change to the stock forecast.

Sources: wording aligned with Shopify Stocky, inFlow, Zoho, Odoo, Cin7, Lightspeed help docs.
