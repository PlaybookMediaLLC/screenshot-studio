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

## screenshot-studio-backend and screenshot-studio-orchestrator

`screenshot-studio-backend/` is a Go port of Postiz's NestJS `apps/backend` and
`apps/orchestrator` (plus the `nestjs-libraries` and `helpers` code they use).
It is a drop-in replacement: same Prisma tables, HTTP routes, JSON shapes,
Temporal workflow and activity names, task queues, IDs, signals and search
attributes, and the same provider calls.

Layout:

- `screenshot-studio-backend/backend/cmd/screenshot-studio-backend`: `main.ts`. CORS, MCP (`startMcp`), the controllers in
  Nest's registration order (honors `MCP_ONLY`), the search-attribute and
  `missingPostWorkflow` registration, the configuration check, and `/docs`.
- `screenshot-studio-backend/orchestrator/cmd/screenshot-studio-orchestrator`: the workers (`main` plus one queue per
  provider, `email`, `email-bulk`) and `GET /health/status`.
- `screenshot-studio-backend/internal/app`: builds the service graph once from the environment, for
  both binaries. Consumer-interface adapters live in `adapters.go`.
- `screenshot-studio-backend/backend/{auth,api/*,publicapi}`: the controllers, guards and auth.
- `screenshot-studio-backend/orchestrator/{workflows,activities,worker}`: the Temporal side.
- `screenshot-studio-backend/internal/database/<domain>`: the Prisma repositories and services.
- `screenshot-studio-backend/internal/integrations/social/<provider>`: one package per provider.
- `screenshot-studio-backend/internal/*`: the support libraries.
- `screenshot-studio-backend/ent`: the generated Ent client.
- `screenshot-studio-backend/migrations`: the DDL.

**Environment.** The services read the same variables as Postiz's
`.env.example`, under the same names and defaults: `DATABASE_URL`, `REDIS_URL`
(unset = in-memory), `TEMPORAL_*`, `JWT_SECRET`, `FRONTEND_URL`, `MAIN_URL`,
`NEXT_PUBLIC_BACKEND_URL`, `STORAGE_PROVIDER`/`UPLOAD_DIRECTORY`/`CLOUDFLARE_*`,
`NOT_SECURED`, `STRIPE_*`, provider keys, `RUN_CRON`, `EXCLUDE_QUEUE`,
`WORKER_CONCURRENCY_DIVIDER`, `PORT` (default 3000), and `ORCHESTRATOR_PORT`
(default 3002). Each process forces `time.Local = time.UTC`, as Postiz sets
`TZ=UTC`.

**Migrations.** Postiz migrates with Prisma, so by default the Go services use
the schema as they find it. Set `POSTIZ_GO_MIGRATE=true` to apply
`screenshot-studio-backend/migrations` at startup; this records the run in `_postiz_go_migrations`
and adopts an existing Postiz schema.
The deployable backend image also contains `/postiz-migrate`, a one-shot
command used by Compose and Fly before the API and workers start.

See [the deployment guide](../docs/postiz-go-deployment.md) for the optional
local stack and the two Fly service configurations.

```sh
go build ./screenshot-studio-backend/backend/cmd/screenshot-studio-backend ./screenshot-studio-backend/orchestrator/cmd/screenshot-studio-orchestrator
POSTIZ_TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postiz_test?sslmode=disable go test ./screenshot-studio-backend/...
temporal server start-dev   # then run both binaries with the Postiz .env
```

**Parity notes and known deviations** (each package's details are in
`.context/postiz-go/reports/`):

- **Temporal.** Workflow names, IDs and arguments match the TypeScript code, but
  Go workers cannot replay workflows that a TypeScript worker started (Go has
  different `patched` markers). Drain or cut over the `main` workflow workers.
  Activity workers are interchangeable with the TypeScript ones.
  `cancellationType: ABANDON` is not available in Go. `SignalWithStart` sends one
  `null` argument.
- **HTTP.**
  - Express-style response compression is supported (Brotli, gzip, and deflate).
  - Cookies use `Max-Age=0` and Go's attribute order.
  - JSON type mismatches fail at decode with a 400 instead of class-validator's
    "must be a string" messages.
  - `/docs` serves Swagger UI with a minimal OpenAPI document that lists every
    route (method and path) without schemas. `/docs-json` serves the same
    document.
- **AI.** OpenAI is called with chat completions over HTTP, not the AI SDK's
  Responses API. Mastra and LangGraph are reproduced at the level of their events
  and memory tables, not their internals. CopilotKit 1.72 is spoken through its
  single-route envelope.
- **Libraries.** Several libraries are replaced:
  - googleapis, Neynar, the Facebook SDK, Transloadit, rss-parser, JSDOM and
    music-metadata: plain HTTP or the standard library.
  - DOMPurify, parse5, striptags, twitter-text and remove-markdown: hand ports
    verified against golden outputs.
  - Stripe uses stripe-go v84, with API version `2026-02-25.clover`.
- **Data.**
  - Ent returns its in-memory timestamps, while Prisma returns the stored
    `timestamp(3)` values. The two can differ by 1 ms of rounding.
  - Some internal lookups load full rows where Prisma selected a few columns.
    Sensitive columns are never serialized.
- **Unbounded recursion.** Where TypeScript recursion has no bound, the Go code
  caps it:
  - the `getMissingContent` refresh retry runs once
  - the random draft time search stops after 10,000 tries
  - a negative `intervalInDays` shows the post once
