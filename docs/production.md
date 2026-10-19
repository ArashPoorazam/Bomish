# Production catalog on bomish.ir

This release supports a public catalog, content management and staff workspaces. It deliberately blocks customer sign-in, cart changes, checkout, simulated payments and carrier callbacks in production. Live selling remains a separate release gate in [launch.md](launch.md). Develop locally, review changes in Git, and promote tested image digests; never edit code inside running production containers.

No VPS or Cloudflare changes are performed by this repository. Complete the steps below on your server after CI passes. Use a fresh production database, not the development volume or demo dump.

## Owner and categories

Run the interactive `owner-tools bootstrap-owner` command below after migrations. It asks for the owner's name, username, password twice, and an authenticator confirmation. There is no default production password and no SQL account creation required. Bootstrap refuses to overwrite an existing owner. Keep the authenticator key private; the tool's container logging is disabled to keep it out of Docker/Loki logs. Do not record the terminal or run this command in CI.

Staff sign into `/staff` with username and password only. An owner first signs in with a password, then supplies an authenticator code to unlock `/omnisire`. The API enforces both owner role and verification, rotates the session token on unlock, rejects reused codes, and rate-limits attempts. Verification lasts for the remaining staff session (maximum eight hours); logging out or recovering credentials removes it. Staff members cannot enter Omnisire even if an old permission override named an owner section. Staff shipping is available at `/staff/shipping` without 2FA.

Migration 022 creates `seeds` (دانه‌های خوراکی), `herbs` (سبزی‌های خشک), and `spices` (ادویه‌ها). The homepage links use these identifiers automatically. Existing names/content are preserved; these three categories cannot be deleted because navigation depends on them. You can edit their details, add other categories, and create products through the dashboard. Fresh production has no demo products or staff. The migration invalidates existing staff sessions once.

## Deployment prerequisites

- Docker Engine with the Compose v2 plugin, Git, Python 3, `flock`, and working time synchronization on the VPS. Maintain host security updates, SSH keys, and disk capacity.
- A checkout of the exact release commit. GitHub Actions publishes API, web and backup images to GHCR only after the verification workflow succeeds. Download that commit's `images.env` artifact. If packages are private, authenticate the VPS to GHCR with a read-packages credential.
- Cloudflare DNS for `bomish.ir` pointing at the VPS with proxying enabled. Use **Full (strict)** TLS with an origin certificate/key covering `bomish.ir`. This setup uses your supplied certificate; it does not automatically obtain or renew one. Track its expiry. Add a separate Cloudflare redirect for `www` if wanted; the repository routes only `SITE_HOST`.
- Restrict origin HTTP/HTTPS ingress to current Cloudflare address ranges; restrict SSH to your administrative access. Account for Docker's firewall chains as well as the host firewall. Database, API, metrics, Loki and the Traefik dashboard are not publicly published. Grafana binds to loopback only.
- An off-VPS S3-compatible bucket and dedicated credentials scoped to its backup prefix (list/read/write/delete for restic retention). Retain an independently protected copy or bucket version history against compromise of those credentials. Backup success on the VPS alone does not establish disaster recovery.
- Separate production and staging secrets, networks, volumes and backup prefixes. Run staging on a separate host, or use a reviewed Compose override for published ports/subnets. The supplied files bind 80/443 and are intended for one deployment per host.

