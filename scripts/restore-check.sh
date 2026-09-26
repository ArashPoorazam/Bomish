#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a NEW EMPTY verification database}"
: "${1:?Pass a backup file}"
existing_tables="$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$existing_tables" != "0" ]; then
  printf 'Refusing to restore: destination is not empty.\n' >&2
  exit 1
fi
pg_restore --exit-on-error --no-owner --dbname="$RESTORE_DATABASE_URL" "$1"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS product_count FROM products' -c 'SELECT count(*) AS order_count FROM orders'
