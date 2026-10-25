#!/usr/bin/env bash
# Native development with an explicit production refresh or offline local reuse.
set -euo pipefail
usage() {
  printf 'Usage: ./scripts/dev-local.sh [--refresh-production|--offline]\n'
  printf '  --refresh-production  Fetch a fresh database and uploads; replace the selected local copy.\n'
  printf '  --offline             Reuse local data without SSH or dependency downloads.\n'
}
bomish_mode="${1:-}"
if [ "$#" -gt 1 ]; then usage >&2; exit 2; fi
case "$bomish_mode" in
  --help|-h) usage; exit 0 ;;
  --offline|--refresh-production|'') ;;
  *) usage >&2; exit 2 ;;
esac
if [ -z "$bomish_mode" ]; then
  if [ -t 0 ]; then
    printf 'Local development:\n  1) Fetch fresh production data\n  2) Start offline with saved local data (default)\n'
    read -r -p 'Choose [1/2]: ' bomish_choice
    case "$bomish_choice" in
      1) bomish_mode=--refresh-production ;;
      2|'') bomish_mode=--offline ;;
      *) printf 'Invalid choice.\n' >&2; exit 2 ;;
    esac
  else
    bomish_mode=--offline
  fi
fi
bomish_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$bomish_root/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$bomish_root/.env"
  set +a
fi
bomish_data="$bomish_root/.data"
umask 077
mkdir -p "$bomish_data"
for dependency in go node npm initdb pg_ctl psql createdb setsid python3 flock realpath; do
  command -v "$dependency" >/dev/null || { printf 'Missing dependency: %s\n' "$dependency" >&2; exit 1; }
done
exec 9>"$bomish_data/dev-local.lock"
flock -n 9 || { printf 'The local launcher is already running. Stop it before starting again.\n' >&2; exit 1; }
# Avoid replacing data while either an old native app or Compose owns these ports.
python3 - <<'PY'
import socket
import sys
import tarfile
if sys.version_info < (3, 10) or not hasattr(tarfile, "data_filter"):
    raise SystemExit("Python 3.10+ with tarfile extraction filters is required; update Python's security patches.")
for port in (3000, 8080):
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            raise SystemExit(f"Port {port} is already in use. Stop the local server before starting again.")
PY
# libpq environment overrides must never redirect the launcher's local commands.
for bomish_var in ${!PG@}; do unset "$bomish_var"; done
if [ ! -f "$bomish_data/postgres/PG_VERSION" ]; then
  initdb -D "$bomish_data/postgres" -A trust --no-locale -E UTF8
fi
if ! pg_ctl -D "$bomish_data/postgres" status >/dev/null 2>&1; then
  # PostgreSQL outlives the launcher and must not inherit its exclusive lock.
  pg_ctl -D "$bomish_data/postgres" -l "$bomish_data/postgres.log" -o '-p 55432 -k /tmp -h 127.0.0.1' start 9>&-
fi
bomish_pg_dir="$(psql -X -h 127.0.0.1 -p 55432 -d postgres -Atc 'SHOW data_directory')"
if [ "$(realpath "$bomish_pg_dir")" != "$(realpath "$bomish_data/postgres")" ]; then
  printf 'Port 55432 does not belong to this checkout.\n' >&2
  exit 1
fi
if ! psql -X -h 127.0.0.1 -p 55432 -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='bomish'" | grep -qx 1; then
  createdb -h 127.0.0.1 -p 55432 bomish
fi
export SHIPPING_CONFIG_FILE="${SHIPPING_CONFIG_FILE:-$bomish_root/config/shipping.json}"
export APP_ENV=development APP_ORIGIN=http://localhost:3000 LISTEN_ADDR=127.0.0.1:8080
export API_URL=http://127.0.0.1:8080 SITE_URL=http://localhost:3000 SITE_INDEXABLE=false
# Local copies never use production keys or contact live SMS/carrier providers.
unset DATABASE_URL_FILE TOTP_ENCRYPTION_KEY TOTP_ENCRYPTION_KEY_FILE
for bomish_var in KAVENEGAR_API_KEY SNAPP_API_KEY TAPIN_API_KEY NESHAN_API_KEY; do
  unset "$bomish_var" "${bomish_var}_FILE"
done
export SMS_ENABLED=false SHIPPING_SIMULATED=true
export GOCACHE="$bomish_data/go-cache" NEXT_TELEMETRY_DISABLED=1
bomish_go=go
if [ "$bomish_mode" = --offline ]; then
  # Invoke a previously downloaded toolchain directly. The Go auto-selector
  # requires checksum service verification even when GOSUMDB is disabled.
  export GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local
  bomish_go_env="$(go env GOMODCACHE GOHOSTOS GOHOSTARCH)"
  mapfile -t bomish_go_values <<< "$bomish_go_env"
  bomish_go_version="$(awk '$1 == "go" { print $2; exit }' "$bomish_root/backend/go.mod")"
  bomish_cached_go="${bomish_go_values[0]}/golang.org/toolchain@v0.0.1-go${bomish_go_version}.${bomish_go_values[1]}-${bomish_go_values[2]}/bin/go"
  if [ -x "$bomish_cached_go" ]; then
    bomish_go="$bomish_cached_go"
    export GOROOT="${bomish_cached_go%/bin/go}"
  fi
fi
if [ ! -d "$bomish_root/frontend/node_modules" ]; then
  if [ "$bomish_mode" = --offline ]; then
    printf 'Frontend dependencies are missing. Run (cd frontend && npm ci) once while online.\n' >&2
    exit 1
  fi
  (cd "$bomish_root/frontend" && npm ci)
fi
if ! (cd "$bomish_root/backend" && "$bomish_go" build -o "$bomish_data/bomish-api" ./cmd/server); then
  printf 'Build failed. Offline startup needs the Go toolchain and modules cached from an online build.\n' >&2
  exit 1
fi
bomish_selection="$(python3 "$bomish_root/scripts/dev-database.py" "$bomish_mode")"
mapfile -t bomish_selected <<< "$bomish_selection"
export DATABASE_URL="${bomish_selected[0]}" UPLOAD_DIR="${bomish_selected[1]}"
export SEED_DEMO=true
if [ -f "$bomish_data/production-current.json" ]; then
  export SEED_DEMO=false
  # Match production's catalog mode; do not process copied orders or shipments.
  export STORE_MODE=catalog
  # Preserve the copied production shipping configuration.
  export SHIPPING_CONFIG_FILE=''
fi
printf 'Starting %s with local database only.\n' "$bomish_mode"
"$bomish_data/bomish-api" >"$bomish_data/api.log" 2>&1 &
bomish_api_pid=$!
(cd "$bomish_root/frontend" && exec setsid npm run dev) &
bomish_web_pid=$!
trap 'kill "$bomish_api_pid" 2>/dev/null || true; kill -- -"$bomish_web_pid" 2>/dev/null || true' EXIT INT TERM
printf 'Bomish: http://localhost:3000\nDashboard: http://localhost:3000/staff\nAPI log: %s/api.log\n' "$bomish_data"
wait -n "$bomish_api_pid" "$bomish_web_pid"
