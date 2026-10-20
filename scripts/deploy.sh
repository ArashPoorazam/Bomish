#!/usr/bin/env bash
# Run on the VPS from a checkout of the same commit as the image artifact.
set -euo pipefail
: "${1:?Usage: scripts/deploy.sh /absolute/deployment.env /absolute/images.env}"
: "${2:?Pass the CI images.env artifact containing immutable image digests}"
config=$(realpath "$1")
release=$(realpath "$2")
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
state="$(dirname "$config")/release-state"
mkdir -p "$state"
chmod 700 "$state"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
# Accept exactly three digest assignments and no shell content.
python3 "$root/scripts/validate-release.py" "$release"
rollback_root=$root
if [ -f "$state/current.source" ]; then
  rollback_root=$(cat "$state/current.source")
  test -f "$rollback_root/compose.production.yaml"
fi
compose() { docker compose --env-file "$config" --env-file "$release" -f compose.production.yaml "$@"; }
compose config --quiet
compose pull api web migrate backup
# Infrastructure upgrades are deliberate, separate maintenance operations.
compose up -d --wait db
if [ -f "$state/current.env" ]; then
  # Use the running release's backup tool before attempting schema changes.
  docker compose --env-file "$config" --env-file "$state/current.env" -f compose.production.yaml run --rm --no-deps backup once
fi
compose run --rm migrate
healthy_release() {
  compose up -d --wait --wait-timeout 180 api web traefik backup || return 1
  compose exec -T web node -e 'fetch("http://api:8080/api/v1/settings").then(async r=>{if(!r.ok || !(await r.json()).catalogOnly)process.exit(1)}).catch(()=>process.exit(1))'
}
if ! healthy_release; then
  echo 'Release failed health checks.' >&2
  if [ -f "$state/current.env" ]; then
    echo 'Restoring previous application images; the database is NOT rolled back.' >&2
    docker compose --env-file "$config" --env-file "$state/current.env" -f "$rollback_root/compose.production.yaml" up -d --wait --wait-timeout 180 api web traefik backup
  fi
  exit 1
fi
if [ -f "$state/current.env" ]; then cp "$state/current.env" "$state/previous.env"; fi
if [ -f "$state/current.source" ]; then cp "$state/current.source" "$state/previous.source"; fi
cp "$release" "$state/current.env"
printf '%s\n' "$root" > "$state/current.source"
printf 'Release healthy. Record the commit, verify HTTPS externally, and check the backup alert receiver.\n'
