# Publishing services

This directory contains the two Go deployables that replace the Podinfo service
templates and implement Screenshot Studio's Postiz publishing boundary.

## Architecture

The split follows the useful boundary in Postiz's `apps/backend` and
`apps/orchestrator`, without copying Postiz's full platform:

- **backend** is the control plane. It exposes tenant-scoped APIs for Postiz
  channel connections and scheduled posts, validates approved creative variants,
  preserves idempotency, and writes audit records.
- **orchestrator** is the Temporal execution plane. It runs the versioned post
  workflow and Postiz activities, re-checks workspace and approval eligibility,
  reads the tenant asset, calls Postiz, and records publication attempts.
- **Ent** is the shared Go data model. The schemas map to the existing Prisma
  table and column names so the Next.js application and both Go services operate
  on the same durable state machine.

Each scheduled post maps to one Temporal workflow: workflow ID `post_<post-id>`,
workflow type `PostWorkflowV2`, workflow task queue `main`, and Postiz activity
task queue `postiz`. `PostWorkflowV1` remains registered for replay safety. The
workflow owns the scheduled timer, `cancel` and `poke` signals, rate-limit retry
timer, and Postiz status-confirmation timers. The outbound Postiz mutation has
one Temporal attempt. A timeout or invalid receipt is `UNKNOWN_DELIVERY` because
retrying could create a duplicate social post.

## Postiz Temporal parity

This contract is pinned to Postiz commit
`60ffa4df2277130cdbf255e81aa13f0e8f31fd1e` (2026-08-30). The services match
every Temporal guarantee at Screenshot Studio's provider boundary:

| Postiz guarantee | Screenshot Studio implementation |
| --- | --- |
| Versioned workflows remain registered | `PostWorkflowV1` and `PostWorkflowV2` are both workers |
| Atomic recovery start | `poke` plus `SignalWithStartWorkflow` and `USE_EXISTING` |
| Searchable ownership | typed `organizationId` and `postId` attributes, registered on self-hosted Temporal |
| Durable scheduling and provider backoff | Temporal timers; only explicit `429` responses retry |
| No automatic retry of provider mutations | submit activity has one attempt; timeout becomes `UNKNOWN_DELIVERY` |
| Pending provider confirmation | read-only status checks retry safely for up to 90 checks at 20-second intervals |
| Missing-post recovery | `missing-post-workflow` runs immediately and hourly when `RUN_CRON=true` |
| Worker placement controls | `EXCLUDE_QUEUE` and `WORKER_CONCURRENCY_DIVIDER` |
| Namespace readiness | `DescribeNamespace` with a 10-second bound |
| TLS and API-key authentication | both settings apply independently |

Postiz's per-social-network workers, token refresh, comments, plugs, and repeat
posts remain inside the Postiz provider service. Screenshot Studio calls that
service through the single adapter required by RFC 020; copying those workers
here would create a second provider implementation. Postiz's autopost, streak,
and email workflows are product domains, not publishing transport, and remain
owned by Screenshot Studio's campaign and email systems.

## Database ownership

`ent/schema` is the Go schema and generated client source. Prisma migrations in
the repository root remain the physical migration authority because these tables
already exist and are also used by the Next.js application. Do not call
`client.Schema.Create` from either service. When a publishing table changes:

1. update the Prisma schema and add a reviewed Prisma migration;
2. update the matching Ent schema and storage keys;
3. run `make generate` and `make check` in this directory.

The Ent projections for `creative_variant`, `approval`, `asset`,
`workspace_deletion`, and the audit tables intentionally contain only fields the
publishing services read or write.

## API

The backend listens on `:8080` by default:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Process health |
| `GET` | `/readyz` | Database and Temporal readiness |
| `GET` / `POST` | `/v1/channel-connections` | List or create Postiz destinations |
| `GET` / `POST` | `/v1/scheduled-posts` | List or create scheduled posts |
| `POST` | `/v1/scheduled-posts/{id}/cancel` | Cancel an unpublished post |

Service requests use `Authorization: Bearer $PUBLISHING_SERVICE_TOKEN` and the
server-trusted headers `X-Organization-ID`, `X-User-ID`, `X-Request-ID`, and
optionally `X-Actor-Display`. Browser clients must not call this service directly.

The orchestrator listens on `:8081` only for `/healthz` and `/readyz`.

## Configuration

Both services require `DATABASE_URL` and connect to Temporal with
`TEMPORAL_ADDRESS` (default `127.0.0.1:7233`), `TEMPORAL_NAMESPACE` (default
`default`), `TEMPORAL_API_KEY`, and `TEMPORAL_TLS`. The backend also requires
`PUBLISHING_SERVICE_TOKEN` and refuses to start or authenticate without it. The
orchestrator also requires:

- `STORAGE_API_URL`, `STORAGE_BUCKET`, `STORAGE_SERVICE_KEY`
- `POSTIZ_API_URL` (defaults to `https://api.postiz.com/public/v1`)
- each allow-listed credential reference stored by a connection, for example
  `POSTIZ_API_KEY` or `POSTIZ_OAUTH_TOKEN_CUSTOMER_A`

Optional workflow controls are `TEMPORAL_TASK_QUEUE`,
`TEMPORAL_POSTIZ_TASK_QUEUE`,
`TEMPORAL_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTORS`,
`EXCLUDE_QUEUE`, `WORKER_CONCURRENCY_DIVIDER`, `RUN_CRON`,
`PUBLISHING_ACTIVITY_TIMEOUT`, `PUBLISHING_RETRY_DELAY`,
`PUBLISHING_MAX_ATTEMPTS`, and `POSTIZ_REQUEST_TIMEOUT`.

## Development

```sh
make generate
make check
make build
```

`make acceptance` additionally runs Temporal and both compiled services against an empty
PostgreSQL database created from the repository's real Prisma migration SQL. It
checks the one-post/one-workflow mapping, typed search attributes, durable timer,
cancellation signal, missing-post recovery, authenticated HTTP API, Ent
compatibility, idempotency, storage and Postiz HTTP boundaries, confirmed
publication receipts, and audit state. The Temporal CLI is required.
Set `PUBLISHING_ACCEPTANCE_DATABASE_URL` to a disposable empty database whose
name contains `acceptance` or `test`; the script refuses any other database.

From the repository root, start the optional Compose profile with:

```sh
make publishing-up
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8081/healthz
```

The backend and orchestrator images use the `services` directory as their Docker
build context.
