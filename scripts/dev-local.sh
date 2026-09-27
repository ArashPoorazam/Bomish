#!/usr/bin/env bash
# Native development, with durable demo data under the ignored .data directory.
set -euo pipefail
bomish_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$bomish_root/.env" ]; then
  set -a
  source "$bomish_root/.env"
  set +a
fi
bomish_data="$bomish_root/.data"
mkdir -p "$bomish_data"
for dependency in go node npm initdb pg_ctl psql createdb setsid; do
  command -v "$dependency" >/dev/null || { printf 'Missing dependency: %s\n' "$dependency" >&2; exit 1; }
done
if [ ! -f "$bomish_data/postgres/PG_VERSION" ]; then
  initdb -D "$bomish_data/postgres" -A trust --no-locale -E UTF8
fi
if ! pg_ctl -D "$bomish_data/postgres" status >/dev/null 2>&1; then
  pg_ctl -D "$bomish_data/postgres" -l "$bomish_data/postgres.log" -o '-p 55432 -k /tmp -h 127.0.0.1' start
fi
if ! psql -h 127.0.0.1 -p 55432 -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='bomish'" | grep -qx 1; then
  createdb -h 127.0.0.1 -p 55432 bomish
fi
if curl -fsS --max-time 2 http://localhost:3000/api/v1/health >/dev/null 2>&1; then
  printf 'Bomish is already running at http://localhost:3000\n'
  exit 0
fi
export APP_ENV=development APP_ORIGIN=http://localhost:3000 SEED_DEMO=true
export DATABASE_URL="postgres://$(id -un)@127.0.0.1:55432/bomish?sslmode=disable"
export GOCACHE="$bomish_data/go-cache" UPLOAD_DIR="$bomish_data/uploads"
(cd "$bomish_root/backend" && go build -o "$bomish_data/bomish-api" ./cmd/server)
if [ ! -d "$bomish_root/frontend/node_modules" ]; then
  (cd "$bomish_root/frontend" && npm ci)
fi
"$bomish_data/bomish-api" >"$bomish_data/api.log" 2>&1 &
bomish_api_pid=$!
(cd "$bomish_root/frontend" && exec setsid npm run dev) &
bomish_web_pid=$!
trap 'kill "$bomish_api_pid" 2>/dev/null || true; kill -- -"$bomish_web_pid" 2>/dev/null || true' EXIT INT TERM
printf 'Bomish: http://localhost:3000\nDashboard: http://localhost:3000/staff\nAPI log: %s/api.log\n' "$bomish_data"
wait -n "$bomish_api_pid" "$bomish_web_pid"
