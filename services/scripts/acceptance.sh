#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SERVICES="$ROOT/services"
DATABASE_URL=${PUBLISHING_ACCEPTANCE_DATABASE_URL:?PUBLISHING_ACCEPTANCE_DATABASE_URL is required}
BACKEND_PORT=${PUBLISHING_ACCEPTANCE_BACKEND_PORT:-18080}
ORCHESTRATOR_PORT=${PUBLISHING_ACCEPTANCE_ORCHESTRATOR_PORT:-18081}
BOUNDARY_PORT=${PUBLISHING_ACCEPTANCE_BOUNDARY_PORT:-15679}
TEMPORAL_PORT=${PUBLISHING_ACCEPTANCE_TEMPORAL_PORT:-17233}
TEMPORAL_ADDRESS="127.0.0.1:$TEMPORAL_PORT"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/publishing-acceptance.XXXXXX")

cleanup() {
  set +e
  for file in backend.pid orchestrator.pid boundary.pid temporal.pid; do
    if [[ -f "$WORK/$file" ]]; then
      pid=$(cat "$WORK/$file")
      pkill -TERM -P "$pid" 2>/dev/null
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
    fi
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

for command in curl go psql python3 temporal; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done

if temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; then
  echo "Temporal acceptance port $TEMPORAL_PORT is already in use" >&2
  exit 1
fi

database_name=$(psql "$DATABASE_URL" -Atqc 'SELECT current_database()')
if [[ ! "$database_name" =~ (acceptance|test) ]]; then
  echo "refusing to use database '$database_name'; its name must contain acceptance or test" >&2
  exit 1
fi
if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT to_regclass('public.scheduled_post') IS NOT NULL")" == t ]]; then
  echo "acceptance database must be empty" >&2
  exit 1
fi

