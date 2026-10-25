# Backend architecture

Bomish is a modular Go application deployed as one process with PostgreSQL. The backend owns authentication, authorization, catalog management, checkout, fulfillment, reporting, and durable background work. The frontend consumes the existing `/api/v1` contract; it does not implement commerce rules or access the database.

The design keeps transaction-heavy business workflows together while separating reusable policy, cryptography, HTTP mechanics, read models, reporting, and process lifecycle into independently compiled packages. PostgreSQL remains the source of truth and the work queue. There is no additional framework, ORM, broker, or distributed service to operate.

## Package ownership and dependency direction

```mermaid
flowchart TD
    CLI[cmd/server: composition and commands] --> Config[runtimeconfig]
    CLI --> Migrations[migrations]
    CLI --> Lifecycle[server: HTTP and job lifecycle]
    CLI --> App[app: routes and transactional workflows]
    CLI --> Storage[storage]
    App --> Policy[access: permission policy]
    App --> Security[security: credentials and tokens]
    App --> HTTP[httpx: transport mechanics]
    App --> Orders[orderquery: order read model]
    App --> Reports[reporting: analytics and exports]
    App --> Domain[domain: business values and rules]
    App --> Carrier[carrier: external delivery adapters]
    App --> CatalogDB[db: generated catalog queries]
    App --> DB[database: pgx query boundary]
    App --> Storage
    Orders --> DB
    Orders --> Domain
    Reports --> DB
    Reports --> HTTP
    Reports --> Domain
    HTTP --> Security
    Carrier --> Domain
    Carrier --> Packing[packing: deterministic geometry]
    Domain --> Packing
```

| Location under `backend/` | Owns | Rules |
| --- | --- | --- |
| `cmd/server/` | Composition, CLI command dispatch, signal handling | Opens the pool and upload store, registers jobs, and closes resources after serving ends. Only `main` calls `os.Exit`. |
| `internal/server/` | HTTP serving, graceful shutdown, periodic job scheduling | Accepts handlers and job functions. Does not import business packages. |
| `internal/runtimeconfig/` | Secret-file loading, environment validation, startup settings | Production fails closed. Bind address and upload defaults are resolved here without writing defaults back into the environment. |
| `internal/app/` | Authenticated use cases, transaction ownership, route registration, durable job state | Coordinates related writes and audits in one transaction. Other internal packages must not import it. |
| `internal/access/` | Role defaults, overrides, permission catalog | Pure policy. Owner-only capabilities cannot be delegated. Catalog accessors do not expose mutable policy state. |
| `internal/security/` | Opaque tokens, hashes, password derivation, TOTP, authenticated encryption | No HTTP, database, or business dependencies. TOTP verification receives the current time explicitly; callers normalize user input. |
| `internal/httpx/` | JSON responses, strict bounded decoding, pagination, request IDs, access logging, trusted proxy parsing | Knows neither sessions nor business workflows. Database errors expose a generic response and log SQLSTATE only. |
| `internal/orderquery/` | Customer-safe order and delivery projections | Takes a pool or transaction through `database.Querier` and an explicit filter. At most 100 orders; query count does not grow with page size. |
| `internal/reporting/` | Report definitions, validated query plans, charts, XLSX generation | Tables and exports share parameterized filters and allowlisted sort fields. HTTP handlers are mounted behind owner authorization. Export generation records progress. |
| `internal/domain/` | Product, package, money, address, order, and shipping rules | No HTTP or SQL dependencies. Money remains integer rials. |
| `internal/packing/` | Bounded, deterministic carton planning | Pure computation with explicit unit, parcel, and search limits. |
| `internal/carrier/` | Tapin/Snapp protocols and provider interfaces | Network adapters return typed results; application transactions own persistence and retry decisions. |
| `internal/database/` | Small query interface and dynamic report-row collection | Both `pgx.Tx` and `pgxpool.Pool` satisfy the interface. No generic repository abstraction. |
| `internal/db/` | sqlc-generated catalog data access | Generated from `queries/` and `migrations/`; do not edit by hand. |
| `internal/storage/` | Upload storage and local public-file serving | Local writes and reads use the same explicit root. |
| `migrations/` | Ordered, embedded SQL upgrades and readiness checks | Historical migrations are immutable. Production upgrades through the explicit `migrate` command. |

`internal/architecture/dependencies_test.go` enforces the internal dependency boundaries. Authorization, security, domain, and packing packages cannot import HTTP or pgx. New dependencies should reflect an intentional ownership change.

## How to navigate application workflows

`app.App` holds the application dependencies. It does not hold mutable per-request state; sessions live in request contexts and durable state lives in PostgreSQL. The remaining application package is the transaction coordination boundary, not a second infrastructure layer.

