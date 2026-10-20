#!/usr/bin/env bash
# Run interactively on the VPS after configuring secrets, TLS, DNS and S3.
set -euo pipefail
: "${1:?Usage: scripts/first-install.sh /absolute/deployment.env /absolute/images.env}"
: "${2:?Pass the verified images.env artifact}"
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
exec bash "$root/scripts/deploy.sh" "$1" "$2" --first-install