while IFS= read -r migration; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done < <(find "$ROOT/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql | sort)

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES ('user_acceptance', 'Acceptance Publisher', 'publishing-acceptance@example.test', true, now(), now());
INSERT INTO organization (id, name, slug, "createdAt")
VALUES ('org_acceptance', 'Publishing Acceptance', 'publishing-acceptance', now());
INSERT INTO brand_kit (id, "organizationId", name, version, definition, status, "createdAt", "updatedAt")
VALUES ('brand_acceptance', 'org_acceptance', 'Acceptance Brand', 1, '{}'::jsonb, 'ACTIVE', now(), now());
INSERT INTO creative_template (id, "organizationId", name, version, definition, status, "createdAt", "updatedAt")
VALUES ('template_acceptance', 'org_acceptance', 'Acceptance Template', 1, '{}'::jsonb, 'ACTIVE', now(), now());
INSERT INTO release (id, "organizationId", title, "benefitStatement", status, "createdByUserId", "createdAt", "updatedAt")
VALUES ('release_acceptance', 'org_acceptance', 'Acceptance Release', 'Verify publishing services.', 'DRAFT', 'user_acceptance', now(), now());
INSERT INTO asset (id, "organizationId", "objectKey", "mediaType", bytes, status, "createdAt", "updatedAt")
VALUES ('asset_acceptance', 'org_acceptance', 'org/org_acceptance/asset.png', 'image/png', 68, 'UPLOADED', now(), now());
INSERT INTO creative_variant (
  id, "organizationId", "releaseId", "sourceAssetId", "brandKitId", "brandKitVersion",
  "templateId", "templateVersion", revision, "aspectRatio", status, "createdByUserId", "createdAt", "updatedAt"
) VALUES (
  'variant_acceptance', 'org_acceptance', 'release_acceptance', 'asset_acceptance', 'brand_acceptance', 1,
  'template_acceptance', 1, 1, '1:1', 'APPROVED', 'user_acceptance', now(), now()
);
INSERT INTO approval (id, "organizationId", "variantId", status, "decidedByUserId", "decidedAt", "createdAt", "updatedAt")
VALUES ('approval_acceptance', 'org_acceptance', 'variant_acceptance', 'APPROVED', 'user_acceptance', now(), now(), now());
INSERT INTO channel_connection (
  id, "organizationId", provider, "externalAccountId", "secretReference", status,
  "createdByUserId", "createdAt", "updatedAt", platform, "providerSettings"
) VALUES (
  'connection_recovery_acceptance', 'org_acceptance', 'postiz', 'postiz-recovery', 'POSTIZ_API_KEY', 'ACTIVE',
  'user_acceptance', now(), now(), 'x', '{}'::jsonb
);
INSERT INTO scheduled_post (
  id, "organizationId", "variantId", "channelConnectionId", "scheduledFor", status,
  caption, "idempotencyKey", "createdAt", "updatedAt"
) VALUES (
  'post_recovery_acceptance', 'org_acceptance', 'variant_acceptance', 'connection_recovery_acceptance', now() - interval '1 minute', 'SCHEDULED',
  'Recovery acceptance publish', 'acceptance-recovery', now(), now()
);
SQL

cat >"$WORK/boundary.py" <<'PY'
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fccfc0f01f000500020f49c2fa0000000049454e44ae426082')
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def _json(self, status, value):
        body = json.dumps(value).encode(); self.send_response(status); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == '/health': return self._json(200, {'status': 'ok'})
        self.record(b'')
        if self.path.startswith('/api/public/v1/posts?'):
            return self._json(200, {'posts': [{'id': 'postiz-acceptance', 'releaseId': 'post-acceptance', 'state': 'PUBLISHED'}]})
        if self.path == '/object/test-bucket/org/org_acceptance/asset.png' and self.headers.get('authorization') == 'Bearer storage-key' and self.headers.get('apikey') == 'storage-key':
            self.send_response(200); self.send_header('content-type', 'image/png'); self.end_headers(); return self.wfile.write(PNG)
        self._json(404, {'error': 'not found'})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('content-length', '0'))); self.record(raw)
        if self.path == '/api/public/v1/upload' and self.headers.get('authorization') == 'postiz-key': return self._json(201, {'id': 'media-acceptance', 'path': 'https://postiz.test/media.png'})
        if self.path == '/api/public/v1/posts' and self.headers.get('authorization') == 'postiz-key': return self._json(201, [{'postId': 'postiz-acceptance', 'integration': 'postiz-acceptance'}])
        self._json(404, {'error': 'not found'})
    def record(self, raw):
        with open(os.environ['BOUNDARY_LOG'], 'a') as log:
            log.write(json.dumps({'method': self.command, 'path': self.path, 'authorization': self.headers.get('authorization', ''), 'apikey': self.headers.get('apikey', ''), 'bytes': len(raw)}) + '\n')
ThreadingHTTPServer(('127.0.0.1', int(os.environ['BOUNDARY_PORT'])), Handler).serve_forever()
PY
BOUNDARY_PORT="$BOUNDARY_PORT" BOUNDARY_LOG="$WORK/boundary.log" python3 "$WORK/boundary.py" >"$WORK/boundary.out" 2>&1 & echo $! >"$WORK/boundary.pid"
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$BOUNDARY_PORT/health" >/dev/null 2>&1 && break; sleep 0.1; done

temporal server start-dev --headless --ip 127.0.0.1 --port "$TEMPORAL_PORT" --db-filename "$WORK/temporal.db" >"$WORK/temporal.log" 2>&1 & echo $! >"$WORK/temporal.pid"
for _ in $(seq 1 100); do temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1 && break; sleep 0.1; done
temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null

