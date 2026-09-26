# Architecture and invariants

## Boundaries

`frontend/` contains the Next.js App Router storefront, customer area and staff interface. Public catalog/article pages render on the server; interactive cart, authentication, checkout and editor components run in the browser. There is no browser-to-database access. `backend/` is a modular Go HTTP application with pgx pooling, sqlc-generated catalog queries and versioned SQL migrations. `api/openapi.json` defines API shapes and generates `frontend/src/lib/api-types.ts`.

The development API runs on 8080 and the frontend on 3000. Next rewrites and the Compose Caddy gateway expose `/api/v1` and `/uploads` on one origin. Do not expose the API/database directly to the internet. Next.js has a small Node runtime solely for page rendering; all commerce rules remain in Go.

## Money and inventory

Prices are integer rials per kilogram; weights are integer grams. Line totals use `(priceRials * grams + 5000) / 10000 * 10` with integer division: round once to the nearest toman, half up. The frontend uses BigInt for the preview; the backend recomputes everything. Checkout rejects a stale quoted total. One public rate applies to every quantity, including bulk purchases.

Each product has a minimum, step and maximum. Valid weights satisfy `(grams - minimum) % step == 0`. The default minimum and step are 100 g. Development products explicitly use a 50 g step to demonstrate the 250 g quick choice. Quick choices incompatible with a product are omitted.

An anonymous cart does not reserve stock. Checkout locks the customer's checkout, the cart session and stock rows, snapshots order item descriptions/prices, and reserves available grams. The transaction prevents overselling. A per-user idempotency key returns the same order on retry.

Payment success consumes reserved stock once, records a stock movement and clears matching purchased cart lines. Failure releases reservations. A Go worker expires pending reservations every 30 seconds, with row locks. A later successful simulated verification checks stock again; insufficient stock puts the order in `review`. Owner intervention is required to arrange fulfillment or refund. Shipping uses the first matching province/weight ceiling after adding the configured packaging weight.

## Identity and permissions

Anonymous and authenticated carts live in PostgreSQL and are associated with an opaque cookie; login rotates the session token and moves the cart. Session tokens are hashed in storage. Codes are hashed, expire after five minutes, are consumed atomically, and stop accepting attempts after five failures. Resend cooldown is 60 seconds, with phone/IP limits. Staff log in with PBKDF2-SHA256 passwords and RFC 6238 TOTP, with replay protection and an eight-hour database session.

HTTP-only, SameSite cookies and exact Origin plus per-session CSRF checks protect mutations. HTTPS origins receive Secure cookies even in development. The API determines permissions; hiding dashboard tabs is only a usability aid. Editors cannot publish, change prices, read orders, or administer staff. Staff accounts do not grant shell, container or database access.

Product/article drafts are stored separately from published content. Public reads never return drafts. Product pages keep showing the previous published revision until the owner publishes. Order-referenced products are archived rather than deleted. Content supports a deliberately small Markdown subset (headings and paragraphs); arbitrary HTML, scripts and embedded links are never interpreted. Images accept JPEG/PNG/WebP, with type sniffing, random names and an 8 MiB upload cap. Uploaded media use a `storage.Store` boundary; this release includes the local implementation with a public `/uploads/` URL contract for a future S3-compatible adapter/proxy.

## Data and operational defaults

One stock location. PostgreSQL stores stock movements, audit events, addresses, cart lines, payment attempts and durable reservation state. No Redis or separate search service is required. Search normalizes Arabic/Persian variants and digits and uses indexed `pg_trgm` similarity. Public catalog responses are capped at 200 products; pagination is a follow-up before a larger catalog is loaded. Recommendations prioritize explicit selections, then category and tags.

The initial reservation job is a Go ticker operating on durable PostgreSQL records. A jobs table is reserved for provider retries; no real provider or external job consumer is enabled in this release. PostgreSQL integration tests cover critical transaction and authorization behavior. Frontend CI exercises the whole editor → owner → shopper flow.
