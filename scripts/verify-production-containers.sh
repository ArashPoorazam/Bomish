#!/usr/bin/env bash
# Disposable CI smoke test. Requires Docker Compose v2, Python, OpenSSL and curl.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
work=$(mktemp -d)
export COMPOSE_PROJECT_NAME="bomish-smoke-$$"
export API_IMAGE=bomish-ci-api:local WEB_IMAGE=bomish-ci-web:local BACKUP_IMAGE=bomish-ci-backup:local
export SITE_INDEXABLE=true
export SITE_HOST=bomish.test SECRETS_DIR="$work/secrets" RESTIC_REPOSITORY=/repository
export EDGE_SUBNET=172.30.19.0/24 TRUSTED_PROXY_CIDRS=172.30.19.0/24 CLOUDFLARE_CIDRS=192.0.2.0/24
python3 scripts/init-deployment.py "$SECRETS_DIR"
cp deploy/monitoring/alertmanager.example.yaml "$SECRETS_DIR/alertmanager.yaml"
chmod 644 "$SECRETS_DIR/alertmanager.yaml"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=bomish.test \
  -keyout "$SECRETS_DIR/tls/origin.key" -out "$SECRETS_DIR/tls/origin.crt" 2>/dev/null
cat > "$work/override.yaml" <<'YAML'
services:
  backup:
    volumes:
      - repository:/repository
      - restore:/restore
volumes:
  repository: {}
  restore: {}
YAML
compose() { docker compose -f compose.production.yaml -f compose.observability.yaml -f "$work/override.yaml" "$@"; }
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then compose logs --tail 80 api web traefik backup db || true; fi
  compose down -v --remove-orphans >/dev/null || true
  # The directory was created by this script and contains test credentials only.
  rm -rf -- "$work"
  exit "$code"
}
trap cleanup EXIT
if [ "${SKIP_BUILD:-false}" != true ]; then
  docker build -t "$API_IMAGE" backend
  docker build -t "$WEB_IMAGE" frontend
  docker build -t "$BACKUP_IMAGE" deploy/backup
fi
compose config --quiet
compose up -d --wait db
compose run --rm migrate
# Repeating migrations must preserve category edits and create no demo accounts.
compose exec -T db psql -U postgres -d bomish -v ON_ERROR_STOP=1 -c "UPDATE categories SET name='Merchant name' WHERE id='spices'"
compose run --rm migrate
checks=$(compose exec -T db psql -U postgres -d bomish -At -v ON_ERROR_STOP=1 -c "SELECT (SELECT count(*) FROM categories)=3 AND (SELECT count(*) FROM staff)=0 AND (SELECT count(*) FROM products)=0 AND (SELECT name FROM categories WHERE id='spices')='Merchant name' AND NOT has_schema_privilege('bomish_app','public','CREATE')")
test "$checks" = t
compose run --rm --no-deps backup init
compose up -d --wait --wait-timeout 240 api web traefik
fetch() { curl --noproxy '*' -ksS --resolve bomish.test:443:127.0.0.1 "$@"; }
fetch -f https://bomish.test/api/v1/health >/dev/null
fetch -f https://bomish.test/ > "$work/home.html"
python3 - "$work/home.html" <<'PY'
import sys
from html.parser import HTMLParser
class Robots(HTMLParser):
    found = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name") == "robots":
            assert a.get("content") == "index, follow", a
            self.found = True
p = Robots()
p.feed(open(sys.argv[1]).read())
assert p.found
PY
fetch -f https://bomish.test/robots.txt | grep -q 'Sitemap: https://bomish.test/sitemap.xml'
fetch -f https://bomish.test/api/v1/settings | python3 -c 'import json,sys; assert json.load(sys.stdin)["catalogOnly"] is True'
test "$(fetch -o /dev/null -w '%{http_code}' -X POST https://bomish.test/api/v1/checkout)" = 503
# Exercise backup and restore, including an upload and the role that will own restored tables.
compose exec -T api sh -c 'printf restore-check > /data/uploads/restore-check.txt'
compose run --rm --no-deps backup once
compose run --rm --no-deps backup check
compose run --rm --no-deps backup restore latest --host "$COMPOSE_PROJECT_NAME" --tag bomish --target /restore
compose exec -T db createdb -U postgres -O bomish_migrator bomish_restore
compose run --rm --no-deps --entrypoint sh backup -ec '
  export PGPASSWORD="$(cat /run/secrets/postgres_password)"
  pg_restore --exit-on-error --no-owner --no-acl --role=bomish_migrator -d bomish_restore /restore/backup/database.dump
  test "$(psql -d bomish_restore -Atc "SELECT count(*) FROM categories")" = 3
  test "$(cat /restore/uploads/restore-check.txt)" = restore-check
'
compose run --rm --no-deps --entrypoint /bin/promtool prometheus check config /etc/prometheus/prometheus.yml
compose run --rm --no-deps --entrypoint /bin/amtool alertmanager check-config /etc/alertmanager/alertmanager.yml
compose run --rm --no-deps loki -config.file=/etc/loki/config.yaml -verify-config=true
compose run --rm --no-deps alloy validate /etc/alloy/config.alloy
printf 'Production containers: TLS routing, role permissions, idempotent migrations, catalog gate, backup and restore passed.\n'
