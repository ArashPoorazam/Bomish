# Bomish: Cloudflare configuration and server improvement guide

Audited **24 October 2026, Asia/Tehran**, using the repository and read-only SSH inspection of `daedalus@185.27.44.53:2222`. Local HEAD and the active server release both match `46fa00308ebb75ee4d013da08a68cf0938918916`. No production settings were changed.

This guide distinguishes observed behavior from recommended settings. The Cloudflare account/dashboard, registrar account, provider firewall and root-only host firewall rules were not accessible. Successful public HTTPS does **not** prove that Full (strict), specific WAF rules, or account MFA are enabled. Confirm these in the dashboard. The recommendations use a conservative baseline; check the account's actual plan before adding paid features.

## 1. What is already running

```text
Visitors → Cloudflare DNS/CDN/WAF → Traefik :443
                                      ├─ /api/* and /uploads/* → Go API :8080
                                      └─ everything else      → Next.js :3000

Go API → private PostgreSQL 18 network
Backup container → encrypted restic snapshots in off-VPS S3 storage
```

The canonical website is `https://bomish.ir`. Production is a **catalog**, with staff login and the owner workspace. Customer authentication, checkout and carrier callbacks are intentionally disabled. Cloudflare setup does not enable live selling; follow [launch.md](launch.md) separately.

| Area | Observed result | Implication/action |
| --- | --- | --- |
| DNS | `chance.ns.cloudflare.com`, `surina.ns.cloudflare.com`; apex and `www` return Cloudflare addresses | Already onboarded; do not change nameservers unnecessarily |
| Public website | Homepage, health and settings return 200 through Cloudflare | Working baseline |
| `www` | `https://www.bomish.ir/` returns **404** | Add edge redirect to apex first |
| HTTP | Apex redirects to HTTPS and preserves path/query | Keep this behavior |
| HTML/API caching | Homepage `private, no-store`; API `no-store`; Cloudflare `DYNAMIC` | Correct privacy baseline |
| Static caching | Sample `/_next/static/` asset returns `HIT`, one-year immutable cache header | Static CDN acceleration already works |
| Search indexing | `SITE_INDEXABLE=false`; robots says `Disallow: /` | Intentional launch gate; change when content is ready |
| Origin certificate | Cloudflare Origin CA, apex + wildcard, expires **15 October 2041** | Valid today; not automatically renewed |
| Origin mTLS | No `clientAuth` in active Traefik TLS options | AOP is not enforced at origin |
| Proxy address lists | Saved IPv4/IPv6 CIDRs exactly match current Cloudflare lists | Keep both trust lists and firewall lists synchronized |
| Direct IPv4 ports | 22 and 2222 reachable; 80/443/5432/8080/3300 timed out from one external source | Consistent with filtering; does not prove complete firewall policy |
| IPv6 | Server has `2a13:5ac0:400::2300`; Docker and SSH listen on IPv6 | External test source has no IPv6 route; audit IPv6 separately |
| OS | Ubuntu 22.04.5, kernel 5.15.0-198; time synchronized | Plan OS lifecycle and routine patching |
| Capacity | 2 CPUs; about 1.9 GiB RAM, 2 GiB swap; 39 GB disk, 23% used | Adequate at observed idle load; limited headroom for full monitoring stack |
| Containers | All five healthy; zero restarts/OOM flags at inspection | Preserve existing deployment protections |
| Host SSH files | Root login and password/keyboard-interactive auth disabled; X11 forwarding enabled | Verify effective config, then remove unnecessary forwarding |
| Backups | 73 restic snapshots; latest at 23:24 Tehran on 23 October; success marker about 51 minutes old when checked | Backup activity verified; restore reliability still needs a drill |
| Monitoring | Optional monitoring containers absent; expected Alertmanager config absent | No local alert stack observed; external alerting status unknown |
| DNSSEC/email | No apex DS/DNSKEY answer; no `_dmarc` TXT answer; Cloudflare MX and SPF present | Investigate DNSSEC support; finish email authentication |
| Registry access | GHCR GET returns expected 401; direct Docker Hub GET returns `403 RBAC: access denied`; Docker mirror configured | Verify fresh digest pulls before maintenance; do not assume direct Hub access works |

