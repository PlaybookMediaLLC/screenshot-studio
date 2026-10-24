# Release-readiness implementation contracts

**Design status:** Proposed, shared by RFCs 045–051. These tables, endpoints and
workers do not exist yet. Existing implementation references below identify
extension points, not completed features. Baseline: main at `19390194`.

The [RFC execution order](rfcs/README.md) remains unchanged. Implement each
contract with the first RFC that consumes it; this document does not introduce
a prerequisite platform project. RFC 045 can start with a private ledger.

## Service and ownership boundaries

```text
Next.js route + Zod contract / approved MCP draft tool
  -> tenant context + backend SDK
  -> authenticated Go HTTP handler
  -> Go product operation: authorize, validate, transact
  -> PostgreSQL: domain rows + audit decision + outbox, one commit
  -> existing outbox dispatcher -> Temporal -> bounded activity
  -> object store / provider API, outside the database transaction
```

Extend the [release route](../app/api/v1/releases/route.ts),
[contract definitions](../lib/api/contracts/releases.ts),
[backend adapter](../lib/backend/sdk.ts),
[SDK transport](../packages/screenshot-studio-backend-sdk/src/index.ts),
[Go HTTP handlers](../services/internal/httpapi/launch.go) and
[product operations](../services/internal/product/launch.go). New platform
models belong in the existing Ent schema directory; do not extend upstream
editor persistence to store readiness decisions.

Every public endpoint below starts with `/api/v1`; the Go counterpart starts
with `/v1`. Register contracts and regenerate OpenAPI/client schemas in the
same implementation change. Export Zod-derived request/response types with
TSDoc. UI, REST and MCP must call the same Go operation. Do not expose human
decisions as agent tools, and do not give a worker a browser session token.

Proposed file layout for the first vertical slice (these paths are to be
created during implementation, not source files claimed to exist):

```text
services/ent/schema/platform_release_readiness.go
services/internal/product/release_qualification.go
services/internal/product/release_qualification_integration_test.go
services/internal/httpapi/release_readiness.go
lib/api/contracts/release-readiness.ts
packages/screenshot-studio-backend-sdk/src/release-readiness.ts
app/api/v1/releases/[id]/qualification/route.ts
```

Add sibling domain modules for evidence, kits, capture, handoffs and freshness
as their slices ship. Keep transport decoding in HTTP/SDK modules, business
validation in product operations, pure readiness evaluation in its own Go
module, and provider I/O in bounded activities. Do not grow the existing
launch module into the owner of every new state machine.

## Authority matrix

| Operation | Session authority | API key / worker authority |
| --- | --- | --- |
| Read permitted release, claim and kit data | Existing workspace and artifact read checks | Live key with `artifact:read`; return redacted DTOs, never credentials. |
| Create qualification draft / candidate | Owner, admin, creator, writer_publisher | Live key with `release:create`; no human decision fields. |
| Edit claims, attach evidence, assemble kit drafts | Owner, admin, creator, writer_publisher | Defer new machine mutations in the first slice; existing draft/upload tools continue. |
| Qualify, verify claims, approve kits, resolve semantic findings | Owner, admin, approver, plus assigned reviewer constraint | Session only. Support grants, service principals, webhooks and API keys fail. |
| Request handoff | Owner, admin, publisher, writer_publisher | Session only initially; scheduling scope does not imply arbitrary kit delivery. |
| Manage capture credentials and destinations | Owner/admin with existing connection management permission | No raw credential access; worker receives a run-scoped secret reference. |
| Execute an accepted job | No impersonated human decision | Internal service identity restricted to the persisted job, org and action; recheck the requesting human's authority. |

Assignment narrows role permissions; it never grants them. The author may also
be the reviewer during pilots if that person holds the relevant role. Record
fact verification and kit approval separately even when they share an actor.
Approval-time session IDs are audit provenance. Later export/send checks verify
that the approving person still has active membership and the required role;
ordinary expiry of that person's original login session does not revoke a
historical approval. A new human command needs a currently valid session.
Accepted background work uses its persisted delegation plus current requester
membership/role and connection checks, not a replay of the original cookie.

The current [configuration authorization](../services/internal/product/configuration.go)
checks API-key liveness in its general role helper; this is not a check of the
key's requested scope. New Go machine entrypoints must load live permissions
and enforce the required scope, using the semantics of
[AgentKey](../services/internal/product/agent_keys.go). A web-only scope check
would leave direct Go/MCP calls inconsistent. Keep the TS and Go scope lists
synchronized; no new scope is required for the first manual slices.

Check subscription/feature and quota policy using existing gates. This work
does not create a new plan or permit pilots to bypass billing. Tenant IDs come
from authenticated context, never a request body. Query every object by both
organization and ID; return 404 for foreign-tenant references without leaking
their existence. Service jobs must validate every referenced child likewise.

## Relational conventions and aggregate locking