See the official [Cloudflare IP list](https://www.cloudflare.com/ips/), [Origin CA instructions](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/), and [restic S3 setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#amazon-s3). Do not copy stale IP ranges from an old guide.

## First installation

The examples assume the checkout is `/srv/bomish/app`, with configuration and secrets outside it. Run as the deployment account with Docker access. Create its parent directory with appropriate ownership first.

```sh
cd /srv/bomish/app
python3 scripts/init-deployment.py /srv/bomish/secrets
cp deploy/production.env.example /srv/bomish/deployment.env
# Place the verified release artifact at /srv/bomish/images.env.
```

The generator refuses an existing directory and prints no passwords. The secrets directory is mode 0700; files are readable within their mounted containers. Keep it outside Git. Fill `backup_credentials` with your S3 credentials and install `tls/origin.crt` and `tls/origin.key`. When editing a generated file, temporarily give its owner write permission and restore mode 0444 afterward. TLS files must be readable inside Traefik; their host directory is private. Save a separate encrypted copy of all credentials/configuration, especially **restic_password and totp_key**, in a password manager. They are not included in the data backup. Losing the restic password makes that backup unrecoverable; losing the TOTP encryption key requires owner recovery.

Edit `/srv/bomish/deployment.env`:

- `SITE_HOST=bomish.ir`, `SECRETS_DIR=/srv/bomish/secrets`, and a unique off-server `RESTIC_REPOSITORY`.
- `CLOUDFLARE_CIDRS`: current IPv4 and IPv6 ranges, comma-separated.
- `TRUSTED_PROXY_CIDRS`: the `EDGE_SUBNET` plus those same Cloudflare ranges. Never trust all addresses. This is used for login rate limiting behind the proxy chain.
- Leave `SITE_INDEXABLE=false` until content is approved. Image assignments come from the second env file (`images.env`) and override the blank placeholders.
- Review/pin infrastructure image digests before rollout. PostgreSQL major-version upgrades require a separate migration plan, not a tag replacement.

Define this helper in your terminal from the checkout:

```sh
prod() {
  docker compose --env-file /srv/bomish/deployment.env \
    --env-file /srv/bomish/images.env -f compose.production.yaml "$@"
}
prod config --quiet
prod pull db api web migrate backup traefik
prod up -d --wait db
prod run --rm migrate
prod run --rm owner-tools bootstrap-owner
prod run --rm --no-deps backup init
bash scripts/deploy.sh /srv/bomish/deployment.env /srv/bomish/images.env
```

Initialize restic once for a new repository. For an existing repository use the original password and run `backup check` instead of `init`. Database initialization creates separate application and migration roles only when the PostgreSQL volume is empty. Changing a secret file later does not change an existing database role password; rotate the database password and its mounted files together.

Check `https://bomish.ir/api/v1/health`, homepage/category navigation, password-only staff login and owner unlock from an external browser. Create real merchant content and confirm uploads persist through an API recreation. Confirm checkout returns 503 and no customer checkout controls appear. Verify backup snapshots and receive a test alert before opening traffic. Set `SITE_INDEXABLE=true` and redeploy when the public catalog is ready.

## Logs and monitoring

The API emits JSON request logs with generated request IDs, route patterns, status, duration and response size. The response includes `X-Request-ID`; business audit events also include it. Access logs omit query strings, cookies, credentials, OTPs, bodies, customer addresses and raw client IPs. Business audit records retain the domain details required for staff activity/history and should have restricted access. This is operational and business logging, not recording every user input. Docker log files rotate at 10 MB × 5 per main service; request logging starts when the service runs.

```sh
prod logs --since 15m api web traefik backup
prod run --rm --no-deps backup snapshots
```

For centralized search and alerts, copy `deploy/monitoring/alertmanager.example.yaml` to `/srv/bomish/secrets/alertmanager.yaml`, configure your real webhook receiver, and make the file container-readable. Then:

```sh
docker compose --env-file /srv/bomish/deployment.env \
  --env-file /srv/bomish/images.env \
  -f compose.production.yaml -f compose.observability.yaml \
  up -d prometheus alertmanager node-exporter blackbox loki alloy grafana
```

Grafana is at VPS loopback port 3300 (use an SSH tunnel), username `admin`, password in `grafana_password`. Prometheus and Loki data sources are provisioned. In Explore, start with `{service="api"} | json` or `{service="api"} | json | request_id="THE_ID"`. Alloy reads Docker JSON log files, not the Docker socket; adjust `DOCKER_LOG_DIR` for a nonstandard/rootless Docker install. Restrict access to this collector because it reads container logs on the host.

Loki retention is 14 days; Prometheus retains at most 15 days/2 GB. Alerts cover failed HTTP probes, missing scrape targets, backups older than two hours, disk/memory pressure and elevated HTTP 5xx rates. Validate that your receiver actually delivers an alert. Configure an **external** HTTPS uptime/TLS monitor as well: monitoring on this VPS cannot notify you if the whole VPS is down. Local logs/metrics are not part of the backup; audit tables are.

The optional monitoring stack adds material RAM/disk usage. Check capacity before enabling it and monitor Loki disk growth. The supplied limits are starting limits, not a load-tested sizing guarantee.

## Backups and restore drills

The backup container runs once on start and then waits an hour after each completed attempt. It dumps PostgreSQL in custom format, then snapshots that dump and the uploads volume with encrypted restic. Upload names are immutable; do not introduce physical deletion during backups without adding coordination. Concurrent scheduled and pre-deployment runs are serialized by a shared lock. Retention keeps 48 hourly, 7 daily, 4 weekly and 6 monthly snapshots; pruning and a repository structure check run daily. A failure never advances the success timestamp. Expected data-loss exposure is roughly an hour plus backup duration while jobs are healthy; this is not point-in-time recovery. Schedule PostgreSQL WAL archiving separately before requiring a smaller recovery window.

```sh
prod run --rm --no-deps backup once
prod run --rm --no-deps backup snapshots
prod run --rm --no-deps backup check   # Reads stored data; allow time/bandwidth.
```

Perform an isolated restore drill before launch and at least monthly. Choose a recorded snapshot ID rather than relying on “latest” during an incident. From the checkout, create a private restore directory and restore through the backup image:

```sh
mkdir -p /srv/bomish/restore-drill
chmod 700 /srv/bomish/restore-drill
prod run --rm --no-deps -v /srv/bomish/restore-drill:/restore \
  backup restore SNAPSHOT_ID --target /restore
```

The output includes `backup/database.dump` and `uploads/`. On an isolated PostgreSQL 18 instance, create a **new empty database**, restore using `scripts/restore-check.sh` with `RESTORE_DATABASE_URL`, then check product/category/staff/audit counts, representative uploaded files and an isolated application connected to the restored database. Record the snapshot ID, results and restore duration. Never point this drill at the working production database. The container CI smoke test also restores a fresh dump and a sample uploaded file.

For actual disaster recovery, keep the old volume/snapshot intact, provision a fresh host or isolated replacement database, and restore there first. Restore as `bomish_migrator` (or using `pg_restore --role=bomish_migrator --no-owner --no-acl`) so subsequent migrations own their tables. A new empty target database owned by `bomish_migrator` lets it recreate trusted extensions. After restore, grant the runtime role access in that target database:

```sql
REVOKE ALL ON DATABASE bomish_restored FROM PUBLIC;
GRANT CONNECT ON DATABASE bomish_restored TO bomish_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bomish_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bomish_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bomish_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bomish_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bomish_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bomish_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bomish_app;
```

Run these statements connected to the restored database as its administrator. Restore uploads into a new volume readable/writable by the API image's `bomish` user. Restore the original TOTP key from the password manager. Update both database URL secrets to the replacement database name and the backup service's `PGDATABASE` in a reviewed Compose override. Revoke restored staff sessions before reopening access, since backups may predate logout/recovery. Validate data and the application before switching traffic. Record the incident and any data lost since the snapshot. Do not restore a dump over the existing live schema.

## Owner recovery

On the VPS, use the same release and secrets:

```sh
prod run --rm owner-tools recover-owner
```

Enter the existing owner's username, a new password and confirm a new authenticator. This replaces both credentials, revokes their sessions, and records an audit event. It does not create another owner or affect staff credentials. Anyone able to run this command with database secrets is effectively a production administrator; protect SSH/Docker access accordingly. Do not regenerate `totp_key` during normal deployment.

## CI, updates and rollback

`Verify Bomish` runs Go integration tests with the race detector, vet, OpenAPI regeneration consistency, TypeScript/format/build checks, existing simulation browser regressions and new catalog acceptance tests. A separate job builds real production containers, exercises TLS routing and migrations without demo seeds, verifies least-privilege schema access, and backs up/restores the database and an upload. Trivy gates fixable high/critical image vulnerabilities; findings without fixes still require review. Dependabot proposes weekly dependency updates.

The publish workflow runs only after successful pushes to `main`, builds images with provenance/SBOM, scans the resulting published digests again, and supplies immutable digest references in `images.env` only after those scans pass. Configure branch protection to require all verification jobs. The workflow does not SSH into the server or deploy automatically. Review scan results and run the first complete workflow before promoting this release. For updates, check out the matching commit, download its artifact, then run `scripts/deploy.sh` with the two absolute file paths.

The deployment script serializes releases, pulls images, makes a pre-migration backup after the first recorded deployment, runs migrations once, waits for health checks and checks catalog mode. It records `release-state/current.env` and `previous.env` beside deployment.env. A failed application health check attempts to restart the previous images. Database migrations are **not** automatically reverted. Future schema changes must be backward compatible with the prior image; destructive migrations need a separately reviewed maintenance/recovery plan. This single-VPS Compose setup may have brief downtime during recreation and does not provide high availability.

For a manual application rollback, use `release-state/previous.env` with the checkout/configuration for that release after checking schema compatibility. Restore data only for an explicit database recovery, never as an automatic response to a frontend failure. Review infrastructure image updates and backup-format/PostgreSQL compatibility separately from ordinary application releases.

## Current verification gate

The implementation is prepared, but deployment approval depends on finishing the outstanding browser regressions and obtaining green CI. See [verification status](verification.md#remaining-acceptance-work). Container builds, Traefik routing, restic restore and vulnerability scans have not been run on this workstation because Docker daemon access is unavailable. The image publishing workflow currently builds Linux amd64 images; an ARM VPS requires adding and validating the appropriate build platform before release.