Files governing production are [compose.production.yaml](../compose.production.yaml), [Traefik routes](../deploy/traefik/routes.yaml), [deployment template](../deploy/production.env.example), and [production runbook](production.md). The root `Caddyfile` and development Compose configuration are not the live ingress configuration.

## 2. Account and DNS setup

Start in Cloudflare by selecting the **existing `bomish.ir` zone**. Export its DNS records and record existing Rules, SSL/TLS settings and account members before editing. Use MFA/passkeys, individual administrator accounts, protected recovery codes, and registrar MFA/domain renewal protection where available. Use narrowly scoped API tokens only if automating; do not put a global API key in this repository or the application containers.

In **DNS → Records**, confirm this intended configuration. Public queries cannot reveal the configured origin value of proxied records, so verify that value in the dashboard.

| Type | Name | Target | Proxy/TTL |
| --- | --- | --- | --- |
| A | `@` | `185.27.44.53` | Proxied, Auto |
| CNAME | `www` | `bomish.ir` | Proxied, Auto |
| MX/TXT | Existing email records | Preserve existing provider values | DNS only / normal TXT |

Do not create a wildcard record or an `api` subdomain just for this app: it uses the same origin for frontend and API. Do not add an origin AAAA record until origin IPv6 routing and filtering have been tested. Visitors can already use IPv6 to Cloudflare while Cloudflare connects to an IPv4 origin. Avoid redundant A records pointing to old servers.

SSH continues to use the literal server IP and port 2222. If a DNS name is wanted for SSH, it must be DNS-only for ordinary SSH, and will disclose that IP. Standard orange-cloud HTTP proxying does not carry SSH port 2222. Keep GitHub `DEPLOY_HOST` pointed at the IP/direct SSH endpoint and **`DEPLOY_PORT=2222`**. [Cloudflare network ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/)

If rebuilding the zone later, preserve all mail and verification records, use the exact assigned nameservers, and coordinate old DNSSEC DS records before changing delegation. This domain is already delegated correctly. [Full DNS setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)

### Fix `www` now

In **Rules → Redirect Rules / Single Redirects**, create:

- Name: `www to canonical bomish.ir`.
- Custom expression: `http.host eq "www.bomish.ir"`.
- Dynamic destination: `concat("https://bomish.ir", http.request.uri.path)`.
- Status: **301**.
- **Preserve query string: On**.

Place it ahead of conflicting redirects. Keep the `www` DNS record proxied and its edge certificate active. Test both HTTP and HTTPS, including `/products?category=spices`. Traefik only routes `SITE_HOST=bomish.ir`, which explains the present `www` 404. The redirect should run at Cloudflare before reaching Traefik. [Single Redirects](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/)

### DNSSEC and email

