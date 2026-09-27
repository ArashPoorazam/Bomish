# Discount codes

Owners manage codes from **قیمت و تخفیف → کدهای تخفیف**. Codes can be created and enabled/disabled; their financial terms are immutable after creation. Create a new code for a different offer. Every change is audited.

- Codes are case-insensitive, 3–32 English letters, digits, hyphens or underscores, starting with a letter or digit.
- Offers are either 1–90% or a fixed amount. Staff enter money in tomans; the API stores rials.
- Codes apply to current merchandise prices **after product sale discounts**, as requested. Only one code applies per order.
- Percentage discounts round down to whole tomans and support an optional maximum discount. Fixed discounts are capped at the merchandise subtotal.
- Shipping is excluded. The existing free-shipping threshold uses the merchandise subtotal before the code.
- Minimum merchandise spend, expiry time, and total usage limit are optional. Empty limits mean unlimited. Expiry input uses the staff device's local timezone and is sent as an absolute timestamp.
- A pending order reserves a usage slot for its existing 15-minute payment reservation. Cancellation or reservation expiry releases it. Paid, fulfillment, and payment-review orders count as used.
- Checkout revalidates the code and locks its row before reserving a usage slot. Concurrent purchases cannot reserve the same final slot. Idempotent retries return the existing order.
- Orders retain the applied code and discount amount. Disabling a code does not change existing order totals. A late successful payment after expiry must reclaim usage capacity; otherwise the order enters payment review.

API endpoints: `GET/POST /staff/discount-codes`, `PATCH /staff/discount-codes/{code}`. Both `/checkout/quote` and `/checkout` accept an optional `discountCode`. Quotes and orders return `discountCode` and `discountRials`. All amounts are revalidated on the server; no client-supplied discount amount is accepted.
