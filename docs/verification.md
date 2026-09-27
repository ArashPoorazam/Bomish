# Verification — 2026-09-26

## Package and staff improvements

- Go race tests passed against isolated PostgreSQL schemas, including mixed package lines, package limits, volume packages, aggregate stock and expiry, owner price controls, free-shipping thresholds, saved coordinates, stage sequencing, tracking links, analytics authorization, SMS job deduplication and simulated Kavenegar failure/retry handling.
- `go vet ./...` passed.
- Frontend production build passed before the final refinements. Final optimized compilation also passed, but the sandboxed build then failed to parse the TypeScript CLI configuration. Separate final `npm run typecheck` and `npm run format:check` passed.
- No real SMS was sent. Neshan and Kavenegar credentials were not live-tested.
- Browser tests were updated for package quantities and the new staff workflows; they have not been rerun for this change. The browser results below belong to the earlier baseline.
- Restarting the existing preview was rejected by automatic approval review because the workspace was out of credits. The running preview may still use the old API; migration 002 and configuration load on the next successful restart.

## Demo catalog follow-up

The previous restart block was resolved in the follow-up task. Migration 002 was applied, the native preview was restarted successfully, and six package-based demo products replaced the old public catalog. Old samples were archived to preserve historical orders. HTTP checks confirmed exactly six public samples, separate 200g and 500g salt cart lines with the expected total, development-code customer authentication, and successful responses for `/products`, `/products/demo-sea-salt`, `/account`, and `/staff`. No live SMS was sent. The verification cart was cleared and the test session logged out.

## Earlier baseline verification

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
