#!/bin/sh
set -eu
umask 077
export PGPASSWORD="$(cat /run/secrets/postgres_password)"
export RESTIC_CACHE_DIR=/backup/cache
mkdir -p /backup /metrics
case "${1:-once}" in
  init) exec restic init ;;
  health)
    test -f /metrics/last-success
    last=$(cat /metrics/last-success)
    test "$(( $(date +%s) - last ))" -lt 7200
    exit ;;
  snapshots) exec restic snapshots ;;
  check) exec restic check --read-data ;;
  restore) shift; exec restic restore "$@" ;;
  loop)
    while :; do
      if "$0" once; then
        printf '{"event":"backup_success"}\n'
      else
        printf '{"event":"backup_failure"}\n' >&2
      fi
      sleep 3600 & wait $!
    done ;;
  once) ;;
  *) printf 'Usage: backup init|once|loop|health|snapshots|check|restore\n' >&2; exit 2 ;;
esac
# Scheduled and pre-deployment backups share the work volume. Serialize them.
exec 9>/backup/run.lock
flock -w 600 9
# Dump first, then snapshot uploads: immutable upload names ensure every file
# referenced by the dump is included. Do not add physical upload deletion without
# coordinating it with this backup process.
pg_dump --format=custom --no-owner --no-acl --file=/backup/database.dump.tmp
pg_restore --list /backup/database.dump.tmp >/dev/null
mv /backup/database.dump.tmp /backup/database.dump
restic backup --host "${BACKUP_HOST:-bomish-production}" --tag bomish /backup/database.dump /uploads
# Daily retention maintenance. Never prune when a backup has failed.
day=$(date -u +%F)
if [ ! -f /backup/maintenance-day ] || [ "$(cat /backup/maintenance-day)" != "$day" ]; then
  restic forget --host "${BACKUP_HOST:-bomish-production}" --tag bomish --keep-hourly 48 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
  restic check
  printf '%s\n' "$day" > /backup/maintenance-day
fi
now=$(date +%s)
printf '%s\n' "$now" > /metrics/last-success
printf 'bomish_backup_last_success_timestamp_seconds %s\n' "$now" > /metrics/backup.prom.tmp
chmod 644 /metrics/backup.prom.tmp
mv /metrics/backup.prom.tmp /metrics/backup.prom
