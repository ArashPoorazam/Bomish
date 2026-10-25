# Bomish connectivity investigation — 24 October 2026

Initial investigation window: approximately **16:38–16:46 Asia/Tehran (13:08–13:16 UTC)**, with an initial probe at 16:38. Tests used the user's Hamrah Aval hotspot and SSH access to the production VPS. That initial phase changed no production configuration, DNS, firewall, certificates, application code, or local network settings. Temporary loopback SSH SOCKS listeners were closed after testing. No support reports were submitted. The later, explicitly requested direct-origin test is recorded below.

## Temporary direct-origin HTTPS test — preparation

At the user's request, a DNS-only A record for `direct-test.bomish.ir` was created pointing to the existing VPS. The apex and `www` remain proxied. A separate private key was generated on the VPS and has not left it. A Let's Encrypt certificate for the test hostname was issued using DNS validation, expiring 22 January 2027. This manual CSR certificate is not configured for automatic renewal and is intended only for the temporary experiment.

Let's Encrypt's ACME endpoint timed out from the hotspot, the VPS, and a VPS-exit SSH tunnel, including classical TLS variants. The same issuance succeeded after the user enabled the local VPN. The user then confirmed disabling the VPN before the hotspot test.

At approximately 19:38 UTC, isolated Traefik checks passed and the temporary route was activated. It allows only GET/HEAD requests for specified public pages, assets, and catalog/health API endpoints, restricted to the observed hotspot source IP and loopback/local bridge addresses needed for server verification. It uses a named TLS option and the separate trusted certificate. The main hostname retains mandatory origin-pull client authentication. Verified checks include:

- Trusted-certificate HTTPS health and complete homepage requests through the candidate configuration.
- HTTP 404 for the test hostname's staff page and POST health request.
- HTTP 421 for test-hostname TLS SNI with a `Host: bomish.ir` header.
- Main-hostname health success with the existing origin-probe certificate, and TLS `certificate required` without it.
- Existing production origin and public Cloudflare verification scripts both passed after activation.

The initial isolated validation container could not read the certificate directory with all capabilities dropped while running as a different UID. It was corrected to run as the directory owner; no live certificate permissions were changed.

The firewall exception is **not yet activated at this preparation checkpoint**. A sudo script has been staged at `/srv/bomish/direct-test-20261024/open-firewall.sh`; it allows only the hotspot's observed IPv4 source to the origin's TCP 443 through `DOCKER-USER`, and schedules its own removal after 30 minutes before inserting the rule. It makes no persistent UFW changes. The user must run it because the SSH account requires a sudo password. A guarded, deployment-lock-aware route rollback script is staged alongside it as `restore-routes.sh`. Test files are under `/tmp/bomish-direct-https/` locally and `/srv/bomish/direct-test-20261024/` on the VPS.

The temporary ACME TXT record remains pending cleanup. A successful direct test on this separate hostname would establish that the origin HTTPS path works, but would not alone prove that the original `bomish.ir` hostname works when Cloudflare is bypassed: both hostname and delivery endpoint differ.

## Conclusion and confidence

**The reproduced failure is on the visitor-to-Cloudflare HTTPS transport path. It is not explained by an application outage, a missing DNS A record, or an expired certificate.** The most likely explanation is hostname/TLS-sensitive filtering or a middlebox interoperability fault on the mobile/upstream path. Cloudflare edge behavior remains a possible contributor. These measurements cannot identify the responsible operator or establish whether interference is deliberate.

This is more specific than a blanket “Cloudflare is blocked in Iran” diagnosis:

- The same Cloudflare IP serves `www.cloudflare.com` successfully from the hotspot while `bomish.ir` fails with the default TLS settings.
- Bomish succeeds with selected TLS parameters on that same IP and source network.
- The same local curl binary, hostname, destination IP, and default post-quantum TLS work through an SSH tunnel exiting the VPS.
- Some direct VPS tests also stall. Therefore this is not proven exclusive to Hamrah Aval, and Cloudflare/upstream investigation is warranted alongside the carrier report.

**No reliable site-wide configuration fix was established.** A successful diagnostic curl override is not a repair for visitors' browsers.

## Evidence