(cd "$SERVICES" && go build -o "$WORK/backend" ./backend/cmd/backend && go build -o "$WORK/orchestrator" ./orchestrator/cmd/orchestrator)
DATABASE_URL="$DATABASE_URL" PORT="$ORCHESTRATOR_PORT" TEMPORAL_ADDRESS="$TEMPORAL_ADDRESS" RUN_CRON=true STORAGE_API_URL="http://127.0.0.1:$BOUNDARY_PORT" STORAGE_BUCKET=test-bucket STORAGE_SERVICE_KEY=storage-key POSTIZ_API_URL="http://127.0.0.1:$BOUNDARY_PORT/api/public/v1" POSTIZ_API_KEY=postiz-key POSTIZ_REQUEST_TIMEOUT=5s "$WORK/orchestrator" >"$WORK/orchestrator.log" 2>&1 & echo $! >"$WORK/orchestrator.pid"
DATABASE_URL="$DATABASE_URL" PORT="$BACKEND_PORT" TEMPORAL_ADDRESS="$TEMPORAL_ADDRESS" PUBLISHING_SERVICE_TOKEN=acceptance-service PUBLISHING_ACTIVITY_TIMEOUT=5s PUBLISHING_RETRY_DELAY=100ms "$WORK/backend" >"$WORK/backend.log" 2>&1 & echo $! >"$WORK/backend.pid"
for _ in $(seq 1 100); do curl -fsS "http://127.0.0.1:$BACKEND_PORT/readyz" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS "http://127.0.0.1:$BACKEND_PORT/readyz" >/dev/null
for _ in $(seq 1 100); do curl -fsS "http://127.0.0.1:$ORCHESTRATOR_PORT/readyz" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS "http://127.0.0.1:$ORCHESTRATOR_PORT/readyz" >/dev/null

