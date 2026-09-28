# Architecture and invariants

## Boundaries

`frontend/` contains the Next.js App Router storefront, customer area and staff interface. Public catalog/article pages render on the server; interactive cart, authentication, checkout and editor components run in the browser. There is no browser-to-database access. `backend/` is a modular Go HTTP application with pgx pooling, sqlc-generated catalog queries and versioned SQL migrations. `api/openapi.json` defines API shapes and generates `frontend/src/lib/api-types.ts`.

The development API runs on 8080 and the frontend on 3000. Next rewrites and the Compose Caddy gateway expose `/api/v1` and `/uploads` on one origin. Do not expose the API/database directly to the internet. Next.js has a small Node runtime solely for page rendering; all commerce rules remain in Go.

## Money and product availability

Products define their own package IDs, amounts, units, prices and purchase limits (default 5). Prices are integer rials per package; the UI edits toman. Percentage discounts are rounded to the nearest toman per package before multiplying by quantity. Flat price adjustments modify the base price without a discount label. Checkout recomputes prices and rejects stale quotes.

Package quantities are integers. Gram/kilogram sizes and the explicit weight of volume packages determine shipping fees only. Cart and order keys include product plus package. Purchase limits remain per package; the store does not count, reserve, or deduct stock.

Product availability is a manual `outOfStock` flag. Authorized staff and owners can change it immediately, independently of content drafts. Unavailable products stay visible but cannot be added to a cart or checked out. Archived products are hidden. Migration 005 preserves the former unavailable state and retains old stock records for history; no running inventory logic uses those records.

Checkout locks the customer, cart session and product rows, checks availability, and snapshots item prices and quantities. A per-user idempotency key returns the same order on retry. Payment clears matching purchased cart lines once. A worker expires unpaid orders after 15 minutes. Late successful payments remain valid unless discount capacity cannot be reclaimed, which requires review. Shipping uses the first matching province/weight ceiling after adding packaging weight.

## Identity and permissions

Anonymous and authenticated carts live in PostgreSQL and are associated with an opaque cookie; login rotates the session token and moves the cart. Session tokens are hashed in storage. Codes are hashed, expire after five minutes, are consumed atomically, and stop accepting attempts after five failures. Resend cooldown is 60 seconds, with phone/IP limits. Staff log in with PBKDF2-SHA256 passwords and RFC 6238 TOTP, with replay protection and an eight-hour database session.

HTTP-only, SameSite cookies and exact Origin plus per-session CSRF checks protect mutations. HTTPS origins receive Secure cookies even in development. The API determines permissions; hiding dashboard tabs is only a usability aid. Owners administer the business in `/omnisire`. Managers have all staff tools; editors can publish, archive, change availability and edit prices in their content sections; operators handle orders; salespersons have personal sales only. Every member has a personal sales page. Individual section restrictions only remove role permissions. Backend checks cover alternate editing paths, including prices inside product drafts. Role, restriction, suspension, archival and credential changes revoke sessions. Staff accounts do not grant shell, container or database access.

Product/article drafts are stored separately from published content. Public reads never return drafts. Product pages keep showing the previous published revision until an authorized publisher publishes. Order-referenced products are archived rather than deleted. Content uses incremental Streamdown Markdown rendering; raw HTML and inline images are disabled, and unsafe URL schemes are filtered. Images accept JPEG/PNG/WebP, with type sniffing, random names and an 8 MiB upload cap. Uploaded media use a `storage.Store` boundary; this release includes the local implementation with a public `/uploads/` URL contract for a future S3-compatible adapter/proxy.

## Data and operational defaults

PostgreSQL stores audit events, addresses, cart lines, payment attempts and unpaid-order deadlines. No Redis or separate search service is required. Search normalizes Arabic/Persian variants and digits and uses indexed `pg_trgm` similarity. Public catalog, staff products/orders/articles, members and reports use server-side filtering and stable pagination (25 rows by default, at most 100). Sitemap generation walks every catalog page. Recommendations prioritize category, then recorded popularity.

The initial reservation job is a Go ticker operating on durable PostgreSQL records. The jobs table now stores transactional order-stage SMS jobs, with provider retries in the same worker loop. Kavenegar is disabled until configured. See integrations.md for provider settings, analytics semantics and migration behavior. PostgreSQL integration tests cover critical transaction and authorization behavior. Frontend CI exercises the whole editor → owner → shopper flow.

## Owner workspace and commission accounting

`/omnisire` and `/api/v1/omnisire/*` are owner-only. Administrative layouts omit storefront chrome and are excluded from indexing. `/staff/sales` derives its member identity from the session and masks customer phones. Member list responses and audit records exclude bank cards; only owner detail responses expose them. Archival preserves financial and activity history while blocking login and future referrals/earnings.

The server-side anonymous session remembers the last valid referral for 30 days. OTP signup binds it only when the user is newly inserted, inside the same transaction. Existing accounts never change attribution. Eligible payments occur from signup, inclusive, until exactly 720 hours later, exclusive. Commission is 7% of merchandise after product and order discounts, excluding shipping, rounded upward per order to 1,000 toman. Zero merchandise produces zero commission. Suspension blocks future earnings; reactivation does not backfill purchases.

Payment settlement credits commission in its own transaction, with a unique order constraint. Member-row locks serialize commissions, payouts, reversals and refund corrections. The immutable ledger determines balances; idempotency keys and unique payment references prevent duplicate payments. Payouts require complete card information and cannot exceed a positive balance. Refund corrections recompute commission on remaining net merchandise; negative balances offset future earnings. Transfers and refunds happen outside the application.

Published price/package/discount history is captured by a database trigger, including publication and bulk pricing paths. Migration 004 records a baseline without inventing earlier history. Product-link clicks and detail views are separate 30-minute-deduplicated events. Analytics use Tehran calendar boundaries and allocate order discounts across lines in whole toman with exact total reconciliation.

Excel exports use durable PostgreSQL jobs. Workers stream every filtered row into a typed, Persian-labelled XLSX workbook; progress, failures and explicit retries are available to owners. Downloads require owner authorization. The worker leases unfinished jobs and recovers stale processing attempts after ten minutes; Excel's worksheet row limit is enforced.
