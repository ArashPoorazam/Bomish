# Bomish · بومیش

Persian, right-to-left food store built with **Go + Next.js/TypeScript + PostgreSQL**. This is a working **development release**, with simulated SMS and payments. Production startup is deliberately disabled until real providers are integrated and verified.

## Run locally

### Docker Compose

```sh
cp .env.example .env
docker compose up --build
```

Open [the store](http://localhost:3000) or [the employee dashboard](http://localhost:3000/staff). The database and API are private to the Compose network. Persistent volumes retain the database and uploaded images. This Compose profile is local HTTP development only.

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
| `owner` | Publishing, prices, stock, delivery, staff and orders |
| `editor` | Product, category and article drafts |
| `operator` | Order preparation and tracking |

All three use the development password `Bomish-demo-2026!` and authenticator setup key `JBSWY3DPEHPK3PXP`. Add that key to a TOTP authenticator, or print the current local development code with the same environment as the API:

```sh
cd backend
go run ./cmd/server totp
```

A TOTP cannot be reused for the same account. Customer login instead displays a newly generated development SMS code in the login form. Codes expire after five minutes and are single-use. No text messages or money are sent.

**Never use fixture credentials, the fixture authenticator secret, or seeded inventory for live sales.**

## Included

- Responsive Persian storefront, local Vazirmatn font, specified cream/green palette, product guides and blog.
- Category filtering, normalized Persian search, typo similarity, aliases and related products.
- Custom gram/kilogram quantities, exact integer-rial pricing, persistent anonymous cart and accessible left drawer.
- SMS-code account creation, cart preservation across login, saved addresses and order history.
- Regional/weight-based delivery, server-authoritative checkout, 15-minute reservations, repeat-safe simulated payments and late-payment review.
- Separate password/TOTP staff login, backend-enforced roles, draft preview, uploads, owner publication, stock adjustments, delivery editing and audit records.
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

## Deployment and operations

See [architecture and behavior](docs/architecture.md), [launch requirements](docs/launch.md), and [asset provenance](docs/assets.md). No public deployment has been made.
