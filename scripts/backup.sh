#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
backup_dir="${1:-.data/backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_file="$backup_dir/bomish-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$backup_file"
chmod 600 "$backup_file"
pg_restore --list "$backup_file" >/dev/null
printf 'Database backup verified: %s\n' "$backup_file"
# Uploads must be backed up separately from their configured storage root.
