#!/usr/bin/env bash
# Runs on the VPS via SSH stdin. The optional root is useful for isolated tests.
set -euo pipefail
: "${1:?Expected prepare or auto}"
: "${2:?Expected the verified source commit}"
: "${3:?Expected the workflow run ID and attempt}"
mode=$1
commit=$2
delivery=$3
root=$(realpath "${4:-/srv/bomish}")
[[ "$mode" = prepare || "$mode" = auto ]]
[[ "$commit" =~ ^[a-f0-9]{40}$ ]]
[[ "$delivery" =~ ^[0-9]+-[0-9]+$ ]]
umask 077
mkdir -p "$root/releases" "$root/release-state"
exec 8>"$root/release-state/automatic.lock"
flock -n 8 || { echo 'Another automatic delivery is running.' >&2; exit 1; }
if [ "$mode" = auto ] && [ ! -f "$root/auto-deploy-ready" ]; then
  echo 'Complete first installation, then create /srv/bomish/auto-deploy-ready.' >&2
  exit 1
fi
incoming="$root/incoming/$delivery"
release="$root/releases/$commit-$delivery"
if [ -e "$release" ]; then
  echo 'Delivery directory already exists; rerun the Actions job for a new attempt.' >&2
  exit 1
fi
staging=$(mktemp -d "$root/releases/.incoming.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
# Preserve tracked read/execute modes for files bind-mounted into nonroot containers.
tar --no-same-owner --same-permissions -xzf "$incoming/source.tar.gz" -C "$staging"
cp "$incoming/images.env" "$staging/images.env"
python3 "$staging/scripts/validate-release.py" "$staging/images.env"
printf '%s\n' "$commit" > "$staging/release.commit"
mv "$staging" "$release"

if [ "$mode" = prepare ]; then
  # This also verifies real GHCR manifest, authentication and blob access.
  while IFS='=' read -r key image || [ -n "$key" ]; do
    docker pull "$image"
  done < "$release/images.env"
  ln -s "$release" "$root/.prepared-$delivery"
  mv -Tf "$root/.prepared-$delivery" "$root/prepared"
  printf 'Release prepared at %s. No application services were started.\n' "$release"
else
  bash "$release/scripts/deploy.sh" "$root/deployment.env" "$release/images.env"
  printf 'Deployed source commit %s.\n' "$commit"
fi
rm -rf -- "$incoming"
