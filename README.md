# Bomish · بومیش

Persian, right-to-left food store built with **Go + Next.js/TypeScript + PostgreSQL**. The production deployment serves a **public catalog**, with staff content management and an owner workspace. Customer purchasing remains disabled in production until real payments and providers are verified. Local development retains simulated commerce. See the [production runbook](docs/production.md).

## Run locally

### Docker Compose

```sh
cp .env.example .env
docker compose up --build
```

Open [the store](http://localhost:3000) , [the employee dashboard](http://localhost:3000/staff), or [Omnisire](http://localhost:3000/omnisire). The database and API are private to the Compose network. Persistent volumes retain the database and uploaded images. This Compose profile is local HTTP development only.

### Native development

On a machine with Go, Node and PostgreSQL tools installed, the one-command local launcher manages a durable development database and starts both servers:

```sh
./scripts/dev-local.sh
```

Press Ctrl+C to stop the application processes; the development database stays running. Data lives in the ignored `.data/` folder. Alternatively, use the manual setup below.

Requirements: Go 1.27+, Node 26, PostgreSQL with `pg_trgm`, and optionally sqlc 1.31+.

The app uses TypeScript 7. API type generation runs in the isolated `frontend/tools/api-types` package with TypeScript 5 because `openapi-typescript` still requires its JavaScript compiler API. `npm run api:generate` installs the generator from its own lockfile and regenerates the contract; the app's compiler remains TypeScript 7.

Create a PostgreSQL database, then run:

```sh
cd backend
export APP_ENV=development
export DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/bomish?sslmode=disable'
export APP_ORIGIN='http://localhost:3000'
export SEED_DEMO=true
go run ./cmd/server
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Use **http://localhost:3000**, matching `APP_ORIGIN` exactly. The Go server applies versioned SQL migrations under an advisory lock. `SEED_DEMO=true` seeds only when both products and staff are empty, only in development. Development pictures and prices are not actual merchant inventory.

## Employee access

Development fixtures create five separate test accounts:

| Username | Permission |
|---|---|
| `owner` | All staff tools and the independent Omnisire owner workspace |
| `manager` | All staff tools |
| `salesperson` | Personal sales and referral tracking |
| `editor` | Products, availability, publishing, magazine, categories, pricing and personal sales |
| `operator` | Order preparation, tracking and personal sales |

Owners can also create managers (all staff tools) and salespersons (personal sales only) in Omnisire, with individual section restrictions or account suspension. Members receive referral links, a permanent commission/payment ledger and audited activity.

All five use the development password `Bomish-demo-2026!`. Staff login requires only a password. The owner additionally uses authenticator setup key `JBSWY3DPEHPK3PXP` to unlock `/omnisire`. Add that key to a TOTP authenticator, or print the current local development code with the same environment as the API:

```sh
cd backend
go run ./cmd/server totp
```

A TOTP cannot be reused for the same account. Customer login instead displays a newly generated development SMS code in the login form. Codes expire after five minutes and are single-use. Real SMS uses six approved Kavenegar templates and requires an HTTPS origin; see the integration guide. With the default `SMS_ENABLED=false`, no text messages or money are sent.

**Never use fixture credentials, the fixture authenticator secret, or seeded inventory for live sales.**

## Replace development fixtures

The development catalog contains 30 Persian pantry products across six categories, with 110 explicitly priced packages (three or four per product). Prices are illustrative and images reuse the existing development illustration. Shipping weights are estimates and are not marked as verified merchant measurements.

To replace an existing development catalog and staff roster, back up the database first, then run with the same `DATABASE_URL` and `APP_ENV=development` as the API:

```sh
cd backend
go run ./cmd/server refresh-demo-catalog
```

This explicit command archives all previous products and staff, invalidates staff sessions, clears stale carts, drafts, referral cookies and product promotions, and installs the new catalog, homepage suggestions and five fresh accounts. Usernames are `owner`, `manager`, `editor`, `operator` and `salesperson`, with the fixture password and authenticator key above. Existing orders, customer data, commission ledgers and audit history remain attached to their original records. Archived accounts cannot log in. Normal startup never resets existing data.

The old five-product fixture is retained only in backend test files for historical checkout and migration regression tests.

## Included

- Responsive Persian storefront, local Vazirmatn font, specified cream/green palette, product guides and blog.
- Category filtering, normalized Persian search, typo similarity, aliases and related products.
- Product-specific gram/kilogram/milliliter/liter packages, per-package prices and purchase limits, separate cart lines, and price ranges. Discounted package prices round upward to 1,000 toman, capped at the original package price; undiscounted prices and coupon rules remain unchanged.
- Kavenegar-ready SMS account verification, a customer overview, order history, map-assisted address creation/editing/deletion, and five-stage order tracking with automatic and manual refresh and four milestone SMS templates. Saved-address changes never alter existing order snapshots.
- Regional/weight-based delivery, server-authoritative checkout, 15-minute reservations, repeat-safe simulated payments and late-payment review.
- Password-only staff login, separate owner TOTP verification, backend-enforced roles, draft preview, uploads, editor publication, manual availability and delivery editing.
- Owner-only Omnisire with member management, referral commission accounting, searchable event history, paginated analytics, cross-page comparison and background Excel exports.
- Referral commissions: 7% of discounted merchandise within 30 days of signup, rounded upward to 1,000 toman per paid order; external payout recording, reversals and partial-refund corrections.
- OpenAPI contract, generated TypeScript types, sqlc queries, migrations, containers, CI, and backup/restore helpers.

## Verify

```sh
cd backend
go test ./...
TEST_DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/bomish?sslmode=disable' go test -race ./...
go vet ./...
```

Integration tests create and remove a random schema, never wipe the public application tables. The test database user needs schema and extension permissions.

```sh
cd frontend
npm run api:generate
npm run typecheck
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests require both local servers and development fixtures. To use an installed Chromium: `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`. Browser tests create demo orders and a demo product; run them against a disposable development database.

Regenerate database access after changing queries: `cd backend && sqlc generate`. Regenerate the frontend contract after editing `api/openapi.json`: `cd frontend && npm run api:generate`.

## Store management

Staff can use **مدیریت خانه** to upload, describe, reorder, and remove homepage slideshow images and curate up to 12 suggested products. Each slide can link to a store collection with an optional title and caption; blank copy uses the collection's defaults. Migration 018 adds these optional fields while preserving existing images. Each editor saves independently; uploads support partial-failure retries. The homepage rotates images every eight seconds with swipe/drag navigation, dot controls, pause/play and reduced-motion support; manual navigation stops automatic rotation. Small product collections use compact layouts, and navigation appears only when the rail can scroll. Homepage sections reveal once on entry, with motion disabled for reduced-motion preferences. A shopping guide explains package selection, delivery costs and order tracking. Customers see compact order summaries and create personalized requests from a dedicated form. Staff can use the Requests section for orders, support conversations, and personalized product requests. The storefront includes a floating support button and customer-visible request decisions.

Chat opens the latest 100 messages, supports loading older history without losing scroll position, and polls for new replies only while visible. Orders refresh independently of addresses and retain their last successful status during temporary failures.

Customer and staff cookies remain independent; only genuine session expiry invokes sign-in. Notification badges track unread counts, while optional sound detects new event markers even when counts stay unchanged.

Suggestion loading and product search have separate retries that preserve edits. In development, migrations apply automatically at startup; production uses the explicit migration command. migration 011 preserves the original homepage picture as the initial slide. See [architecture and behavior](docs/architecture.md) for permissions, polling, session isolation, and collection rules.

The staff panel includes searchable products, flexible package and Markdown section editors, category and fulfillment workflows, owner price/discount controls, free-shipping settings, and a dedicated business analytics page.

Fill private service keys and support details in the root `.env`; see [integration settings and operations](docs/integrations.md). The local file already contains the supplied Neshan key. SMS remains simulated until `SMS_ENABLED=true` and Kavenegar settings are complete.

## Deployment and operations

Start with the [production deployment and recovery runbook](docs/production.md), then [live-sales requirements](docs/launch.md). Docker/Traefik, database roles, owner bootstrap, scheduled encrypted backups, monitoring and CI image releases are configured in the repository. No VPS or Cloudflare changes have been made.

Shipping always uses calculated delivery: Tehran city uses Snapp pricing when serviceable; after packing, staff choose Snapp dispatch or assign an active staff member with the «پیک» role. Other destinations use post. There is no legacy tariff mode. Complete the pickup address, cartons, package measurements, locality mappings and provider setup before checkout can quote delivery. Technical settings live in `config/shipping.json`; development simulation uses `SHIPPING_SIMULATED=true`. Live carriers still require verified merchant contracts; see [shipping integration](docs/integrations.md#shipping-provider-integration-and-simulation).

Technical shipping settings live in [`config/shipping.json`](config/shipping.json), with a [field template](config/shipping.example.json) and [editing/apply instructions](docs/integrations.md#shipping-configuration-file). API keys remain in `.env`.

### Carton geometry defaults

Set `SHIPPING_BOX_WALL_MM` (default `6`) and `SHIPPING_BOX_INSET_MM`
(default `10`) on the API process, then restart the API. Docker Compose forwards
both variables. Values are whole millimeters from 0 to 100. These defaults apply
to existing and new cartons: internal dimensions subtract twice the wall
thickness from external dimensions; usable dimensions additionally subtract twice
the protective margin. Staff enter external dimensions and empty-carton weight.
Filler weight is zero and cartons have no individual gross-weight limit
(`maxGrams: 0`). Carrier weight limits and actual product/carton weight still apply.
