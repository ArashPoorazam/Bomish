#!/usr/bin/env bash
# Run on the VPS from a checkout of the same commit as the image artifact.
set -euo pipefail
: "${1:?Usage: scripts/deploy.sh /absolute/deployment.env /absolute/images.env}"
: "${2:?Pass the CI images.env artifact containing immutable image digests}"
first_install=false
if [ "${3:-}" = --first-install ]; then
  first_install=true
elif [ "$#" -ne 2 ]; then
  echo 'Usage: scripts/deploy.sh CONFIG IMAGES [--first-install]' >&2
  exit 2
fi
config=$(realpath "$1")
release=$(realpath "$2")
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
host=$(dirname "$config")
state="$host/release-state"
mkdir -p "$state"
chmod 700 "$state"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
preflight_args=("$config" "$release")
if "$first_install"; then preflight_args+=(--first-install); fi
python3 "$root/scripts/preflight.py" "${preflight_args[@]}"
rollback_root=$root
if [ -f "$state/current.source" ]; then
  rollback_root=$(cat "$state/current.source")
  test -f "$rollback_root/compose.production.yaml"
fi
compose() { docker compose --env-file "$config" --env-file "$release" -f compose.production.yaml "$@"; }
if "$first_install"; then
  # Restic 0.17+ distinguishes an absent repository (10) from wrong credentials,
  # network failures and locks. Never interpret those failures as a new repository.
  if compose run --rm --no-deps --entrypoint restic backup cat config >/dev/null; then
    echo 'Backup repository already initialized.'
  else
    code=$?
    if [ "$code" -ne 10 ]; then
      echo "Backup repository check failed (exit $code); initialization was not attempted." >&2
      exit "$code"
    fi
    compose run --rm --no-deps backup init
  fi
fi
# Infrastructure upgrades are deliberate, separate maintenance operations.
compose up -d --wait db
if [ -f "$state/current.env" ]; then
  # Use the running release's backup tool before attempting schema changes.
  docker compose --env-file "$config" --env-file "$state/current.env" -f "$rollback_root/compose.production.yaml" run --rm --no-deps backup once
fi
compose run --rm migrate
if "$first_install"; then
  owners=$(compose exec -T db psql -U postgres -d bomish -At -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM staff WHERE role='owner'")
  if [ "$owners" = 0 ]; then
    if [ ! -t 0 ] || [ ! -t 1 ]; then
      echo 'Owner creation requires an interactive SSH terminal. Rerun first-install.sh there.' >&2
      exit 1
    fi
    compose run --rm owner-tools bootstrap-owner
  elif [[ "$owners" =~ ^[1-9][0-9]*$ ]]; then
    echo 'Owner already exists; preserving existing credentials.'
  else
    echo 'Could not determine owner setup state.' >&2
    exit 1
  fi
  active_owner=$(compose exec -T db psql -U postgres -d bomish -At -v ON_ERROR_STOP=1 \
    -c "SELECT EXISTS(SELECT 1 FROM staff WHERE role='owner' AND active AND archived_at IS NULL)")
  if [ "$active_owner" != t ]; then
    echo 'No active owner. Use the documented owner recovery procedure before continuing.' >&2
    exit 1
  fi
  # Establish a real, recoverable backup before accepting the first release.
  compose run --rm --no-deps backup once
fi
healthy_release() {
  compose up -d --wait --wait-timeout 180 api web traefik backup || return 1
  python3 "$root/scripts/verify-site.py" --config "$config" --images "$release" --origin
}
if ! healthy_release; then
  echo 'Release failed health checks.' >&2
  if [ -f "$state/current.env" ]; then
    echo 'Restoring previous application images; the database is NOT rolled back.' >&2
    docker compose --env-file "$config" --env-file "$state/current.env" -f "$rollback_root/compose.production.yaml" up -d --wait --wait-timeout 180 api web traefik backup
  fi
  exit 1
fi
# A retry of the same release (e.g. after fixing Cloudflare) must not erase the
# previous distinct release used for rollback.
if ! cmp -s "$release" "$state/current.env" || [ "$rollback_root" != "$root" ]; then
  if [ -f "$state/current.env" ]; then cp "$state/current.env" "$state/previous.env"; fi
  if [ -f "$state/current.source" ]; then cp "$state/current.source" "$state/previous.source"; fi
fi
cp "$release" "$state/current.env"
printf '%s\n' "$root" > "$state/current.source"
# These describe what is actually running, even when public DNS/proxy checks fail.
ln -s "$root" "$host/.current-$$"
mv -Tf "$host/.current-$$" "$host/current"
if [ "$release" != "$host/images.env" ]; then
  cp "$release" "$host/.images-$$.env"
  mv -f "$host/.images-$$.env" "$host/images.env"
fi
if ! python3 "$root/scripts/verify-site.py" --config "$config" --images "$release"; then
  echo 'Origin is healthy, but public website verification failed. The running release is recorded and left in place; fix DNS/Cloudflare and retry.' >&2
  exit 1
fi
printf 'Deployment passed: containers, origin TLS/routing, HTTP redirects and public Cloudflare website. Check the backup alert receiver separately.\n'
