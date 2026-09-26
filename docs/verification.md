# Verification — 2026-09-26

Verified locally against PostgreSQL and the running Go/Next.js application:

- `go test -race ./...`: passed, including isolated PostgreSQL integration tests for draft publication, staff permissions, CSRF, OTP expiry/attempt caps/replay, session rotation, cart preservation, checkout idempotency, repeated payment confirmation, failed and expired reservations, late payment stock checks, competing purchases, order fulfillment, and shipping-band boundaries.
- `go vet ./...`: passed.
- `npm run typecheck`, `npm run format:check`, and `npm run build`: passed.
- Four Playwright journeys passed: Persian search/article navigation and responsive layout; mobile weight entry, cart focus and persistence; SMS → shipping → payment → order history; employee draft → owner publication/stock adjustment → public product → cart → archive.
- Desktop homepage and mobile product layouts inspected in Chromium; no browser errors reported. The final desktop screenshot is in the ignored `.data/screenshots/home-desktop.png` directory.
- A PostgreSQL custom-format backup restored successfully into a separate empty database, including six products and one order present at backup time. The store database was not replaced.
- Docker Compose configuration and shell script syntax validated. Container images were not built or run; application verification used the native Go/Node/PostgreSQL services.
- The one-command native launcher recognized the already-running store without starting duplicates.

The preview runs at http://localhost:3000, with staff access at /staff. The database persists in `.data/postgres`, uploads in `.data/uploads`. Test-generated products were archived after verification; demo customer orders remain as fulfillment examples. Real SMS, payments, production hosting and real merchant content have not been activated. See launch.md for the live-sales gate.
