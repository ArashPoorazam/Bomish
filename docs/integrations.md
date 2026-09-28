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

Each product defines its own packages: amount, unit (`g`, `kg`, `ml`, `l`), price in toman in the staff form, and maximum count (default 5). Volume packages additionally specify their actual shipping weight in grams. Prices are stored as integer rials. A separate package ID is used in carts and order snapshots, so two sizes remain two lines. Cart updates and checkout validate the package limit and manual product availability.

Existing products without package definitions receive one compatibility package based on that product's previous minimum weight and proportional price. Staff should replace these with the intended commercial package sizes and prices. Migration 002 preserves existing orders and open carts: exact valid multiples become package counts; incompatible old cart lines require the customer to select a new package.

Owner price controls apply either a visible percentage discount or a signed flat adjustment to every package's base price. They can target one product or all products. Changes update published and draft prices in one transaction; invalid prices reject the whole operation. Flat adjustments have no discount label. Percentage discounts replace, rather than stack with, previous percentages.

The owner can set the free-shipping subtotal threshold in **ارسال**. Zero disables it; a discounted merchandise subtotal at or above a positive threshold gets free shipping. The destination must still have an applicable shipping rule.

## Tracking and analytics

Customers are sent to `/account/orders/{id}` after successful payment. The four stages are paid, packaged, shipped and received. Staff can advance one step at a time; shipping requires a numeric tracking code. Tracking numbers and events are retained in the customer account. Each completed stage creates one notification job; repeated stage requests cannot duplicate jobs.

The owner-only `/omnisire/analytics` workspace includes daily sales, product clicks and purchases, package quantities, price history, customers, categories, and searches. The sidebar contains report navigation. Date controls default to the past seven Tehran calendar days and accept up to 366 days. Line charts compare up to 12 selected entities, with a keyboard-accessible daily scrubber and accessible data table. Pie charts use all matching results, independent of table pagination and line selections; smaller shares are grouped as “Other”. Package breakdowns follow selected products. Prices carry the last recorded effective package price forward; unknown earlier history stays empty. Excel exports include every filtered report row. Visits and searches start accumulating after installation and are deduplicated per session for 30 minutes; no historical click data is fabricated.

Recommendations rank available products by matching category first, then popularity (paid package counts weighted by 10 plus recorded product visits), with a deterministic name tie-breaker. There is no manual recommendation picker.

Articles and long product sections use Streamdown for incremental Markdown rendering, including lists, tables, links, emphasis and code. Raw HTML is skipped, unsafe URL schemes are filtered, and inline Markdown images are disabled; use the existing uploaded article/product images.

Real payment integration and production activation remain outside this change. The existing development-only startup gate remains in place.

## Refreshing the local test catalog

The explicit development command `go run ./cmd/server refresh-demo-catalog` (run from `backend` with `APP_ENV=development` and `DATABASE_URL` set) archives the original seeded and browser-test products and creates six package-based samples: salt, oil, turmeric, mint, discounted sesame, and unavailable cinnamon. Historical orders are retained. It does not run automatically at startup. Repeating it restores sample prices and manual availability. Old sample cart lines are removed.

With `SMS_ENABLED=false`, open `/account`, request a verification code using a valid Iranian mobile number, and enter the temporary code displayed in the form under **پیامک آزمایشی · کد ورود**. The code expires in five minutes; requesting another has a one-minute cooldown. No SMS is sent. Use the same number to return to the same customer account.

## Omnisire rollout

Restart the Go service to apply migration 004 before serving the updated frontend. Back up a production database before any migration. Existing staff retain their roles and receive stable referral codes. Missing names, mobile numbers or bank cards are flagged for owner completion; a card is required before recording payouts. Historical orders/logs remain intact and receive no retroactive referral commissions. Price history starts with an explicitly marked migration baseline; click measurement starts when this release is installed.

Owners sign in with the existing password/authenticator flow and land in `/omnisire`. The owner-only workspace switch opens ordinary staff tools. Managers, editors, operators and salespersons land in their first permitted section. Create members, record the displayed authenticator setup secret, and configure role restrictions in **همکاران**. Password/authenticator resets revoke existing sessions. Archival is permanent through the member interface and preserves records.

Payments entered in Omnisire are records of external transfers, with amount, reference and date; they do not call a bank. Correct a payment using its reversal action, and record externally refunded net merchandise through the attributed purchase. Salaries and a full returns workflow are not included. The simulated payment provider remains unchanged.

For isolated acceptance testing, set `TEST_DATABASE_URL` to a disposable PostgreSQL database and run backend tests with `-race`. Set `OMNISIRE_SCALE_TEST=1` to include the 1,000-product, 1,000-member, 100,000-order and 1,000,000-event fixture. Browser tests accept `BASE_URL` and `CHROMIUM_PATH`. `BOMISH_DIST_DIR` can isolate Next build output from an existing local development server.