All proposed tables have organization ID, stable CUID ID where appropriate,
UTC timestamps, and explicit foreign keys. In the RFC table sketches, `org`
means organization ID, `release` means canonical release ID, and `version`
means a positive integer. These are logical names, not migration-ready DDL;
Ent storage keys must match the final SQL. Use bigint for counters and serialize
them as decimal strings in JSON to avoid JavaScript precision loss.

Every child reference includes organization in its foreign key, with a unique
parent `(org, id)` index. A child referencing a release-owned parent must use a
unique `(org, release, id)` key, preventing same-tenant cross-release claims or
approvals. The existing release table needs the supporting composite index.
Organization-wide sources may support multiple releases; their references
are organization-scoped, with an explicit release-to-evidence binding.
Use RESTRICT for reviewed records; account deletion follows the existing
workspace deletion workflow, not ad hoc cascade deletion of evidence.

RFC 046 introduces one aggregate row:

```text
platform_release_readiness
  PK (org, release), FK -> existing release
  head_revision bigint NOT NULL DEFAULT 0 CHECK >= 0
  qualification_revision_id nullable
  first_qualified_at nullable timestamptz
  canonical_state ACTIVE | MERGED | WITHDRAWN
  merged_into_release_id nullable, same-org FK
```

Persist facts and decisions as append-only revisions; mutable pointers select
the current revision. Content/hash fields are immutable; lifecycle states and
current pointers are explicitly mutable projections of recorded decisions.
A release command increments the aggregate revision once. Source-only changes
advance their source sequence instead; background notification/projection
updates do not change either counter. Allocate versions
under a row lock, not an unprotected MAX(version)+1 query. Cross-release
operations lock aggregate rows in sorted release-ID order.

When an operation also needs credential, membership or evidence locks, acquire
them in this order: authority rows, source-head rows sorted by ID, aggregate
rows sorted by release ID, child rows. Add transaction-aware authorization
helpers so role checks use the same transaction and hold shared locks against
membership/session/key revocation. Audit the corresponding revocation writers
for lock compatibility. A preflight authorization call alone does not close
the race between a check and a commit.

```text
BEGIN
  authorize current principal, feature and requested action
  lock the relevant authority/source/aggregate rows in the defined order
  find command receipt by org + actor identity + operation + idempotency key
  if receipt exists: compare request hash, return original result
  compare expectedRevision to head_revision; otherwise return conflict
  validate all same-org/release references and business invariants
  append immutable revision / decision; update current pointers
  increment head_revision; append audit event
  insert outbox event and command receipt
COMMIT
```

Reauthorize even on receipt replay. A replay returns the original decision or
resource reference; it does not make a later-revoked download accessible.
Receipts retain the canonical request hash and minimal response for the
resource lifetime. A same-key/different-body request returns 409. A failed
validation creates no successful receipt. External I/O never occurs in this
transaction; object upload/render completion is an independently checked step.

The command-receipt relation needs a database uniqueness constraint, not just
an application lookup. Proposed core columns, omitting audit/retention fields:

```sql
CREATE TABLE platform_readiness_command_receipt (
  organization_id text NOT NULL REFERENCES organization(id),
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  operation text NOT NULL,
  command_key varchar(128) NOT NULL CHECK (length(command_key) > 0),
  request_sha256 char(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_ref jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_kind, actor_id, operation, command_key)
);
```

If concurrent commands target different aggregates with the same receipt key,
the unique insert loser rolls back its entire transaction and reloads the
winner's receipt, comparing the request hash before returning. It cannot
commit its domain mutation while treating receipt insertion as optional.
Use a two-second lock timeout and five-second transaction deadline initially;
bounded internal retries may replay an aborted deadlock transaction, never an
external call. Surface exhausted contention as a retryable service error.

## HTTP and error contract

New mutating endpoints require a nonempty, at-most-128-character
`Idempotency-Key`; the permissive existing release-create behavior remains
compatible. Draft/decision mutations also require `expectedRevision`.
New resource: 201; replay: 200; asynchronous job accepted: 202 plus a job URL.
List endpoints use an opaque `(createdAt, id)` cursor, default 50, maximum 100.

Extend the existing stable platform error envelope with an optional typed
`details` object, including the Go domain-error mapping, HTTP writer,
[platform error adapter](../lib/api/platform-errors.ts) and SDK transport.
The current generic Go writer returns an error string; simply throwing a new
domain error will not preserve these proposed fields across all boundaries.

```json
{
  "code": "conflict",
  "error": "The release changed while you were reviewing it.",
  "message": "Reload the current revision before deciding.",
  "status": 409,
  "details": {
    "reason": "REVISION_CONFLICT",
    "currentRevision": "18",
    "blockers": []
  }
}
```

