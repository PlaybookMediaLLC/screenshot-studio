#!/usr/bin/env bash
# Take an on-demand PlanetScale backup of the production branch and wait until
# it succeeds. The backend deploy runs this before platform-migrate, so every
# migration has a restore point. Credentials come from Infisical; the service
# token needs read_backups and write_backups on the database.
set -euo pipefail

: "${PLANETSCALE_SERVICE_TOKEN_ID:?Missing Infisical secret: PLANETSCALE_SERVICE_TOKEN_ID}"
: "${PLANETSCALE_SERVICE_TOKEN:?Missing Infisical secret: PLANETSCALE_SERVICE_TOKEN}"
: "${PLANETSCALE_ORGANIZATION:?Missing Infisical secret: PLANETSCALE_ORGANIZATION}"
: "${PLANETSCALE_DATABASE:?Missing Infisical secret: PLANETSCALE_DATABASE}"
branch="${PLANETSCALE_BRANCH:-main}"
label="${1:?Usage: backup-database.sh <label>}"

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
      echo "PlanetScale backup $id is ready (kept 14 days)."
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
