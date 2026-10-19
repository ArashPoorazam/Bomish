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

## Shipping verification

Use a disposable seeded PostgreSQL database, an isolated API port and frontend `API_URL`. Never run the shipping browser fixture against the merchant database: it publishes measurement fixtures and switches the **test store** to calculated mode. Start the API with `APP_ENV=development SHIPPING_SIMULATED=true SMS_ENABLED=false SEED_DEMO=true`; do not source the merchant `.env` for this test.

Backend: `TEST_DATABASE_URL=... go test -race ./...` and `go vet ./...`. Tests create isolated schemas. Shipping tests cover geometry/support/rotation/weight/work limits, measurement drafts and publication, calculated-only configuration and historical-order preservation, quote binding and expiry, explicit fallback, serviceability with free shipping, invoice immutability, postal barcode uniqueness/nullable costs, role restrictions, uncertain create recovery, concurrent workers, cancellation replacement, callbacks/deduplication, monotonic status and customer data isolation. Provider HTTP tests use local fake servers only.

Frontend: regenerate types with `npm run api:generate`, then `npm run typecheck`, `npm run format:check`, `npm run build`. The opt-in real simulated journey is `DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/ISOLATED_SHIPPING_DB?sslmode=disable' SHIPPING_ACCEPTANCE=true BASE_URL=http://localhost:3100 CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/shipping.spec.ts`. It covers measurement entry with Persian decimals, setup, customer selection/payment, physical readiness, courier review/request and delivery, plus explicit postal fallback and multi-parcel tracking. Screenshots are written to Playwright's test-results directory. `tests/product-editor.spec.ts` additionally checks two independent variants, local copying and incomplete draft saves; existing staff-order tests cover historical orders.

Manual review remains required for real packing trials, live account wire contracts, actual tariffs, provider coverage, cancellation fees, callback authentication and accessibility with assistive technology. Automated and browser simulation cannot verify those external facts.

### Shipping results — 2026-10-08

- Full `go test -race ./...` passed with disposable PostgreSQL integration schemas (application suite: 171.592s). Final focused race regressions passed for provider-check persistence/environment isolation, unused-quote rejection after rollback, staff-only driver details, and recovery from an unknown lookup without regressing confirmed pickup (19.965s).
- `go vet ./...`, OpenAPI generation, frontend typecheck, formatting check and optimized production build passed. Provider fixture tests passed using local HTTP servers; no carrier endpoint was called for quotations or bookings.
- All 10 targeted Playwright tests passed: seven product-editor cases, one historical staff-order case, and two real API/database simulated shipping journeys. Narrow mobile measurements, checkout/postal fallback and customer progress, plus desktop dispatch review were visually inspected. Screenshots are in the ignored frontend `test-results` directory.
- Migration 012 applied successfully to the disposable database. No merchant database or credentials were used. The preexisting edit in migration 001 and the supplied handoff were preserved. No real courier, postage purchase or SMS was issued.
- Live shipping remains unavailable. The Snapp wire-contract implementation and installation of verified live adapters are still required, in addition to the operational prerequisites in `launch.md`; passing simulation does not complete that activation work.

## Kavenegar authentication and order notifications — 2026-10-13

- Backend tests and the full `go test -race ./...` suite passed against isolated schemas in a disposable PostgreSQL database. Focused race tests additionally covered the final migration and reopened-packing behavior; `go vet ./...` and SQL schema/query compilation passed.
- Provider calls were mocked. Coverage includes all six Lookup templates, OTP expiry/replay/attempt limits and failure cleanup, purchaser-number routing, milestone deduplication, concurrent workers, temporary rejection backoff, ambiguous results, interrupted workers, suppression of outdated messages, and disabled/pre-activation backlog exclusion.
- Calculated shipping tests verified that Snapp booking/acceptance sends no shipment SMS, pickup sends the Snapp template, delivery sends the delivered template, and multiple postal parcels retain their individual tracking links on the order page.
- Four browser journeys passed: customer/staff order progress and refresh, packing checklist controls, logged-in/logged-out/other-customer access through the same SMS order URL, and the existing owner/referral/fulfillment journey.
- Frontend type checks, formatting checks and production build passed. Test-generated preview configuration was removed; the merchant database and private integration settings were not changed.
- No live Kavenegar call or real SMS was issued. Account funding, template approval for the actual HTTPS domain, and merchant test-phone delivery remain activation prerequisites. Production payments and live Snapp activation remain separate work.


## Production catalog verification (2026-10-19)

Verification used a temporary PostgreSQL 18 cluster at port 55439, with separate test, catalog, restore and production-mode databases. No VPS, Cloudflare configuration or working merchant database was changed.

- All 148 backend tests passed with the race detector, including owner bootstrap/recovery, TOTP encryption and replay checks, password-only staff access, catalog restrictions, proxy handling and fresh/idempotent migrations. Compilation and vet also passed after the final log-redaction change.
- Frontend type checking, formatting, generated OpenAPI types and the optimized build passed. Catalog browser acceptance verified category navigation, hidden purchase controls, blocked transaction endpoints, staff password login and separate owner TOTP unlock/logout.
- Native production-mode migrations succeeded as the restricted migration role; API health, settings, base categories and checkout blocking succeeded as the runtime role. Interactive owner bootstrap succeeded in the verified temporary database.
- A custom-format database dump restored into an empty verification database with 30 products and zero orders. The final build also honored runtime noindex settings when built with indexing enabled.
- Production and monitoring Compose files validate structurally; shell scripts pass syntax checks. Docker daemon access is unavailable on this workstation. Image builds, actual Traefik routing, restic/container restore, monitoring runtime and vulnerability scans therefore remain required CI/VPS checks, not locally verified claims.

For repeatable catalog acceptance, use `STORE_MODE=catalog`, `SEED_DEMO=true`, `APP_ENV=development` on a disposable backend, then run `STORE_MODE=catalog BASE_URL=http://localhost:PORT npm run test:production` in frontend. Simulation regressions require a disposable `DATABASE_URL`, `STORE_MODE=simulation`, and a backend with `SHIPPING_SIMULATED=true`. The commerce helper applies shipping configuration only to that disposable database. `SHIPPING_ACCEPTANCE=true` enables the full shipping journeys. Never run these fixtures against production.

### Remaining acceptance work

The full browser suite is not yet green. The latest focused simulation rerun passed 14 of 18 journeys, including customer support/orders, SMS order-link authorization, staff permissions, publication, storefront checkout and price rounding. Three shipping cases failed after encountering incomplete draft fixtures; the fixture now limits publication to already published products. The discount-code journey encountered an outdated field label, which has also been corrected. Those last fixture corrections still need a fresh-database rerun. The custom-order conflict/refresh test also remains unresolved.

Further browser execution was blocked by automatic approval review reporting exhausted workspace credits. Do not deploy on the strength of these partial results: complete the browser regressions, then require both CI jobs and published-image scans to pass. Docker runtime verification remains outstanding as described above.

For repeated simulation suites, explicitly set `E2E_ISOLATED_DATABASE=true` with a local database named `bomish_browser` (or a name beginning with it). The test login helper clears only staff/owner authentication rate counters in that disposable database so independent journeys sharing one IP do not exhaust each other's quotas. Production rate limiting is unchanged. The suite requires the `psql` client. Use a fresh seeded database for a complete acceptance run.
