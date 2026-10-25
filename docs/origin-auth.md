# Authenticated Origin Pulls for Bomish

Traefik can require TLS client certificates on the public HTTPS entrypoint. Cloudflare uses its global AOP identity; local deployment checks use a separate, host-only client identity. The existing origin server certificate and key remain unchanged. Keep Full (strict) and the Cloudflare-only ingress firewall in place.

Global AOP proves that a request comes from Cloudflare's network, not exclusively this Cloudflare account. Account-specific isolation requires a custom zone-level AOP identity. See [Cloudflare's global AOP setup](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/).

## Files and modes

| File under `SECRETS_DIR` | Purpose |
| --- | --- |
| `tls/cloudflare-origin-pull-ca.pem` | Public CA for Cloudflare's global AOP clients |
| `tls/local-probe-ca.pem` | Public CA for this host's deployment probe |
| `origin-probe/client.crt` | One-year local client certificate |
| `origin-probe/client.key` | Private probe key, mode 0600, inside a 0700 directory |

Only `tls/` is mounted into Traefik. Never copy the probe key into that directory or mount `origin-probe/` in application containers. The temporary local CA signing key is deleted after provisioning. Preserve the probe identity in an encrypted administrative backup.

`ORIGIN_AUTH_MODE` in `/srv/bomish/deployment.env` supports:

- `off`: existing HTTPS behavior; does not require new credential files.
- `verify`: requests a client certificate and validates it if supplied; clients without a certificate can still connect. This is a rollout stage, **not enforcement**.
- `required`: requires a client certificate signed by either configured CA.

Preflight rejects invalid modes, missing or soon-expiring certificates, incorrect client chains/keys and exposed probe-key permissions. Origin probes keep the existing server-public-key pin, add the local client identity, and in `required` mode also verify that a new connection without a client certificate receives a TLS rejection. Public probes do not send the private local identity.

## Initial rollout

### Bomish activation — 2026-10-24

Activated on release `2975b7a94a0bd5d863c9258d2a621909cbb3d7da` after successful CI and production deployment. Cloudflare **Global AOP is On**, Full (strict) remains enabled, and `ORIGIN_AUTH_MODE=required` is persisted in `/srv/bomish/deployment.env` and present in the running Traefik container.

Production credentials were generated on the VPS under `/srv/bomish/secrets` using the official Cloudflare AOP CA. **Skip credential generation in step 2 for this server**; the initializer intentionally refuses to overwrite them. The local probe certificate expires on 2027-10-24 and the Cloudflare AOP CA expires on 2029-11-01. Renew the local probe before 2027-09-24 to leave a 30-day margin.

Activation progressed through `verify` before `required`, under the deployment lock with a saved environment rollback copy. Authenticated local origin probes and public Cloudflare checks passed; the origin probe also confirmed TLS rejection without a client certificate. All five production containers were healthy. Fresh external requests to API health, `/login` and `/staff` returned HTTP 200 through Cloudflare with DYNAMIC cache status. These entry-page checks do not constitute an authenticated staff workflow test. The next automatic deployment has not yet been observed, but it reads the persisted mode and uses the deployed AOP-aware probes.

### Procedure

1. Release the AOP-aware source through the normal verified deployment workflow, with the mode still `off`. Do not enable enforcement on a release whose local probe does not support it.
2. Download the public AOP CA from Cloudflare and generate the private local probe identity **on the VPS**:

```sh
cd /srv/bomish/current
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem \
  -o /tmp/bomish-cloudflare-origin-pull-ca.pem
openssl x509 -in /tmp/bomish-cloudflare-origin-pull-ca.pem -noout -subject -issuer -dates
python3 scripts/init-origin-auth.py /srv/bomish/secrets \
  --cloudflare-ca /tmp/bomish-cloudflare-origin-pull-ca.pem
```

The setup command refuses existing credential files. Do not delete or regenerate credentials during routine deployments. The input must be Cloudflare's **AOP CA**, not its Origin CA server certificate.

3. Set `ORIGIN_AUTH_MODE=verify` in the nonsecret deployment env file. Use the existing deployment lock while changing/recreating Traefik; avoid overlapping Actions deployments. From the active source directory:

```sh
docker compose --env-file /srv/bomish/deployment.env \
  --env-file /srv/bomish/images.env -f compose.production.yaml \
  up -d --no-deps --force-recreate --wait --wait-timeout 60 traefik
python3 scripts/verify-site.py --config /srv/bomish/deployment.env \
  --images /srv/bomish/images.env --origin
python3 scripts/verify-site.py --public-url https://bomish.ir
```

4. In the Cloudflare zone, select **SSL/TLS → Origin Server → Authenticated Origin Pulls → Global: On**. Leave zone-level/per-hostname certificate settings unchanged. Check public requests again.
5. Set `ORIGIN_AUTH_MODE=required`, recreate only Traefik using the command above, and rerun both checks. A single Traefik instance may have a brief interruption during recreation. Have a second SSH session and the previous env settings ready. If public validation fails, immediately restore the previously working mode and recreate Traefik; investigate before trying again.
6. Verify a fresh uncached API request externally and the application's staff workflow. Verify that origin checks work with the local identity and fail without it. Verify the next automatic deployment retains `required`.

The Traefik container's own health check uses its private metrics entrypoint and needs no client certificate. A healthy container alone does not prove public AOP works; the public and origin probes are both necessary.

## Maintenance and rollback

- Track the client certificate expiry (one year) and both CA expiries. Preflight requires at least seven days remaining. Add an expiry alert at least 30 days before the earliest date; an expiring local probe could block deployment even while public traffic works.
- For renewal, generate a new identity using the setup command in a separate private secrets directory with a `tls` subdirectory. While `required` remains active, temporarily trust both old and new local public CAs in `tls/local-probe-ca.pem`, recreate Traefik, switch the host-only probe cert/key to the new pair and verify. Then remove the old CA, recreate and verify again. Keep old material for rollback until finished. The generator never performs this rotation automatically.
- Do not disable Cloudflare AOP while the origin requires its certificate. First restore a working origin configuration, then adjust the Cloudflare side if necessary. Disabling enforcement is a deliberate security rollback, not an automatic response to any public failure.
- Application rollback must use an AOP-aware source revision. A pre-AOP Compose file does not forward `ORIGIN_AUTH_MODE`, and a pre-AOP probe cannot authenticate. Retain a working AOP-aware source with the older application image digests rather than rolling security configuration back accidentally.
- Keep the credential files outside Git, images, logs and CI artifacts. Do not send the local client key to Cloudflare; only the global toggle is used.

## Tests

```sh
python3 -m unittest discover -s scripts/tests -v
# Requires an already-present Traefik image; never pulls images or mounts app data.
bash scripts/verify-origin-auth.sh
```

The isolated container test binds a random loopback port, uses disposable test keys and checks off/verify/required against two trusted identities, an untrusted identity and no identity. It removes its own container and temporary fixtures. The full production-container smoke test also runs with AOP required and uses the local probe for its catalog/backup acceptance checks. Neither test should use production credentials.
