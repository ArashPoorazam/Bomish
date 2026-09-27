# Private configuration and operations

All integration values live in the root `.env` file (ignored by Git, permissions 0600). `.env.example` is the shareable template. The native launcher loads it; Docker Compose forwards server-only keys to the Go service. Restart the services after changing values. Never use `NEXT_PUBLIC_` for service credentials.

| Setting | Purpose |
|---|---|
| `NESHAN_API_KEY` | Neshan service key for reverse geocoding. The supplied key is stored only in local `.env`. |
| `SMS_ENABLED` | Keep `false` while testing. Set `true` only after configuring and validating Kavenegar. |
| `KAVENEGAR_API_KEY` | Kavenegar account API key. |
| `KAVENEGAR_SENDER` | Approved sender for order-stage messages. |
| `KAVENEGAR_VERIFY_TEMPLATE` | Approved verification template containing `%token`. |
| `SUPPORT_URL` | Full `https://wa.me/989…` or `https://t.me/…` support link. An owner-panel support link overrides this default. |
| `POST_TRACKING_URL_TEMPLATE` | Defaults to `https://pishkhan24.com/posttracking/?barcode={tracking}`. The code is URL-encoded. |
| `APP_ORIGIN` | Exact customer-facing origin, also used in order SMS links. |
| `SITE_URL` | Site metadata URL. |

Neshan reverse geocoding uses [the v5 API](https://platform.neshan.org/docs/api/search-category/reverse-geocoding/). The map uses Leaflet/OpenStreetMap tiles; the private service key never reaches the browser. Selecting a point fills the editable street, city and province. Customers must check the address and add apartment details and postal code. Manual entry remains available when location permission or the provider fails. Saved latitude/longitude stay with the address and order snapshot.

Kavenegar uses [verification lookup and SMS send](https://kavenegar.com/rest.html). With real SMS enabled, no OTP is returned in browser responses. Order transitions save both their history and an SMS job in the same transaction. The worker processes jobs every 30 seconds, checks provider acceptance, and retries failures with exponential backoff up to eight attempts. The analytics screen shows pending, sent-to-provider, and failed counts. Provider acceptance is not handset delivery confirmation. Network timeouts can cause duplicate messages on retry; delivery is at least once. Use a clean deployment database before enabling SMS so development orders do not produce real notifications.

Pishkhan24's public tracking-page implementation was inspected on 2026-09-26: its initialization reads `route.query.barcode` into `TrackingCode`. Both shipment SMS and customer order views use this supported prefill parameter. The copy-code action provides a fallback if the provider changes its interface.

## Package catalog

Each product defines its own packages: amount, unit (`g`, `kg`, `ml`, `l`), price in toman in the staff form, and maximum count (default 5). Volume packages additionally specify their actual shipping/stock weight in grams. Prices are stored as integer rials. A separate package ID is used in carts and order snapshots, so two sizes remain two lines. Cart updates and checkout validate the package limit and aggregate stock across all sizes.

Existing products without package definitions receive one compatibility package based on that product's previous minimum weight and proportional price. Staff should replace these with the intended commercial package sizes and prices. Migration 002 preserves existing orders and open carts: exact valid multiples become package counts; incompatible old cart lines require the customer to select a new package.

Owner price controls apply either a visible percentage discount or a signed flat adjustment to every package's base price. They can target one product or all products. Changes update published and draft prices in one transaction; invalid prices reject the whole operation. Flat adjustments have no discount label. Percentage discounts replace, rather than stack with, previous percentages.

The owner can set the free-shipping subtotal threshold in **ارسال**. Zero disables it; a discounted merchandise subtotal at or above a positive threshold gets free shipping. The destination must still have an applicable shipping rule.

## Tracking and analytics

Customers are sent to `/account/orders/{id}` after successful payment. The four stages are paid, packaged, shipped and received. Staff can advance one step at a time; shipping requires a numeric tracking code. Tracking numbers and events are retained in the customer account. Each completed stage creates one notification job; repeated stage requests cannot duplicate jobs.

The owner-only **تحلیل داده‌ها** tab includes sales trends, order value/count, abandoned orders, category revenue shares, product visits and purchased package counts, searches, best customers, fulfillment and notification status. Ranges are 7, 30, 90 or 365 days. Visits and submitted searches begin accumulating after installation; historical click data is not fabricated. Session repeats are deduplicated for 30 minutes, with an IP rate limit. This is first-party activity measurement, not a bot-proof or cross-device unique-person count.

Recommendations rank available products by matching category first, then popularity (paid package counts weighted by 10 plus recorded product visits), with a deterministic name tie-breaker. There is no manual recommendation picker.

Articles and long product sections use Streamdown for incremental Markdown rendering, including lists, tables, links, emphasis and code. Raw HTML is skipped, unsafe URL schemes are filtered, and inline Markdown images are disabled; use the existing uploaded article/product images.

Real payment integration and production activation remain outside this change. The existing development-only startup gate remains in place.

## Refreshing the local test catalog

The explicit development command `go run ./cmd/server refresh-demo-catalog` (run from `backend` with `APP_ENV=development` and `DATABASE_URL` set) archives the original seeded and browser-test products and creates six package-based samples: salt, oil, turmeric, mint, discounted limited-stock sesame, and unavailable cinnamon. Historical orders are retained. It does not run automatically at startup. Repeating it restores sample prices and stock, but refuses to reset a sample with outstanding reservations. Old sample cart lines are removed.

With `SMS_ENABLED=false`, open `/account`, request a verification code using a valid Iranian mobile number, and enter the temporary code displayed in the form under **پیامک آزمایشی · کد ورود**. The code expires in five minutes; requesting another has a one-minute cooldown. No SMS is sent. Use the same number to return to the same customer account.