Use 400 for invalid shapes/limits, 403 for insufficient authority, 404 for
inaccessible references, 409 for stale revisions, incompatible state or
unmet readiness gates, 429 with retry information for quotas, and 503 for
transient unavailable dependencies. Blockers have stable reason, object ID,
assigned owner and repair action; do not put source excerpts, secrets or raw
provider errors in error payloads. UI copy may change independently of codes.

## Immutable hashes and source fences

RFC 047 introduces immutable evidence bytes plus a mutable source head; RFC
049 pins their transitive closure in each frozen kit. RFC 051 adds impact
analysis, not the first protection against changed evidence.

Use SHA-256 of bytes for assets. Hash structured manifests with RFC 8785 JSON
canonicalization, a schema version and a domain separator:

```text
SHA256(UTF8("shots.release-kit.v1\n") || canonicalJSON(manifest))
```

Reject unsupported numbers/invalid Unicode before canonicalization; counters
are strings. Sort set-like arrays by stable IDs, preserve document paragraph
and display order, omit transient URLs and transport timestamps, and retain
the exact canonical bytes. Go and TS must share test vectors including Unicode,
empty values and reordered keys. The Go result is authoritative.

A frozen kit stores every underlying source ID and its acknowledged change
sequence. Approval/export/send checks join those pins to current source heads
in PostgreSQL and lock the relevant heads until the decision commits. An
unacknowledged material change or deleted source blocks the action even if an
asynchronous freshness worker has not run. Source-change writes take the same
head locks. New draft edits do not mutate pinned bytes; declaring a replacement,
changing qualification or withdrawing evidence explicitly invalidates use.

## Jobs, outbox and partial failure

Reuse [outbox rows](../services/ent/schema/outbox.go) and the
[maintenance dispatcher](../services/internal/maintenance/outbox.go).
Its product-event list is closed: adding an outbox type without adding dispatch
and product-handler routing can acknowledge work without executing it. Each
new event requires dispatch, handler and unknown-event coverage together.

Payloads contain schema version, org, aggregate ID, revision and logical job ID;
never credentials, source content or expiring signed URLs. Use one unique
outbox idempotency key per logical event. Extend the existing Temporal worker
registration with domain workflows. Use stable workflow IDs, recover an already
started run after a lost acknowledgment, and keep database job/step receipts
as the business source of truth. Temporal retries do not substitute for
provider idempotency.

Proposed routing keys, introduced only with the consuming RFC:

| Event | Consumer / logical identity |
| --- | --- |
| release_readiness.qualification_changed | Projection/task update keyed by qualification decision ID; never automatic approval. |
| release_readiness.evidence_changed | Source-change projection, later 051 fanout keyed by source/change sequence. |
| release_readiness.capture_requested | 048 workflow keyed by capture run ID. |
| release_readiness.kit_prepare_requested | 049 workflow keyed by kit revision/preparation job ID. |
| release_readiness.export_requested | 049 workflow keyed by kit revision/audience/export version. |
| release_readiness.handoff_requested | 050 workflow keyed by handoff intent ID; step receipts govern provider retries. |

Keep internal routing events separate from customer webhook subscriptions;
no new event becomes externally published merely because it enters the outbox.

The current dispatcher has a 10-minute stale-claim recovery and an eight-attempt
dead-letter budget. Preserve those semantics unless separately changed. RFCs
048–050 define activity-specific deadlines and safe retry cases. A dead letter
needs an operator-visible failure and explicit replay of the same logical job;
it must not create a second approval, charge or send intent.

## Migration, delivery and verification sequence

1. Add schema and SQL together with unique/composite keys and indexes. Choose
   a migration identifier after the repository's highest existing timestamp,
   not merely today's date. The
   [migration runner](../services/platformmigrations/migrations.go) executes
   each file in an advisory-locked transaction, so concurrent index creation
   cannot be placed inside an ordinary migration.
2. Deploy additive backend reads/writes behind per-workspace configuration;
   regenerate Ent and API clients. Bound transaction lock time and inspect
   query plans for organization/release and dependency-index lookups.
3. Backfill by `(createdAt, id)` batches of at most 200, with durable cursor,
   idempotent inserts and explicit counts of skipped/invalid rows. No backfill
   emits approval, delivery, use or notification events. Validate new FK
   constraints before enabling writes. Legacy approvals remain historical.
4. Ship session-based manual UI and vertical integration tests first. Add
   workers/provider adapters only at the RFC slice that requires them.
5. Disable new writes/triggers to roll back; retain rows and immutable bundles.
   Never drop history or auto-clear a blocker to recover service availability.

Implementation tests must use real PostgreSQL for locks, unique/FK constraints
and rollback; fake providers for lost acknowledgments and partial side effects;
and controllable time for expiry/retry/cohort boundaries. Include direct Go,
public REST and MCP-denial tests so UI checks cannot mask an authorization
gap. The RFC test matrices are future implementation gates, not tests claimed
to pass as part of this documentation change.
