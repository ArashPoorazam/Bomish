# Bomish · بومیش

Persian, right-to-left food store built with **Go + Next.js/TypeScript + PostgreSQL**. This is a working **development release**, with configurable Kavenegar SMS and simulated payments. Production startup is deliberately disabled until real payments and production providers are verified.

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

Requirements: Go 1.26+, Node 24+, PostgreSQL with `pg_trgm`, and optionally sqlc 1.31+.

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

Use **http://localhost:3000**, matching `APP_ORIGIN` exactly. The Go server applies versioned SQL migrations under an advisory lock. `SEED_DEMO=true` seeds only an empty catalog, only in development. Development pictures and prices are not actual merchant inventory.

## Employee access

Development fixtures create these three separate accounts:

| Username | Permission |
|---|---|
| `owner` | All staff tools and the independent Omnisire owner workspace |
| `editor` | Products, availability, publishing, magazine, categories, pricing and personal sales |
| `operator` | Order preparation, tracking and personal sales |

Owners can also create managers (all staff tools) and salespersons (personal sales only) in Omnisire, with individual section restrictions or account suspension. Members receive referral links, a permanent commission/payment ledger and audited activity.

All three use the development password `Bomish-demo-2026!` and authenticator setup key `JBSWY3DPEHPK3PXP`. Add that key to a TOTP authenticator, or print the current local development code with the same environment as the API:

```sh
cd backend
go run ./cmd/server totp
```

A TOTP cannot be reused for the same account. Customer login instead displays a newly generated development SMS code in the login form. Codes expire after five minutes and are single-use. With the default `SMS_ENABLED=false`, no text messages or money are sent.

**Never use fixture credentials, the fixture authenticator secret, or seeded inventory for live sales.**

## Included

- Responsive Persian storefront, local Vazirmatn font, specified cream/green palette, product guides and blog.
- Category filtering, normalized Persian search, typo similarity, aliases and related products.
- Product-specific gram/kilogram/milliliter/liter packages, per-package prices and purchase limits, separate cart lines, and price ranges. Discounted package prices round upward to 1,000 toman, capped at the original package price; undiscounted prices and coupon rules remain unchanged.
- Kavenegar-ready SMS account verification, a customer overview, order history, map-assisted address creation/editing/deletion, and four-stage order tracking with queued notifications. Saved-address changes never alter existing order snapshots.
- Regional/weight-based delivery, server-authoritative checkout, 15-minute reservations, repeat-safe simulated payments and late-payment review.
- Separate password/TOTP staff login, backend-enforced roles, draft preview, uploads, editor publication, manual availability and delivery editing.
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

The staff panel includes searchable products, flexible package and Markdown section editors, category and fulfillment workflows, owner price/discount controls, free-shipping settings, and a dedicated business analytics page.

Fill private service keys and support details in the root `.env`; see [integration settings and operations](docs/integrations.md). The local file already contains the supplied Neshan key. SMS remains simulated until `SMS_ENABLED=true` and Kavenegar settings are complete.

## Deployment and operations

See [architecture and behavior](docs/architecture.md), [launch requirements](docs/launch.md), and [asset provenance](docs/assets.md). No public deployment has been made.