| Test | Observed result | Meaning |
| --- | --- | --- |
| Production containers | All five healthy; low system load | No general application/server outage observed |
| Existing origin and public verification scripts, run on VPS | Both passed: redirect, homepage, API, catalog mode | Origin can serve valid requests through Cloudflare |
| Hotspot A lookup via system resolver, phone gateway, and `1.1.1.1` | `188.114.96.3`, `188.114.97.3` | Ordinary name resolution works; pinning the addresses does not remove the failure |
| Hotspot default TLS, both assigned IPv4 addresses | Certificate verifies; no HTTP response; EOF after about 15.2 seconds in repeated probes | Failure before a usable HTTP response, not an observed WAF rejection |
| HTTP/1.1 versus HTTP/2 | Both fail under default TLS | Not solely an HTTP/2 problem |
| `/cdn-cgi/trace` over HTTPS | Same failure as API | Reproduces on Cloudflare's edge diagnostic endpoint without involving the application origin |
| TLS 1.3 + X25519, pinned `188.114.96.3` | API HTTP 200 in all three controlled repetitions, about 0.51–0.79 seconds | TLS characteristics strongly affect the result |
| TLS 1.3 + X25519MLKEM768 | All three controlled API repetitions fail; default behaves the same | Modern hybrid key exchange is associated with the reproduced failures; not proof the algorithm itself is faulty |
| TLS 1.2 | All three hotspot API repetitions time out | Disabling TLS 1.3 would not solve this measured failure |
| Compressed homepage + TLS 1.3/X25519 | Full HTTP 200 download, 17,063 compressed bytes in about 0.62 seconds | Application page can be delivered on the hotspot with this diagnostic override |
| Uncompressed homepage + X25519 | One hotspot and one VPS probe stalled after 57,516 bytes | Transport remains unreliable; a 200 header alone is insufficient validation |
| HTTP/3-only | Connection timeout at six seconds | No verified QUIC workaround; this short timeout is not proof of a permanent UDP block |
| `www.cloudflare.com` pinned to `188.114.96.3` | HTTP 200 under both default TLS and TLS 1.2 | Not a complete IP-prefix outage |
| Bomish pinned to control IP `104.16.124.96` | Same default-TLS failure | Merely selecting another tested Cloudflare address did not fix it |
| Local curl via temporary SSH SOCKS tunnel, pinned `188.114.96.3` | Trace HTTP 200 with default, explicit ML-KEM, X25519, and TLS 1.2, about 0.44–0.62 seconds | Changing the network path/source changes the result while keeping the TLS client and target fixed |
| Homepage via tunnel | Default uncompressed and classical compressed downloads completed in about 0.81 seconds; one default compressed probe timed out | Tunnel substantially improves access but was not universally successful in every probe |
| TCP counters on failing hotspot connection | Outgoing bytes remain unacknowledged; retransmissions grow after server handshake data arrives | Transport-level loss/drop is visible; no HTTP block page or error code was received |

The hotspot has no global IPv6 address/default IPv6 route. The reproduced failures explicitly used IPv4, so disabling Cloudflare's visitor IPv6 support is not an evidence-based fix for this reproduction. The phone's own IPv6 behavior may differ from its tethered connection.

Cloudflare identified successful trace requests as country `IR`, serving location `FRA`, WARP off. This argues against a blanket Cloudflare country ban. A 12-hop UDP trace traversed private carrier/upstream addresses and did not reach the destination within the limit; it does **not** identify a blocking hop. No packet capture was available to localize the drop conclusively.

### Dashboard observations

- Free plan.
- Proxied apex A: `185.27.44.53`.
- Proxied apex AAAA: `2a13:5ac0:400::2300`.
- Proxied `www` CNAME: `bomish.ir`.
- Universal edge certificate active for apex and wildcard. The tested certificate verified successfully and expires 11 January 2027.
- Minimum visitor TLS 1.2; TLS 1.3 on; Always Use HTTPS on.
- No custom security rules, no configured rate-limit rules, and no user-created managed rules shown. Cloudflare default protections still apply.
- Bot Fight Mode and Under Attack Mode off.

The origin AAAA address matches the VPS. Privileged firewall inspection required a sudo password and was not performed. Origin IPv6 deserves independent validation, but an origin IPv6 fault cannot explain failures of Cloudflare's own `/cdn-cgi/trace` endpoint.

### HTTPS DNS / ECH discrepancy

From the VPS, `dig bomish.ir HTTPS` returned a record with `alpn="h3,h2"`, IP hints, and an ECH configuration. From the hotspot, the system resolver and explicit UDP queries to the phone gateway, `1.1.1.1`, and `8.8.8.8` all returned NOERROR with no HTTPS record.