Check the registrar/IRNIC's current DS-publication support before enabling DNSSEC. The audit confirmed signed `.ir` DS records through a validating resolver, but no DS or DNSKEY response for `bomish.ir`. If the registrar supports it, enable DNSSEC in **DNS → Settings**, publish Cloudflare's exact DS parameters through the registrar, then verify the chain with a validating resolver. Do not add a DS as an ordinary apex record inside the Cloudflare zone. Signing the child zone alone does not establish a root-to-domain chain. Support at this registrar was not verified. [DNSSEC](https://developers.cloudflare.com/dns/dnssec/), [validation troubleshooting](https://developers.cloudflare.com/dns/dnssec/troubleshooting/)

Existing mail DNS points to Cloudflare routing and includes `v=spf1 include:_spf.mx.cloudflare.net ~all`. Preserve it while confirming actual inbound destinations and outgoing mail providers. Maintain **one** SPF record, incorporating all legitimate senders; configure provider-specific DKIM; then add a DMARC record, initially monitoring, for example:

```text
Name: _dmarc
Type: TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@bomish.ir
```

Create and verify that mailbox/forwarding destination first. Move to `quarantine` and eventually `reject` after legitimate senders align. Receiving mail through Cloudflare is not evidence that outgoing mail has been authenticated. Do not replace working MX/SPF values with generic examples. [Cloudflare email domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)

No CAA answer was observed. CAA is optional follow-up: inventory the issuers needed by the active edge certificate products before restricting issuance, so renewals remain possible.

## 3. SSL/TLS and security headers

| Dashboard setting | Recommended value for Bomish |
| --- | --- |
| SSL/TLS → Overview | **Full (strict)**, explicitly verify |
| Universal SSL | Enabled; apex and `www` certificates active |
| Always Use HTTPS | On |
| Minimum TLS version | 1.2 |
| TLS 1.3 | On |
| 0-RTT | Leave off initially |
| Certificate Transparency alerts | Enable and route to a monitored mailbox |
| HSTS | Keep current origin-managed `max-age=86400` initially |
| HSTS includeSubDomains/preload | Leave off until all subdomains and recovery procedures are ready |
| Automatic HTTPS Rewrites | Optional safety net; correct mixed-content URLs in the app |

Full (strict) verifies the origin certificate as well as encrypting the connection. Flexible is unsuitable for the existing origin HTTPS redirect. Current origin files are `/srv/bomish/secrets/tls/origin.crt` and `origin.key`; the directory is private. No new certificate is required just to finish this setup. [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [minimum TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/), [TLS 1.3](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/tls-13/)

The origin uses Cloudflare Origin CA. Ordinary browsers do not trust that certificate directly. Turning off proxying or pausing Cloudflare is therefore **not** a ready-made outage fallback; the origin firewall may also block direct visitors. A direct fallback requires a public-trust certificate, deliberate firewall changes and testing. Keep the origin private key backed up securely and track expiry even though it is long-lived. [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)

Traefik already supplies nosniff, frame denial, referrer policy, permissions policy and one-day HSTS. Keep one authoritative configuration for these headers rather than adding conflicting Cloudflare response transforms. After stable operation, increase HSTS gradually. A Content Security Policy is a separate application improvement: deploy **Report-Only** first and account for Next.js scripts, map resources, images and any challenge scripts; do not paste a generic strict policy into production.

### Authenticated Origin Pulls: useful, but requires project changes first

Update, 2026-10-24: the project changes and server credentials are prepared, with activation pending the owner's commit, push and deployment. Follow the current [AOP rollout and handoff](origin-auth.md), including the instruction to skip credential generation on this VPS.

Origin CA verifies the server to Cloudflare. AOP verifies Cloudflare's client connection to the server. The current Traefik config does not require that client certificate.

1. Choose global AOP or a custom zone-level certificate. Global AOP's shared certificate proves Cloudflare-network origin; a custom zone certificate provides a narrower identity.
2. Install the appropriate AOP trust CA in the existing private TLS directory, mounted into Traefik under `/certs`. This is different from `origin.crt`.
3. Stage `VerifyClientCertIfGiven`, enable the corresponding AOP option in Cloudflare, and verify public requests.
4. **Update the local deployment probes before requiring client certificates.** `scripts/verify-site.py --origin` connects directly to `127.0.0.1:443` with no client certificate. `RequireAndVerifyClientCert` would break deployments and possibly trigger rollback. Use a separate client CA/certificate for local probes and trust that CA alongside the AOP CA, or implement a separately secured loopback-only probe listener. Keep the test client key outside Git.
5. Then enforce mTLS, test public access, local deployment probes and rejection of unauthenticated direct connections. Roll back the origin requirement before disabling AOP if reverting.

Conceptual Traefik TLS addition, **not ready to apply until step 4 is implemented**:

```yaml
tls:
  options:
    default:
      minVersion: VersionTLS12
      clientAuth:
        caFiles:
          - /certs/cloudflare-origin-pull-ca.pem
          - /certs/local-probe-client-ca.pem
        clientAuthType: RequireAndVerifyClientCert
```

Retain the existing `tls.certificates` block. Make the change in version-controlled deployment configuration and test it before release. [AOP overview](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/), [global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/), [zone-level AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/zone-level/)

## 4. Cache rules that fit this application

Keep **Standard** caching and **Browser Cache TTL: Respect existing headers**. Leave Development Mode off except during short troubleshooting sessions. Do not use a site-wide Cache Everything rule or ignore origin `no-store` headers. A forced edge TTL can change cookie handling and cache responses that must remain private. [Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/), [Set-Cookie interaction](https://developers.cloudflare.com/cache/concepts/cache-behavior/)

Recommended first setup in **Caching → Cache Rules**:

**Rule 1 — Static build assets** (optional, because a sampled asset already HIT):

```text
(http.host eq "bomish.ir" and starts_with(http.request.uri.path, "/_next/static/"))
```

Set **Eligible for cache**; use cache-control headers, bypass if absent; respect browser TTL. Preserve query strings. Do not force-cache error responses. Next.js supplies immutable hashed assets; it already returned `public, max-age=31536000, immutable` in the audit.

**Rule 2 — Bypass everything outside the reviewed static directories**, placed after Rule 1:

```text
(http.host eq "bomish.ir" and not (
  starts_with(http.request.uri.path, "/_next/static/") or
  starts_with(http.request.uri.path, "/images/") or
  starts_with(http.request.uri.path, "/fonts/")
))
```

Set **Bypass cache**. This deliberately leaves HTML, all `/api/`, all `/uploads/`, `/_next/image`, staff/owner/account routes, robots and sitemap uncached. Public `/images/` and `/fonts/` continue to follow standard caching and origin headers; do not assign one-year browser TTLs to mutable filenames such as the logo.

This simple allowlist is easier to audit than enumerating every private route. It is conservative and can be expanded later. Review existing cache rules first: **the last matching setting wins**, so a later broad eligibility rule can undo this protection. Existing Workers or other response manipulation also need review in the dashboard. [Create Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/), [rule order](https://developers.cloudflare.com/cache/how-to/cache-rules/order/)

Application details that matter:

- Session cookies are `bomish_session` and `bomish_staff_session`. Any future HTML/API caching must account for authentication and CSRF. The proposed rules bypass these resources regardless of cookie presence.
- Backend middleware currently applies `Cache-Control: no-store` even to public `/uploads/`. Leave it respected for now. A good later performance change is a separate public-upload handler with immutable, validated image names and explicit cache headers on successful responses only.
- Private chat pictures are delivered through authenticated `/api/v1/.../messages/.../image` endpoints. They must remain private/no-store.
- Next.js navigation can request React Server Component payloads at ordinary page URLs. Avoid caching HTML/RSC at the edge until cache-key separation and invalidation are deliberately implemented.
- After changing indexing or updating fixed-name assets, purge the relevant URLs. Purging Cloudflare does not erase browser caches.

## 5. WAF, login protection and bots

Keep Cloudflare's DDoS protection and available managed WAF protections active. On Free, review the provided free managed ruleset; paid managed-rule options depend on plan. Investigate matched rule IDs before adding narrow exceptions; do not disable WAF globally for a single failed upload or login.

Use the available rate-limit rule first on actual authentication paths:

```text
http.request.uri.path in {
  "/api/v1/staff/login"
  "/api/v1/omnisire/unlock"
  "/api/v1/auth/request"
  "/api/v1/auth/verify"
}
```

Suggested **initial burst limit: 10 requests per 10 seconds per IP**, with **Block** and a 10-second mitigation if offered by the account. These are tuning starting points, not tested capacity limits. Free has a limited field set, so the expression deliberately avoids method and hostname filters. If the account offers different periods, choose a supported conservative burst equivalent and record it. Cloudflare currently documents one rate-limit rule on Free, two on Pro and five on Business; availability and periods vary. [Rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)

Keep the application's existing sustained limits: staff login 15/IP and 10/username per 15 minutes; owner unlock 20/IP and 10/staff account per 15 minutes. An edge rule does not replace these checks or perfectly enforce quotas. Avoid a low blanket limit on `/api/`: the UI legitimately polls, and customers may share carrier NAT addresses.

Do not issue JavaScript/Managed Challenges indiscriminately to API fetches, deployment health probes or future payment/carrier callbacks. An HTML challenge response is not valid JSON. Initially leave **Bot Fight Mode off**: its domain-wide behavior can interfere with automation, and it cannot be skipped using ordinary WAF custom rules. Keep **Under Attack Mode off** during normal operation; use it as an incident tool with explicit testing. [Bot Fight Mode limitations](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)

Avoid an Iran-only country allowlist: mobile routing, VPNs, staff travel, search engines and deployment runners may originate elsewhere. Prefer authenticated staff controls and behavioral limits. Optional low-risk custom blocks can target nonexistent WordPress endpoints and exposed-file probes, but keep `/.well-known/` available and avoid broad file-extension bans.

Cloudflare Turnstile is a later app integration, not just a dashboard switch. If needed for login/SMS abuse, implement server-side token verification and retry/accessibility behavior before enabling enforcement.

### Optional Cloudflare Access for staff

Access can add identity-provider MFA in front of `/staff`, `/omnisire`, `/api/v1/staff` and `/api/v1/omnisire`. Cover each exact base path **and its descendants**; wildcard child paths do not cover the base path. Test sign-in, refresh, upload, export and logout. Keep application authentication/authorization in place. [Access paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)

This is a second phase, because `/api/v1/session?workspace=staff` and `/api/v1/logout?workspace=staff` share paths with customer operations, and Access application paths cannot distinguish query strings. Do not gate the entire API and accidentally block the public store. A separate staff API namespace or carefully designed staff hostname is cleaner if full Access coverage is required; a new hostname also needs explicit app origin/cookie/CSRF and Traefik work.

## 6. Performance and connectivity settings

| Setting/product | Recommended starting point |
| --- | --- |
| HTTP/2 | On |
| HTTP/3 | On; already advertised in live responses |
| Compression | Keep Cloudflare compression enabled/default; test actual negotiated encoding |
| IPv6 to visitors | Keep enabled; origin IPv6 is a separate decision |
| Pseudo IPv4 | Off, or Add Header if needed; avoid overwriting original addresses |
| Rocket Loader | Off initially for this Next.js application |
| Email obfuscation / HTML rewriting | Leave off initially unless needed and tested |
| Hotlink protection | Off until image sharing and legitimate referrers are tested |
| Query-string ignoring | Off; search, pagination and image optimization use queries |
| Always Online | Leave off initially; it does not recover a dynamic application/database |
| Argo / paid routing optimization | Consider only after measuring regional latency and failure rates |
| Workers / APO / image transformations | No requirement for current deployment; introduce only with a specific measured need |
| Cloudflare Tunnel | Optional later architecture change, not required for current working setup |

HTTP/3 improves the visitor-to-Cloudflare leg and does not require opening UDP 443 on this origin. It is not currently an HTTP/3 connection from Cloudflare to Traefik. [HTTP/3](https://developers.cloudflare.com/speed/optimization/protocol/http3/)

Rocket Loader changes script execution; keep Next.js's existing script delivery until a browser regression test demonstrates a benefit. [Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/)

Public probes worked from the VPS via Cloudflare's GYD edge and from the external inspection environment via FRA. These are point observations, not evidence of performance across Iran. Measure on at least two Iranian mobile networks, a fixed-line connection, and an external network. Record DNS resolution, connection/TLS time, time to first byte, status and `CF-Ray`; compare across times of day. Do not assume a TCP congestion-control switch or paid CDN feature will solve an unmeasured route problem.

Registry/storage connectivity observations:

- `https://ghcr.io/v2/` returned 401 on GET, the expected unauthenticated registry response. HTTPS connectivity works; package authorization and blob downloads were not tested.
- `https://registry-1.docker.io/v2/` returned `403 RBAC: access denied` on GET. This is an observed access problem; the inspection does not identify its cause.
- Docker is configured with the mirror `docker.iranserver.com`. Confirm that it is an approved, trusted source and that the exact reviewed PostgreSQL/Traefik digests can be pulled through the configured path before restarting or upgrading. The audit did not pull images or establish mirror freshness. Do not work around failures by disabling TLS verification or using arbitrary mirrors.
- The S3 endpoint completed TLS and returned an application response; authenticated restic snapshot listing succeeded. Test recovery, not just endpoint availability.

Keep building application images in CI as the existing workflow does. Preserve known-good local images and rollback manifests during maintenance; a healthy running container does not prove a future registry pull will succeed.

Cloudflare Tunnel can remove public web listeners, but it adds a connector and depends on reliable outbound reachability. It would require revised routing, forwarded-IP trust and deployment probes. Do not combine it casually with the current AOP plan; Cloudflare documents AOP as inapplicable to tunnel-connected origins. [AOP and Tunnel](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)

## 7. Server hardening and operations

### Firewall: verify before changing

The external IPv4 check was encouraging: Cloudflare works while direct origin web access times out. Root access is still needed to establish **why**, persistence across reboot, exact allowed ranges, and equivalent IPv6 protection. `sudo -n ufw status verbose` required a password; no credentials were requested or bypassed.

Run these in your own privileged SSH session, keeping a provider console available:

```sh
sudo ufw status verbose
sudo iptables -S INPUT
sudo iptables -S DOCKER-USER
sudo ip6tables -S INPUT
sudo ip6tables -S DOCKER-USER
sudo nft list ruleset
sudo /usr/sbin/sshd -T
```

Docker reports the **iptables** firewall backend. UFW alone does not reliably restrict Docker-published ports, because published traffic can bypass its normal input path. Verify the provider firewall and the Docker forwarding path; use `DOCKER-USER` where applicable for this backend. An nftables backend requires a different integration, so do not copy iptables rules after changing backends. [Docker firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

Target policy:

| Traffic | Intended policy |
| --- | --- |
| Inbound TCP 80/443 | Current Cloudflare ranges only, on both IP families |
| Inbound TCP 2222 | Administrative VPN/static sources and the actual CI deployment path |
| Inbound TCP 22 | Remove after confirming all operators and workflows use 2222 |
| DB/API/metrics/Grafana | No public access; retain private networks/loopback binding |
| Established connections, loopback | Preserve |
| Required ICMP/ICMPv6 | Preserve for path MTU and IPv6 operation |
| Outbound | Preserve DNS, NTP, package/registry, Cloudflare and S3 access; review before imposing an egress allowlist |

Do not lock SSH to your home address without solving GitHub Actions access. The repository uses hosted runners, whose egress is not your admin IP. Options include a runner with controlled egress, a trusted deployment VPN or a dedicated runner with appropriately restricted permissions. A custom SSH port reduces noise but is not an access boundary.

Retrieve current ranges from [Cloudflare IPs](https://www.cloudflare.com/ips/), validate them, and update the firewall plus `CLOUDFLARE_CIDRS` and `TRUSTED_PROXY_CIDRS` together. On download failure, keep the last known-good rules. Add new ranges before removing obsolete ones; test public requests and preserve recovery access. Do not trust `0.0.0.0/0` or `::/0` as proxies. Traefik trusts incoming forwarded headers only from configured sources, and the Go app walks the trusted proxy chain. [Traefik forwarded headers](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)

### SSH and deployment access

Password/root login are already disabled in the readable config. Verify the effective `sshd -T` result, including applicable `Match` blocks, before editing. Proposed follow-up settings are `X11Forwarding no`, `MaxAuthTries 3` and a reviewed user allowlist. Keep TCP forwarding available to the admin account if using SSH tunnels for Grafana; the dedicated CI key can retain `restrict`.

Before removing port 22: confirm `DEPLOY_PORT=2222`, saved `[185.27.44.53]:2222` host keys, a successful CI deployment, and a second live administrative session on 2222. Validate with `sudo sshd -t`, reload, and test a new connection before closing existing sessions. Check the provider firewall too.

`daedalus` belongs to the Docker group, which effectively grants host administrative power. Protect its keys accordingly. Review authorized-key **options and owners** without sharing key material. Dedicated deployment credentials should not be reused as personal keys. Fail2ban can reduce SSH noise if SSH stays public, but it does not replace keys and ingress restrictions.

### Updates, resources and containers

- Unattended-upgrades is enabled and time synchronization is healthy. Verify actual update configuration/history, rather than assuming all third-party Docker packages are automatically patched.
- The existing package index listed Docker/containerd/Compose and other updates. Refresh metadata and review changes during maintenance; the audit did not run upgrades. Take a backup, keep console access, and plan for Docker/container restarts.
- Ubuntu 22.04 standard support ends in 2027; plan a tested upgrade/migration before then. Prefer a rehearsed replacement-host restore and cutover where feasible. [Ubuntu release lifecycle](https://ubuntu.com/about/release-cycle)
- Keep API/web running as their existing nonroot users, with read-only root filesystems, dropped capabilities and `no-new-privileges`. Preserve private database networking. Do not publish database/API ports for convenience.
- Pin PostgreSQL, Traefik and later monitoring images to reviewed digests. Do not change PostgreSQL major versions through a tag update; use a migration plan.
- Current service memory ceilings total roughly 3 GB before host overhead, exceeding physical RAM. Limits are ceilings rather than reservations, but simultaneous spikes can still cause host pressure. Monitor actual peaks, backup overlap, swap activity and OOM events. Avoid adding the entire Loki/Prometheus/Grafana stack to this 2 GB VPS without sizing tests; remote monitoring or a memory upgrade is more practical.
- Keep the existing swap as emergency headroom, not database capacity. Do not tune `swappiness`, BBR or kernel buffers without measuring workload and network behavior.
- Rotate logs and clean old images/releases under a retention policy. Keep the current/previous release sources for rollback; never use volume pruning as routine cleanup.

### Backups and monitoring

The live backup destination is off-VPS S3-compatible storage; snapshot listing succeeded. That proves repository access and stored snapshots, **not** successful recovery. Follow the isolated restore drill in [production.md](production.md#backups-and-restore-drills) before considering recovery validated. Record recovered data checks and elapsed restore time.

Protect a second recovery copy from the credentials used for routine retention/deletion. Preserve `restic_password`, `totp_key`, deployment config and TLS material in a separate encrypted credential backup: the database/uploads snapshot alone does not replace these. Do not blindly apply object-lock policies to a working restic repository without testing retention/prune behavior.

Add an external monitor for the homepage, `/api/v1/health`, canonical redirects and edge certificate expiry. Alert on HTTP/TLS failures, backup age over two hours, low disk space, memory pressure and repeated 5xx responses. Add business checks for catalog mode and later checkout health. An on-VPS monitor cannot report a complete host outage. Verify alert delivery to a real recipient.

If enabling Grafana later, retain its loopback-only binding and connect using:

```sh
ssh -p 2222 -L 3300:127.0.0.1:3300 daedalus@185.27.44.53
```

Keep request logging free of cookies, authorization tokens, addresses and login codes. Cloudflare security events and `CF-Ray` help diagnose edge failures; app `X-Request-ID` correlates origin behavior. Current Traefik logging intentionally drops most headers, so adding correlation fields should be explicit and privacy-reviewed.

## 8. Validation, launch sequence and rollback

Apply one group at a time, capture the previous setting, and retest. Suggested order:

1. Fix and verify the `www` redirect.
2. Confirm Full (strict), edge certificates, TLS settings and account security.
3. Review existing cache rules; add the conservative static/bypass rules.
4. Add targeted login burst protection; test staff and owner workflows.
5. Complete privileged firewall/IPv6 review and CI-compatible SSH restrictions.
6. Establish external alerting and a recorded restore drill.
7. Address email authentication and registrar-supported DNSSEC.
8. Implement/test AOP probe support before requiring mTLS.
9. Enable search indexing only when content is approved.

Run the project's existing checks from the active release on the VPS:

```sh
cd /srv/bomish/current
python3 scripts/verify-site.py \
  --config /srv/bomish/deployment.env \
  --images /srv/bomish/images.env --origin
python3 scripts/verify-site.py --public-url https://bomish.ir
```

Both passed during this audit. They cover redirects, homepage HTML, API health and catalog mode, but not every authenticated UI flow. After AOP changes, use the updated client-authenticated probe implementation.

From an external machine:

```sh
curl -sS -o /dev/null -D - 'https://www.bomish.ir/products?category=spices'
curl -sS -o /dev/null -D - 'http://bomish.ir/api/v1/health?deployment_probe=1'
curl -fsS https://bomish.ir/api/v1/health
curl -fsS https://bomish.ir/robots.txt
dig +short NS bomish.ir
dig +short DS bomish.ir
```

Expect a `www` redirect preserving path/query; apex HTTP redirect; healthy JSON; and normal Cloudflare headers. Fetch an actual `/_next/static/` asset twice to confirm caching. Private API/HTML should never become shared-cache HIT responses. Use a browser to verify staff login, owner unlock, logout, publishing, uploads and navigation. Verify cookies retain Secure/HttpOnly/SameSite behavior and that no API request receives an HTML challenge. Do not run destructive development Playwright workflows against production data.

For direct-origin testing, a request with the correct SNI/Host must still be refused from an untrusted external address. Testing only `https://IP/` and seeing a certificate mismatch or 404 is not proof of isolation. Repeat from an IPv6-capable source too. Using `curl --resolve` with `-k` can distinguish connectivity from Origin CA trust during this specific negative test; do not use `-k` for normal public health checks.

When launching search indexing, set `SITE_INDEXABLE=true` in deployment configuration and redeploy through the existing workflow. Verify robots, sitemap and page metadata; purge cached `/robots.txt` and `/sitemap.xml` because the audit observed a four-hour cache TTL on robots. Keep staff/account/API paths excluded. This does not enable checkout.

| Symptom after a change | First response |
| --- | --- |
| `www` still 404 | Check proxied DNS, redirect hostname expression, rule order and edge certificate |
| Redirect loop | Check SSL mode and redirect target; retain Full (strict) |
| 521/522 | Check origin listener, Cloudflare ingress allowlist and provider routing |
| 525/526 | Check TLS handshake, certificate validity/name/key and AOP trust configuration |
| API returns challenge HTML | Inspect Security Events; narrow/disable the responsible new rule |
| Stale or private content cached | Disable the offending cache rule and purge affected content immediately |
| Origin deployment probe fails after AOP | Restore previous origin client-auth requirement, then fix probe credentials |
| DNS SERVFAIL after DNSSEC change | Check DS/DNSKEY consistency and parent delegation; coordinate registrar rollback |

Do not turn off Cloudflare proxying as a generic rollback. Revert the specific rule/configuration and use the existing deployment recovery process. Keep database migration compatibility in mind; application rollback is not database rollback.

## 9. Improvements to make in the repository next

These are recommendations, not changes included in this audit:

1. Add validated AOP configuration plus authenticated local health probes and an integration check covering both allowed and rejected clients.
2. Split successful public-upload caching from private API middleware; retain authenticated chat-image protection and avoid caching errors.
3. Add a tested CSP in Report-Only mode before enforcement.
4. Pin infrastructure images and review their upgrade cadence alongside application images.
5. Add explicit acceptance checks for canonical `www`, private-cache exclusion, robots/sitemap launch state and real-IP trust behavior.
6. If adopting Access, separate shared staff session/logout paths to make path-based protection complete.
7. Keep a documented provider/host firewall policy covering Docker forwarding, IPv6 and deployment-runner access.

The live deployment is ahead of some statements in README/production documentation that still describe provisioning as pending. This audit establishes the dated observations above; it does not establish completion of all browser acceptance, privileged security or recovery checks.
