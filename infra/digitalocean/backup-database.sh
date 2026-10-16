#!/usr/bin/env bash
# Record a restore point before the backend deploy migrates the database.
#
# PlanetScale Postgres backs up production every 12 hours and supports
# point-in-time recovery to any moment from the oldest backup (2 days by
# default) up to 5 minutes ago, so the timestamp printed here is always a
# usable restore point: Backups > Restore to new branch > that time.
#
# With a PlanetScale service token in Infisical (read_backups, write_backups),
# it also takes an on-demand backup, kept 14 days, and fails if that backup
# does not succeed.
set -euo pipefail

label="${1:?Usage: backup-database.sh <label>}"
restore_point="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "Database restore point before this deploy: $restore_point (PlanetScale point-in-time recovery)" | tee -a "$summary"

if [ -z "${PLANETSCALE_SERVICE_TOKEN_ID:-}" ] || [ -z "${PLANETSCALE_SERVICE_TOKEN:-}" ] ||
  [ -z "${PLANETSCALE_ORGANIZATION:-}" ] || [ -z "${PLANETSCALE_DATABASE:-}" ]; then
  echo "No PlanetScale service token in Infisical; relying on point-in-time recovery."
  exit 0
fi

branch="${PLANETSCALE_BRANCH:-main}"
api="https://api.planetscale.com/v1/organizations/$PLANETSCALE_ORGANIZATION/databases/$PLANETSCALE_DATABASE/branches/$branch/backups"
auth="Authorization: $PLANETSCALE_SERVICE_TOKEN_ID:$PLANETSCALE_SERVICE_TOKEN"

id="$(curl --fail-with-body --silent --show-error -X POST "$api" -H "$auth" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$label\",\"retention_unit\":\"day\",\"retention_value\":14}" | jq -er .id)"
echo "PlanetScale backup $id started for $PLANETSCALE_DATABASE/$branch"

# Backups of a small database finish in minutes; give up after 30.
for _ in $(seq 1 90); do
  state="$(curl --fail-with-body --silent --show-error "$api/$id" -H "$auth" | jq -er .state)"
  case "$state" in
    success)
      echo "PlanetScale backup $id is ready (kept 14 days)." | tee -a "$summary"
      exit 0
      ;;
    failed | canceled | ignored)
      echo "PlanetScale backup $id ended as $state; not migrating." >&2
      exit 1
      ;;
  esac
  sleep 20
done
echo "PlanetScale backup $id did not finish in 30 minutes; not migrating." >&2
exit 1