This is consistent with HTTPS-record suppression/interception or resolver-path differences, and can prevent clients learning ECH configuration. It is not proof of the exact suppressing device or policy. Cloudflare documents that removing HTTPS records prevents ECH discovery. The installed curl build does not support ECH despite listing the option, so an explicit ECH request could not be tested. No ECH configuration was changed.

## Escalation and repair path

1. **Open a Hamrah Aval network ticket first.** Call **9990** from the MCI line, use **Hamrah Man → پشتیبانی / از من بپرس**, or email **9990@mci.ir**. Request escalation to the data-network team for hostname/TLS-sensitive packet loss and HTTPS DNS-record suppression. Obtain a tracking number. Include subscriber/source-IP details privately, not in a public forum.
2. **Raise the same evidence with Cloudflare.** The zone is Free, which normally does not include technical support cases. Use [Cloudflare Community](https://community.cloudflare.com/) or the support options actually offered in the [account dashboard](https://dash.cloudflare.com/?to=/:account/support). Paid plans have technical-case access, but upgrading is not itself a network fix. Ask Cloudflare to inspect the FRA edge path, failed TLS connections, and the difference by client key exchange/source network.
3. **Repeat from another MCI SIM/device and a different carrier.** Keep the hostname, destination IP, client version, and test commands identical. Record UTC timestamps, source IP privately, and whether the complete page and static assets finish. This separates handset/tethering effects from carrier-wide behavior.
4. **If the providers cannot resolve the issue promptly, validate an alternative delivery path before switching production.** Test an alternate CDN/reverse proxy from affected MCI and another carrier, including homepage, assets, API, staff authentication, uploads, certificate trust, and origin restrictions. A separate public-trust certificate and deliberate origin-access design are required for a direct-origin option.

Do not simply pause Cloudflare or gray-cloud the DNS records. The current origin uses Cloudflare Origin CA and authenticated origin pulls, and may restrict source networks; direct browsers are not a prepared fallback. Do not disable TLS 1.3, remove AOP, or weaken certificate validation to address a failure reproduced before origin access. Do not hardcode a tested Cloudflare IP as a permanent DNS workaround.

## Reproduction commands

These issue unauthenticated public GET requests and leave configuration unchanged. Execute from the failing connection and then a known-working connection. The curve options require a supporting curl/OpenSSL build; an unsupported-option failure is not a network result.

```sh
date -u
dig bomish.ir A
dig bomish.ir HTTPS

# Default TLS, fixed target, edge-only diagnostic
curl --noproxy '*' -4 -sv --resolve bomish.ir:443:188.114.96.3 \
  --connect-timeout 5 --max-time 20 https://bomish.ir/cdn-cgi/trace

# Change only TLS key exchange; retain certificate verification
curl --noproxy '*' -4 -sv --tlsv1.3 --curves X25519 \
  --resolve bomish.ir:443:188.114.96.3 \
  --connect-timeout 5 --max-time 20 https://bomish.ir/cdn-cgi/trace

# Complete page download; a 200 header by itself is not enough
curl --noproxy '*' -4 -sS --compressed --tlsv1.3 --curves X25519 \
  --resolve bomish.ir:443:188.114.96.3 --max-time 20 -o /dev/null \
  -w 'HTTP=%{http_code} bytes=%{size_download} total=%{time_total}\n' \
  https://bomish.ir/
```

Repeat with `188.114.97.3`. Preserve exit status as well as HTTP status. Raw local investigation files are temporarily stored under `/tmp/bomish-network-investigation/`; they may include the subscriber's public IP and should only be shared privately after review. Sanitized measurements are saved beside this report in `connectivity-evidence-2026-10-24.json`.

## Draft for Hamrah Aval

**موضوع: اختلال HTTPS دامنه bomish.ir روی اینترنت همراه اول — درخواست بررسی تیم شبکه**

سلام. در تاریخ ۲۴ اکتبر ۲۰۲۶ حدود ساعت ۱۶:۳۸ تا ۱۶:۴۶ به وقت تهران، دسترسی به https://bomish.ir روی اینترنت همراه اول و هات‌اسپات همان سیم‌کارت دچار اختلال بود. با تغییر مسیر اتصال، دسترسی برقرار می‌شود.

پاسخ DNS نوع A برابر 188.114.96.3 و 188.114.97.3 است. اتصال TCP برقرار می‌شود و کلاینت گواهی معتبر سایت را دریافت و تأیید می‌کند، اما در حالت پیش‌فرض TLS پاسخی از HTTP دریافت نمی‌شود و اتصال تقریباً پس از ۱۵ ثانیه قطع می‌شود. این مشکل در مسیر /cdn-cgi/trace هم رخ می‌دهد؛ این مسیر متعلق به لبه Cloudflare است و به سرور برنامه ما وابسته نیست. شمارنده‌های TCP ارسال مجدد و تأیید نشدن بخشی از داده‌های خروجی را نشان می‌دهند.

با همان کلاینت، دامنه و IP، استفاده از TLS 1.3 و X25519 پاسخ موفق می‌دهد، اما X25519MLKEM768 و TLS 1.2 در آزمایش‌های تکراری مشکل دارند. دامنه www.cloudflare.com روی همان IP پاسخ موفق می‌دهد. همچنین رکورد DNS نوع HTTPS/ECH از مسیر سرور وجود دارد، ولی در پرس‌وجوهای مسیر همراه اول پاسخ خالی دریافت شد.

لطفاً موضوع را برای بررسی اختلال وابسته به SNI/TLS، تجهیزات میانی/DPI، حذف بسته‌ها و پاسخ‌های DNS نوع HTTPS به تیم شبکه ارجاع دهید. علت قطعی یا عمدی بودن فیلترینگ هنوز اثبات نشده است. لطفاً شماره پیگیری ارائه کنید. شماره سیم‌کارت، IP عمومی مبدأ و جزئیات تکمیلی از طریق کانال خصوصی ارائه می‌شود.

## Draft for Cloudflare

**Subject: bomish.ir — TLS-sensitive transport failures from MCI/Iran; edge trace affected**

During 2026-10-24 approximately 13:08–13:16 UTC, we reproduced failures on an MCI/Hamrah Aval mobile hotspot. Destinations were 188.114.96.3 and 188.114.97.3:443. The local client was curl 8.23.0/OpenSSL 3.6.5. Certificate verification succeeded, but default TLS 1.3/X25519MLKEM768 requests to both /api/v1/health and /cdn-cgi/trace received no HTTP response and ended with unexpected EOF after approximately 15.2 seconds. HTTP/1.1 and HTTP/2 were both affected. TCP counters showed retransmissions and unacknowledged outgoing data.

With the same hostname, destination IP, and hotspot source, forcing TLS 1.3/X25519 gave three successful API responses in 0.51–0.79 seconds. TLS 1.2 failed from the hotspot. www.cloudflare.com worked on the same destination IP with default TLS and TLS 1.2. Pinning bomish.ir to control IP 104.16.124.96 did not solve the default-TLS failure.

The same local client through an SSH SOCKS tunnel exiting our VPS returned successful edge trace responses under all four tested TLS variants, including ML-KEM and TLS 1.2. Successful traces used FRA. The origin health checks passed and there are no custom WAF/rate-limit rules; Under Attack Mode and Bot Fight Mode are off. However, some direct VPS requests and one tunneled compressed-page request also stalled, so we cannot conclusively attribute the entire problem to MCI alone.

Successful comparison Ray IDs:

- a4f9378348494d4a-FRA — direct hotspot, TLS 1.3/X25519, 13:09:35 UTC.
- a4f93a841a789177-FRA — tunneled default ML-KEM trace, 13:11:38 UTC.
- a4f93a855ca9d2cf-FRA — tunneled TLS 1.2 trace, 13:11:39 UTC.
- a4f93b9c0d79db0e-FRA — complete tunneled homepage, 13:12:23 UTC.

Failed connections returned no HTTP headers or Ray IDs. Please investigate the TLS/transport path and any edge-side drops or relevant network incidents. We can provide the affected subscriber source IP privately and rerun synchronized packet captures. Please distinguish ISP/upstream interference from an edge problem before recommending a zone setting change.

## References

- [MCI official support channels](https://mci.ir/contact).
- [Cloudflare support availability by plan](https://developers.cloudflare.com/support/contacting-cloudflare-support/).
- [Cloudflare network troubleshooting evidence](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/gathering-information-for-troubleshooting-sites/).
- [Cloudflare SSL protocol interference guidance](https://developers.cloudflare.com/ssl/troubleshooting/err-ssl-protocol-error/).
- [Cloudflare ECH and DNS suppression behavior](https://developers.cloudflare.com/ssl/edge-certificates/ech/).
- [Cloudflare ISP blocking limitations](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/potential-isp-blocking/).

Cloudflare's public status page reported no known service issues when checked. This does not exclude a network-specific fault.
