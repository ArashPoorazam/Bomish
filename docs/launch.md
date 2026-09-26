# Live-sales gate and operating guide

The current release is intentionally development-only. `APP_ENV` must be `development`; any other value fails closed on startup. Do not remove this check just to deploy the simulator. The local Compose deployment includes publicly documented development accounts and is bound to loopback.

Before live sales:

1. Choose the Iranian SMS and payment providers and obtain merchant credentials. Implement their server-side adapters, callback signature/reference/amount verification, pending-result reconciliation, durable retries and provider timeouts. Verify real sandbox and live transactions. Remove all simulation UI and endpoints in production. Preserve the tested idempotency and stock-reservation rules.
2. Configure a real domain and HTTPS reverse proxy. Set the exact `APP_ORIGIN`, keep the API and PostgreSQL private, restrict proxy forwarding headers, and set trusted proxy handling for per-client rate limiting. Current IP limits see the connecting proxy address; tune this when configuring the actual ingress. Use TLS to remote PostgreSQL and an application database role separate from the migration role.
3. Provision fresh owner credentials and individual staff authenticators. Encrypt TOTP secrets using a managed key before production; current development secrets are database-protected only. Add the owner's staff recovery/reset process and backup recovery procedure. Remove development staff, products, articles and orders by starting with a clean production database.
4. Configure real delivery regions and tariffs, packaging weights, dispatch estimates, contact information, return policy and business content. Upload actual product photos and confirm ingredients/allergen details. Nutrition fields must have a reliable source; no invented values are seeded.
5. Configure durable uploads or implement an S3-compatible `storage.Store`, image proxy and backup policy. Back up both database and uploads. Set an off-host schedule, retention, encryption and alerts; the repository provides manual helpers, not a running backup schedule.
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
