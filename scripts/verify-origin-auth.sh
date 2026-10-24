#!/usr/bin/env bash
# Isolated Traefik mTLS integration test. Uses a pre-existing image, no app/data volumes.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
container=""
cleanup() {
  if [ -n "$container" ]; then docker rm -f "$container" >/dev/null; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir -m 700 "$work/secrets" "$work/secrets/tls"
tls="$work/secrets/tls"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
  -subj /CN=bomish.test -addext subjectAltName=DNS:bomish.test \
  -addext basicConstraints=critical,CA:TRUE \
  -keyout "$tls/origin.key" -out "$tls/origin.crt" 2>/dev/null
python3 "$root/scripts/init-origin-auth.py" "$work/secrets" --cloudflare-ca "$tls/origin.crt"
# A second accepted identity signed by the fixture Cloudflare CA.
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj /CN=Test-Cloudflare-client -keyout "$work/edge.key" -out "$work/edge.csr" 2>/dev/null
printf 'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=clientAuth\nkeyUsage=digitalSignature\n' > "$work/client.ext"
openssl x509 -req -in "$work/edge.csr" -CA "$tls/origin.crt" -CAkey "$tls/origin.key" \
  -CAcreateserial -days 30 -extfile "$work/client.ext" -out "$work/edge.crt" 2>/dev/null
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
  -subj /CN=untrusted -keyout "$work/untrusted.key" -out "$work/untrusted.crt" 2>/dev/null
# Exercise the real production TLS template with a harmless internal ping route.
python3 - "$root/deploy/traefik/routes.yaml" "$work/routes.yaml" <<'PY'
import sys
from pathlib import Path
source = Path(sys.argv[1]).read_text()
source = source.replace('  routers:\n', '''  routers:
    test-ping:
      rule: 'Host(`bomish.test`) && Path(`/ping`)'
      entryPoints: [websecure]
      service: ping@internal
      tls: {}
''', 1)
Path(sys.argv[2]).write_text(source)
PY
for mode in off verify required; do
  container=$(docker run -d --pull never --memory 128m --pids-limit 64 --cpus 0.5 \
    --read-only --tmpfs /tmp --security-opt no-new-privileges:true \
    -e SITE_HOST=bomish.test -e "ORIGIN_AUTH_MODE=$mode" \
    -p 127.0.0.1::443 -v "$work/routes.yaml:/etc/traefik/routes.yaml:ro" \
    -v "$tls:/certs:ro" "${TRAEFIK_IMAGE:-traefik:v3.6}" \
    --entrypoints.websecure.address=:443 --providers.file.filename=/etc/traefik/routes.yaml \
    --ping=true --ping.manualrouting=true)
  port=$(docker port "$container" 443/tcp | cut -d: -f2)
  base=(--noproxy '*' --cacert "$tls/origin.crt" --connect-timeout 2 --max-time 5
        --resolve "bomish.test:$port:127.0.0.1")
  url="https://bomish.test:$port/ping"
  ready=false
  for attempt in $(seq 1 15); do
    if curl -fsS "${base[@]}" --cert "$work/secrets/origin-probe/client.crt" \
      --key "$work/secrets/origin-probe/client.key" "$url" > /dev/null 2> "$work/error"; then
      ready=true; break
    fi
    sleep 1
  done
  if [ "$ready" != true ]; then docker logs "$container"; cat "$work/error"; exit 1; fi
  curl -fsS "${base[@]}" --cert "$work/edge.crt" --key "$work/edge.key" "$url" >/dev/null
  if [ "$mode" = required ]; then
    if curl -sS "${base[@]}" "$url" >/dev/null 2> "$work/error"; then
      echo 'FAIL: unauthenticated client accepted'; exit 1
    fi
    grep -qi alert "$work/error"
  else
    curl -fsS "${base[@]}" "$url" >/dev/null
  fi
  if [ "$mode" != off ]; then
    if curl -sS "${base[@]}" --cert "$work/untrusted.crt" --key "$work/untrusted.key" \
      "$url" >/dev/null 2> "$work/error"; then
      echo 'FAIL: untrusted client accepted'; exit 1
    fi
    grep -qi alert "$work/error"
  fi
  docker rm -f "$container" >/dev/null
  container=""
  printf 'Origin authentication mode %s: expected TLS clients accepted/rejected.\n' "$mode"
done