| Concern | Files in `internal/app/` |
| --- | --- |
| HTTP entry points | `routes.go`, `request_routes.go`, `shipping_routes.go`, `omnisire.go` |
| Session and authorization enforcement | `middleware.go`, `session.go`, `permissions.go`, `rate_limit.go` |
| Customer, staff, owner authentication | `customer_auth.go`, `staff_auth.go`, `staff_password.go`, `owner_auth.go` |
| Catalog writes | `staff_products.go`, `staff_articles.go`, `staff_categories.go`, `catalog_authorization.go` |
| Product packaging, pricing, promotions | `product_packaging*.go`, `pricing.go`, `product_discounts.go`, `discount_codes.go` |
| Customer commerce | `cart.go`, `addresses.go`, `address_management.go`, `checkout.go`, `orders.go`, `payments.go`, `customer_cancel.go` |
| Delivery quotation/configuration | `shipping_quotes.go`, `shipping_config.go`, `shipping_settings.go`, `shipping_file.go` |
| Delivery state and operations | `shipping_repository.go`, `shipping_preparation.go`, `shipping_dispatch.go`, `shipping_orders.go`, `shipping_own_courier.go`, `shipping_worker.go` |
| Customer requests and messages | `requests.go`, `request_messages.go`, `request_notifications.go`, `staff_request_list.go`, `chat_images.go` |
| Owner administration | `members.go`, `commissions.go`, `omnisire.go`, `report_exports.go`, `audit.go` |
| Other integrations and content | `kavenegar.go`, `sms_jobs.go`, `geocoding.go`, `settings.go`, `uploads.go`, `home_slides.go`, `suggestions.go` |
| Development data | `seed.go`, `demo_*.go`; historical fixtures remain in test files |

Avoid catch-all files such as `services.go` or placing category deletion in analytics. A new operation belongs with its business workflow. Extract a package when it has an independent contract; splitting interdependent transaction steps into packages only to make directories smaller adds coupling rather than removing it.

## Request lifecycle

1. `httpx.Observe` assigns a server-generated request ID and records method, route pattern, status, duration, and response bytes. Logs omit raw paths, query values, cookies, bodies, IPs, and credentials.
2. Application middleware sets response security headers, recovers panics, and attaches a 15-second context deadline, including public reads and webhook processing.
3. The production catalog gate blocks purchasing and provider mutations. Public catalog reads and the webhook hint endpoint do not create anonymous sessions.
4. Other API requests load the correct customer or staff session. Cookie rotation, expired-session behavior, exact Origin checks, and CSRF validation retain the existing contract.
5. Staff routes declare the exact capability, such as `products.create` or `orders.edit`, next to the handler. Authorization no longer infers permissions from URL fragments or mutating HTTP methods. Request-detail permissions still depend on the stored request kind. The owner workspace additionally requires owner role and TOTP elevation.
6. The handler validates input, invokes a read model or coordinates a transaction, and returns the existing API shape. JSON requests must contain exactly one document, reject unknown struct fields, and stay within 1 MiB. Uploads use their separate bounded path.

The 119 existing method/path patterns are preserved. Request fields and response envelopes remain compatible; concatenated JSON documents and trailing garbage are now rejected instead of silently ignored.

## Transactions and durable work

Use the pool for independent reads and `pgx.Tx` for an atomic business change. Pass the transaction to lower-level functions rather than opening an unrelated pool operation inside the transaction. Keep order snapshots, audit records, quote consumption, commission entries, and milestone jobs in the transaction that establishes their business meaning.

Checkout still locks customer/cart/product state, recomputes prices, validates and consumes the bound shipping quote, and commits an idempotent order. Carrier network calls do not occur inside the checkout transaction. Delivery creation and cancellation retain durable attempt references and leases; ambiguous outcomes require lookup or staff resolution rather than a blind resend. Existing uniqueness constraints remain authoritative under concurrent requests.

The process registers independent serial jobs:

| Job | Interval | Enabled |
| --- | --- | --- |
| Report exports | 3 seconds | All modes |
| Shipment processing | 30 seconds | Development simulation mode |
| Unpaid-order expiry | 30 seconds | Development simulation mode |
| SMS delivery | 5 seconds | Development simulation mode; provider sends also require SMS configuration |

A job never overlaps itself within one process. Database claims/leases coordinate multiple processes. Slow carrier calls no longer delay reservation expiry. SMS retains its independent scheduling and conservative retry policy. Report generation has an eight-minute timeout inside a ten-minute recovery lease.

On a termination signal or HTTP serving error, the server cancels background work, attempts HTTP drainage for five seconds, closes connections if drainage times out, and joins workers before returning to the composition root. The pool closes afterward. A job must honor context cancellation and bound any detached completion writes. Startup failures also run resource cleanup before `main` reports failure.

## Performance decisions

