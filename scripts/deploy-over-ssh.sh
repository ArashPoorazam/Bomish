#!/usr/bin/env bash
# Runs on the GitHub-hosted runner; application secrets stay on the VPS.
set -euo pipefail
: "${1:?Usage: scripts/deploy-over-ssh.sh COMMIT IMAGES_ENV}"
: "${2:?Pass the downloaded images.env artifact}"
: "${DEPLOY_HOST:?Set the production DEPLOY_HOST secret to the VPS IP or SSH hostname}"
: "${DEPLOY_USER:?Set the production DEPLOY_USER secret}"
: "${DEPLOY_SSH_KEY:?Set the production DEPLOY_SSH_KEY secret}"
: "${DEPLOY_KNOWN_HOSTS:?Set the production DEPLOY_KNOWN_HOSTS secret}"
: "${GITHUB_RUN_ID:?Missing workflow run ID}"
: "${GITHUB_RUN_ATTEMPT:?Missing workflow run attempt}"
commit=$1
images=$(realpath "$2")
mode=${DEPLOY_MODE:-prepare}
port=${DEPLOY_PORT:-22}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$port" =~ ^[1-9][0-9]{0,4}$ ]]
((10#$port <= 65535))
[[ "$mode" = prepare || "$mode" = auto ]]
[[ "$(git rev-parse HEAD)" = "$commit" ]]
python3 scripts/validate-release.py "$images"

umask 077
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$work/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$work/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
ssh-keygen -y -P '' -f "$work/key" >/dev/null
host_key_name=$DEPLOY_HOST
if [ "$port" != 22 ]; then host_key_name="[$DEPLOY_HOST]:$port"; fi
ssh-keygen -F "$host_key_name" -f "$work/known_hosts" >/dev/null
transport=(
  -i "$work/key"
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$work/known_hosts" -o GlobalKnownHostsFile=/dev/null
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4
)
target="$DEPLOY_USER@$DEPLOY_HOST"
delivery="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
incoming="/srv/bomish/incoming/$delivery"
# Only committed source is sent: no .git credentials or local secrets.
git archive --format=tar.gz --output="$work/source.tar.gz" "$commit"
cp "$images" "$work/images.env"
ssh "${transport[@]}" -p "$port" "$target" \
  "umask 077; mkdir -p '$incoming'"
scp "${transport[@]}" -P "$port" "$work/source.tar.gz" "$work/images.env" \
  "$target:$incoming/"
# Arguments interpolated into the SSH command are restricted above.
ssh "${transport[@]}" -p "$port" "$target" \
  "bash -s -- '$mode' '$commit' '$delivery'" < scripts/deploy-received.sh