[[ "$(curl -sS -o /dev/null -w '%{http_code}' -H 'X-Organization-ID: org_acceptance' "http://127.0.0.1:$BACKEND_PORT/v1/channel-connections")" == 401 ]]
headers=(-H 'Authorization: Bearer acceptance-service' -H 'X-Organization-ID: org_acceptance' -H 'X-User-ID: user_acceptance' -H 'X-Request-ID: acceptance-request' -H 'Content-Type: application/json')
json_field() { python3 -c 'import json,sys; value=json.load(open(sys.argv[1])); print(value[sys.argv[2]] if sys.argv[2] in value else value["scheduledPost"][sys.argv[2]])' "$1" "$2"; }
future=$(python3 -c 'from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(seconds=5)).isoformat())')
cancel_future=$(python3 -c 'from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())')

[[ "$(curl -sS -o "$WORK/connection.json" -w '%{http_code}' "${headers[@]}" -X POST "http://127.0.0.1:$BACKEND_PORT/v1/channel-connections" --data '{"externalAccountId":"postiz-acceptance","platform":"x","providerSettings":{"who_can_reply_post":"everyone"},"secretReference":"POSTIZ_API_KEY"}')" == 201 ]]
connection_id=$(json_field "$WORK/connection.json" id)
publish_payload=$(printf '{"caption":"Acceptance publish","channelConnectionId":"%s","idempotencyKey":"acceptance-publish","scheduledFor":"%s","variantId":"variant_acceptance"}' "$connection_id" "$future")
[[ "$(curl -sS -o "$WORK/post.json" -w '%{http_code}' "${headers[@]}" -X POST "http://127.0.0.1:$BACKEND_PORT/v1/scheduled-posts" --data "$publish_payload")" == 201 ]]
post_id=$(json_field "$WORK/post.json" id)
temporal workflow describe --address "$TEMPORAL_ADDRESS" --workflow-id "post_$post_id" --output json >"$WORK/publish-workflow.json"
python3 -c 'import json,sys; info=json.load(open(sys.argv[1]))["workflowExecutionInfo"]; assert info["execution"]["workflowId"] == sys.argv[2]; assert info["type"]["name"] == "PostWorkflowV2"; assert info["taskQueue"] == "main"' "$WORK/publish-workflow.json" "post_$post_id"
temporal workflow list --address "$TEMPORAL_ADDRESS" --query "postId = '$post_id' AND organizationId = 'org_acceptance'" --output json >"$WORK/search-results.json"
grep -q "post_$post_id" "$WORK/search-results.json"
temporal workflow describe --address "$TEMPORAL_ADDRESS" --workflow-id missing-post-workflow --output json >"$WORK/missing-workflow.json"
python3 -c 'import json,sys; info=json.load(open(sys.argv[1]))["workflowExecutionInfo"]; assert info["type"]["name"] == "MissingPostWorkflow"; assert info["taskQueue"] == "main"' "$WORK/missing-workflow.json"
[[ "$(curl -sS -o "$WORK/replay.json" -w '%{http_code}' "${headers[@]}" -X POST "http://127.0.0.1:$BACKEND_PORT/v1/scheduled-posts" --data "$publish_payload")" == 200 ]]
[[ "$(json_field "$WORK/replay.json" id)" == "$post_id" ]]

cancel_payload=$(printf '{"caption":"Acceptance cancel","channelConnectionId":"%s","idempotencyKey":"acceptance-cancel","scheduledFor":"%s","variantId":"variant_acceptance"}' "$connection_id" "$cancel_future")
[[ "$(curl -sS -o "$WORK/cancel-create.json" -w '%{http_code}' "${headers[@]}" -X POST "http://127.0.0.1:$BACKEND_PORT/v1/scheduled-posts" --data "$cancel_payload")" == 201 ]]
cancel_id=$(json_field "$WORK/cancel-create.json" id)
[[ "$(curl -sS -o "$WORK/cancel.json" -w '%{http_code}' "${headers[@]}" -X POST "http://127.0.0.1:$BACKEND_PORT/v1/scheduled-posts/$cancel_id/cancel")" == 200 ]]
[[ "$(json_field "$WORK/cancel.json" status)" == CANCELLED ]]

status=''
for _ in $(seq 1 150); do status=$(psql "$DATABASE_URL" -Atqc "SELECT status::text FROM scheduled_post WHERE id='$post_id'"); [[ "$status" == PUBLISHED ]] && break; sleep 0.1; done
[[ "$status" == PUBLISHED ]]
recovery_status=''
for _ in $(seq 1 150); do recovery_status=$(psql "$DATABASE_URL" -Atqc "SELECT status::text FROM scheduled_post WHERE id='post_recovery_acceptance'"); [[ "$recovery_status" == PUBLISHED ]] && break; sleep 0.1; done
[[ "$recovery_status" == PUBLISHED ]]
temporal workflow describe --address "$TEMPORAL_ADDRESS" --workflow-id post_post_recovery_acceptance --output json >"$WORK/recovery-workflow.json"
python3 -c 'import json,sys; info=json.load(open(sys.argv[1]))["workflowExecutionInfo"]; assert info["type"]["name"] == "PostWorkflowV2"; assert info["taskQueue"] == "main"' "$WORK/recovery-workflow.json"
for _ in $(seq 1 100); do workflow_status=$(temporal workflow describe --address "$TEMPORAL_ADDRESS" --workflow-id "post_$post_id" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["workflowExecutionInfo"]["status"])'); [[ "$workflow_status" == WORKFLOW_EXECUTION_STATUS_COMPLETED ]] && break; sleep 0.1; done
[[ "$workflow_status" == WORKFLOW_EXECUTION_STATUS_COMPLETED ]]
for _ in $(seq 1 100); do cancel_workflow_status=$(temporal workflow describe --address "$TEMPORAL_ADDRESS" --workflow-id "post_$cancel_id" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["workflowExecutionInfo"]["status"])'); [[ "$cancel_workflow_status" == WORKFLOW_EXECUTION_STATUS_COMPLETED ]] && break; sleep 0.1; done
[[ "$cancel_workflow_status" == WORKFLOW_EXECUTION_STATUS_COMPLETED ]]

attempt=$(psql "$DATABASE_URL" -AtF '|' -c "SELECT \"attemptNumber\", outcome::text, \"providerPostId\", COALESCE(\"failureCode\", '') FROM publication_attempt WHERE \"scheduledPostId\"='$post_id'")
[[ "$attempt" == '1|SUCCEEDED|post-acceptance|' ]]
actions=$(psql "$DATABASE_URL" -Atc "SELECT action FROM audit_log WHERE \"organizationId\"='org_acceptance' ORDER BY \"createdAt\", id")
for expected in post.connection_created post.scheduled post.cancelled post.published; do grep -qx "$expected" <<<"$actions"; done
[[ "$(wc -l <"$WORK/boundary.log" | tr -d ' ')" == 8 ]]
if grep -q 'unhandled signals' "$WORK/orchestrator.log"; then
  echo "Temporal workflow left a signal unhandled" >&2
  exit 1
fi

echo "publishing acceptance passed: auth, Ent/Prisma schema, versioned Temporal workflows, durable timer, recovery singleton, idempotency, cancellation signal, storage, Postiz confirmation, publication receipt, and audit state"
