# Live-sales gate and operating guide

The production release supports catalog browsing and staff content management only. Follow [production.md](production.md) for Docker/Traefik deployment, owner bootstrap, database migrations, monitoring and backup/recovery. `APP_ENV=production` requires `STORE_MODE=catalog`; simulation is restricted to development.

Before live sales:

1. Configure and verify the implemented Kavenegar adapter (see integrations.md), choose the payment provider and obtain merchant credentials. Implement the payment adapter, callback signature/reference/amount verification, pending-result reconciliation, durable retries and provider timeouts. Verify real sandbox and live transactions. Remove all simulation UI and endpoints in production. Preserve the tested idempotency, availability checks and package purchase limits.
2. Configure a real domain and HTTPS reverse proxy. Set the exact `APP_ORIGIN`, keep the API and PostgreSQL private, restrict proxy forwarding headers, and set trusted proxy handling for per-client rate limiting. Configure the trusted proxy chain so per-client rate limits use the correct address. Use TLS to remote PostgreSQL and an application database role separate from the migration role.
3. Bootstrap fresh owner credentials with the interactive command. Staff use passwords; only the owner workspace requires 2FA. Preserve the external TOTP encryption key and verify owner recovery. Remove development staff, products, articles and orders by starting with a clean production database.
4. Configure real delivery regions and tariffs, packaging weights, dispatch estimates, contact information, return policy and business content. Upload actual product photos and confirm ingredients/allergen details. Nutrition fields must have a reliable source; no invented values are seeded.
5. Configure durable uploads or implement an S3-compatible `storage.Store`, image proxy and backup policy. Back up both database and uploads. Set an off-host schedule, retention, encryption and alerts; the production backup container provides hourly encrypted snapshots and daily retention checks; configure its off-host destination and verify alerts.
6. Run a restore drill, concurrent purchase tests, mobile/keyboard checks, provider outage tests, payment replay tests and an actual end-to-end purchase. Enable search engine indexing only after launch content is ready (`SITE_INDEXABLE=true` and `SITE_URL`).

## Backup and restore drill

```sh
DATABASE_URL='postgres://…/bomish' scripts/backup.sh /secure/backup-directory
# Create a NEW EMPTY temporary verification database first.
RESTORE_DATABASE_URL='postgres://…/bomish_restore_test' scripts/restore-check.sh /secure/backup-directory/bomish-TIMESTAMP.dump
```

`restore-check.sh` refuses a non-empty destination. Confirm restored product/order counts and test a read-only application instance against the restored database. Snapshot the configured uploads directory or object store separately. Do not commit backups or credentials.

## Monitor

`GET /api/v1/health` checks database connectivity. Capture structured API logs and reservation worker errors. Alert on failed health checks, persistent payment failures, overdue pending orders, `review` orders and missed backups. Query examples:

```sql
SELECT id, created_at FROM orders WHERE status='review';
SELECT id, reservation_expires_at FROM orders
 WHERE status='pending' AND reservation_expires_at < now() - interval '2 minutes';
SELECT status, count(*) FROM payment_attempts GROUP BY status;
```

Before traffic grows, add request metrics, provider delivery/error metrics and periodic cleanup of expired sessions, rate-limit rows and unused uploads. For large catalogs, add paginated listing APIs and improve Persian relevance with a real merchant search corpus.

## Shipping activation gate

Calculated shipping is available for development simulation. Live activation remains blocked in code, including when server credentials are present. Before enabling a live adapter:

- Verify the real Tehran pickup contact, full postal address and pin; confirm the permitted service polygon, city and account service category.
- Measure and physically trial all active product packages and boxes, including internal/external sizes, protection, filler, stacking suitability and gross load ceilings. Publish the completed measurements; use the catalog's incomplete-shipping filter.
- Verify Snapp credentials, current booking/lookup/cancel wire contract, wallet behavior, monetary unit, rate limits, cancellation fees, driver state semantics and callback authentication. Implement/install the verified `SnappContract`; fixture verification is not live certification.
- Verify Tapin merchant shop quotation authentication, service IDs, locality and exterior-box mappings, parcel limits, request/response currency and inclusive tariff total against actual dispatch.
- Configure HTTPS callback delivery and a monitored worker. Unauthenticated callbacks remain lookup hints; they must never mutate an order from their payload alone. Test provider timeouts after booking, restarts, missed callbacks and cancellation ambiguity in an authorized provider test account.
- Verify existing production payment/SMS requirements independently. Nothing in shipping bypasses the production catalog-only restriction.

Shipping uses calculated quotes only. Setup can be saved incrementally, but checkout requires valid origin, destinations, measurements, cartons and available providers. Configuration changes invalidate unconsumed quotes by version; existing orders retain their agreed invoice and shipping snapshot. Fixed-tariff rollback is no longer supported.