- **Batched order reads:** a nonempty page uses five queries: orders, items, order events, delivery projections/latest contact, and delivery events. Previously it used three initial queries plus one or more delivery queries per order (203 queries for 100 postal orders; up to 403 for 100 delivered provider-courier orders). Empty pages stop after the first query. Customer projections do not decode packing geometry, pickup details, or full provider payloads.
- **Indexed latest attempts:** migration `025_order_delivery_lookup.sql` adds `(order_id, created_at DESC, id DESC)` for deterministic latest-attempt reads. It adds an index without rewriting business records. As with the existing migration runner, index creation is transactional and can briefly block writers; apply through the normal maintenance/deployment procedure.
- **Export allocation:** workbook columns are resolved once per result set instead of allocating a column map for every row. Tehran timezone data loads once. The compressed workbook still resides in memory before it is stored in PostgreSQL; export memory usage grows with output size.
- **Hot validation:** postal tracking uses a bounded ASCII scan instead of compiling a regex on each call. SMS template/token regexes compile once. Session permissions are calculated once per authenticated request.
- **Proxy parsing:** Go 1.27 `strings.CutLast` walks forwarded hops without building a split slice.
- **No speculative caches:** there is no new application cache to invalidate for permissions, prices, stock flags, or shipping configuration. Existing query/page and packing bounds remain enforced.

Measured on the development machine with Go 1.27.3, the postal-tracking microbenchmark changed from approximately 9,307 ns/op, 19,502 B/op and 218 allocations to 14.68 ns/op and zero allocations. This measures only the validator, not end-to-end request latency. The order-query regression test verifies both 1- and 100-order pages and checks contact privacy, historical orders, and customer isolation.

## Go version and compatibility

The module and Docker build require **Go 1.27.3**, the current 1.27 security patch used for verification. CI reads the version from `go.mod`. Official references: [Go 1.27 release notes](https://go.dev/doc/go1.27) and [release history](https://go.dev/doc/devel/release).

The implementation uses the modern standard library where it reduces code: `strings.CutLast`, `sync.WaitGroup.Go`, `errors.AsType`, iterator-based splitting, typed slice helpers, `crypto/pbkdf2`, and `cipher.NewGCMWithRandomNonce`. The new encryption API preserves the existing nonce-prefixed `v1:` ciphertext format; tests check both reading old ciphertext and reading new ciphertext with the previous implementation.

Public JSON continues to use `encoding/json` compatibility semantics. A wholesale switch to `encoding/json/v2` would change nil slice/map and field-matching behavior and needs a separate contract decision. Generic methods and experimental SIMD do not simplify these workflows and are not introduced merely to use a new language feature.

Existing password records, opaque IDs, session cookies, permission restrictions, API routes, historical order snapshots, and migrations 001–024 remain supported. Legacy fixtures stay test-only. The old combined `requests` capability remains an intentional compatibility value; removing stored restrictions or historical shipping behavior would require an explicit data migration.

## Verification and extension

From `backend/`:

```sh
go test ./...
TEST_DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/test_database?sslmode=disable' go test -race ./...
go vet ./...
go fix -diff ./...
CGO_ENABLED=0 go build -trimpath -o /tmp/bomish-server ./cmd/server
go test ./internal/domain -run '^$' -bench BenchmarkPostalTracking -benchmem
```

Database tests create and drop isolated schemas. They require a disposable PostgreSQL database with schema/extension permissions. Test setup serializes initial `pg_trgm` installation with the migration lock to avoid cross-package races on a fresh database. Without `TEST_DATABASE_URL`, database tests skip; a unit-only pass is not sufficient verification of this backend.

The regression suite covers authorization, session isolation, checkout concurrency/idempotency, coupon limits, commissions, packaging propagation, delivery state, SMS ambiguity/retries, report/export behavior, and migrations. Additional tests cover module dependency direction, bounded order query counts, strict decoding, deterministic TOTP windows, ciphertext compatibility, configured upload roots, and graceful request/worker shutdown. Browser and live provider tests remain separate from this backend verification.

### Rework verification recorded on 2026-10-25

- Go 1.27.3: full PostgreSQL suite with `-race` passed (217 test/subtest passes). The opt-in scale test was then run separately and passed.
- Scale fixture: 1,000 additional products, 1,000 additional staff accounts, 100,000 orders, and 1,000,000 analytics events. The fixture, paginated reads, comparison aggregation, and XLSX export completed in 15.0 seconds. On this local run, the 100,000-order staff page took about 148 ms and the product analytics page about 273 ms. These are local observations, not production latency guarantees.
- `go vet ./...`, `go fix -diff ./...`, a static production binary build, and `git diff --check` passed.
- The compiled binary passed repeated migrations, readiness, seeded catalog pagination, staff password login, owner-elevation enforcement, the production-style catalog purchase gate, an authenticated image upload/public-read round trip, and SIGTERM shutdown with exit status zero.
- No browser suite, real payment, live SMS/carrier, container image scan, or production deployment was run as part of this backend rework.

When adding a feature:

1. Put deterministic business rules in `domain` (or an existing pure policy package).
2. Put read projections in their query module; avoid per-row database calls.
3. Keep related writes, audits, and durable jobs in one application transaction.
4. Register the route and exact capability together; update OpenAPI if the contract changes.
5. Add a new migration for persisted changes; never rewrite a released migration.
6. Test observable invariants and failure behavior, including concurrency when money or external work is involved.

See [architecture and business invariants](architecture.md), [integration behavior](integrations.md), and [production deployment](production.md) for the detailed operating contracts.
