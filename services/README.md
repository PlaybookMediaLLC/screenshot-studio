# Publishing services

This directory contains Screenshot Studio's Go product API, Temporal workers,
and social provider services. The combined backend image runs them together in
production; Compose can start the social API separately for local testing.

## Architecture

The services split into a control plane and an execution plane:

- **backend** is the control plane. It exposes tenant-scoped APIs for Postiz
  channel connections and scheduled posts, validates approved creative variants,
  preserves idempotency, and writes audit records.
- **orchestrator** is the Temporal execution plane. It runs the versioned post
  workflow, re-checks workspace and approval eligibility, and records
  publication attempts. The direct provider path calls the Go social adapters
  and stores their remote receipt without creating a second social `Post` row.
- **Ent** is the Go data model and query layer for product and social records.
  One PostgreSQL database and its `public` schema hold both. The Next.js app
  calls the published SDK and never opens a database connection.

Each scheduled post maps to one Temporal workflow: workflow ID `post_<post-id>`,
workflow type `PostWorkflowV2`, workflow task queue `main`, and Postiz activity
task queue `postiz`. `PostWorkflowV1` remains registered for replay safety. The
workflow owns the scheduled timer, `cancel` and `poke` signals, and bounded
provider retry timers. The V2 activity calls the provider adapter directly and
stores its remote receipt on the canonical attempt. An ambiguous failure is
`UNKNOWN_DELIVERY` because retrying could create a duplicate social post.

## Temporal guarantees

The services make these Temporal guarantees at Screenshot Studio's provider
boundary:

| Guarantee | Implementation |
| --- | --- |
| Versioned workflows remain registered | `PostWorkflowV1` and `PostWorkflowV2` are both workers |
| Atomic recovery start | `poke` plus `SignalWithStartWorkflow` and `USE_EXISTING` |
| Searchable ownership | typed `organizationId` and `postId` attributes, registered on self-hosted Temporal |
| Durable scheduling and provider backoff | Temporal timers; classified `429` and safe `5xx` responses retry |
| No automatic retry of provider mutations | submit activity has one attempt; timeout becomes `UNKNOWN_DELIVERY` |
| Pending provider confirmation | V1 keeps read-only status checks for replay; V2 requires a confirmed direct receipt |
| Missing-post recovery | `missing-post-workflow` runs immediately and hourly when `RUN_CRON=true` |
| Worker placement controls | `EXCLUDE_QUEUE` and `WORKER_CONCURRENCY_DIVIDER` |
| Namespace readiness | `DescribeNamespace` with a 10-second bound |
| TLS and API-key authentication | both settings apply independently |

The per-network adapters, token refresh, comments, plugs, and repeat posts live
inside the social Go packages. Screenshot Studio's tenant Temporal
activity invokes the LinkedIn, X, or Instagram adapter directly. The social
HTTP API handles OAuth, but customer publishing does not call
`/public/v1/posts` or stage a second media copy. The social backend's autopost,
streak, and email workflows are product domains, not publishing transport, and
remain owned by Screenshot Studio's campaign and email systems.

## Database ownership

`ent/schema` and `screenshot-studio-backend/ent/schema` are the Ent sources for
product and social tables. One ordered `/platform-migrate` command applies
reviewed SQL from `platformmigrations/sql` and
`screenshot-studio-backend/migrations` to the same `public` schema. Prisma and
Drizzle are no longer runtime or migration authorities. Do not call
`client.Schema.Create` from either service. When a table changes, update its
Ent schema and reviewed SQL migration, then run `make generate` and `make
check` in this directory.

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

Service requests use `Authorization: Bearer $PUBLISHING_SERVICE_TOKEN` and
`X-Session-ID` with scoped organization, user, and request headers. The backend
validates the session and membership through Ent. The web server calls this
service through `packages/screenshot-studio-backend-sdk`; browser code uses
the existing same-origin tRPC facade and never receives the service token.

The orchestrator listens on `:8081` only for `/healthz` and `/readyz`.

## Configuration

Both services require `DATABASE_URL` and connect to Temporal with
`TEMPORAL_ADDRESS` (default `127.0.0.1:7233`), `TEMPORAL_NAMESPACE` (default
`default`), `TEMPORAL_API_KEY`, and `TEMPORAL_TLS`. The backend also requires
`PUBLISHING_SERVICE_TOKEN` and refuses to start or authenticate without it. The
orchestrator also requires:

- `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  (and optional `R2_REGION`, `R2_BROWSER_ENDPOINT`) for private tenant media
- `POSTIZ_API_URL` and an allow-listed API key reference for social OAuth and
  destination verification. They are held by the product backend, not the web.
  The publishing worker reads social integration rows from the shared database
  and signs the canonical private asset when due.

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

`./bin/social-gate` (from the repository root) is the end-to-end check: it runs
the web, backend, Temporal worker, private RustFS, and a fake social provider,
and publishes through the direct Go path. The database-gated Go tests cover the
workflow mapping, missing-post and due-post recovery, and Ent compatibility.

From the repository root, start the optional Compose profile with:

```sh
make publishing-up
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8081/healthz
```

The backend and orchestrator images use the `services` directory as their Docker
build context.

## MCP server

The social backend serves the Shots MCP server (RFC 038,
`screenshot-studio-backend/internal/chat/mcp`) on `/mcp` and the OAuth mounts
`/mcp-oauth-claude`, `/mcp-oauth-chatgpt`, and `/mcp-oauth-dynamic`. Its tools
call `internal/product`, the same domain the `/v1` API serves, with the caller's
workspace API key as the actor:

- `internal/shotsapi/openapi.json` is the web's OpenAPI document (`npm run
  api:generate`). Each tool's input schema, API-key scope, plan gate, and quota
  come from the operation it is named after; the server refuses to start when
  one is missing.
- A call runs the REST order: per-key limit, scope, `workspace:use`, the
  operation's feature, its quota, then argument validation and the domain call.
  Every call logs one `shots.mcp_call` line with the request ID, client, and
  workspace.
- Scheduling tools need the opt-in `post:schedule` scope and take only
  approved posts and variants. This process has no tenant Temporal client: the
  orchestrator's once-a-minute `scheduled-posts` dispatcher starts the
  workflow of a post an agent scheduled, and a cancelled post is never claimed.
- OAuth consent happens on the web (`/oauth/authorize`), recorded through
  `POST /v1/agent-authorizations`; `/oauth/token` exchanges the `shc_` code for
  a workspace API key with the approved scopes.

It reads `DATABASE_URL`, `R2_*` (in production the combined backend copies the
tenant's `TENANT_R2_*`), `PLATFORM_QUOTA_REDIS_URL` (default `REDIS_URL`),
`PLATFORM_CAMPAIGN_WORKFLOW`, `SCREENSHOT_API_URL`, and `PLATFORM_MCP_URL`, the
public MCP URL, which must sit at a host root for OAuth discovery: production
is `https://shots-mcp.playbookmedia.io/mcp`. Locally, `./bin/studio
postiz-go-up` serves it at `http://localhost:3100/mcp`.

## screenshot-studio-backend and screenshot-studio-orchestrator

`screenshot-studio-backend/` is Screenshot Studio's Go social backend and its
Temporal orchestrator. It serves the social HTTP API and the Temporal contracts
that the provider adapters use, while Screenshot Studio customer publishing uses
the canonical product post state.

Layout:

- `screenshot-studio-backend/backend/cmd/screenshot-studio-backend`: the HTTP entry point. CORS, MCP, the controllers in
  registration order (honors `MCP_ONLY`), the search-attribute and
  `missingPostWorkflow` registration, the configuration check, and `/docs`.
- `screenshot-studio-backend/orchestrator/cmd/screenshot-studio-orchestrator`: the workers (`main` plus one queue per
  provider, `email`, `email-bulk`) and `GET /health/status`.
- `screenshot-studio-backend/internal/app`: builds the service graph once from the environment, for
  both binaries. Consumer-interface adapters live in `adapters.go`.
- `screenshot-studio-backend/backend/{auth,api/*,publicapi}`: the controllers, guards and auth.
- `screenshot-studio-backend/orchestrator/{workflows,activities,worker}`: the Temporal side.
- `screenshot-studio-backend/internal/database/<domain>`: the social Ent repositories and services.
- `screenshot-studio-backend/internal/integrations/social/<provider>`: one package per provider.
- `screenshot-studio-backend/internal/*`: the support libraries.
- `screenshot-studio-backend/ent`: the generated Ent client.
- `screenshot-studio-backend/migrations`: the DDL.

**Environment.** The services read these variables: `DATABASE_URL`, `REDIS_URL`
(unset = in-memory), `TEMPORAL_*`, `JWT_SECRET`, `FRONTEND_URL`, `MAIN_URL`,
`NEXT_PUBLIC_BACKEND_URL`, `BACKEND_INTERNAL_URL`,
`STORAGE_PROVIDER`/`UPLOAD_DIRECTORY`/`CLOUDFLARE_*`,
`NOT_SECURED`, `STRIPE_*`, provider keys, `RUN_CRON`, `EXCLUDE_QUEUE`,
`WORKER_CONCURRENCY_DIVIDER`, `PORT` (default 3000), and `ORCHESTRATOR_PORT`
(default 3002). Each process forces `time.Local = time.UTC`.

**Migrations.** Run `/platform-migrate` before the API and workers. It applies
both Ent-backed SQL sets to one database, records their history, and adopts
compatible tables from the earlier Prisma deployment. `/postiz-migrate`
remains in the image for isolated social backend tests; it is not a second
production migration job. See [the deployment guide](../docs/social-backend-deployment.md)
for the local and App Platform configuration.

```sh
go build ./screenshot-studio-backend/backend/cmd/screenshot-studio-backend ./screenshot-studio-backend/orchestrator/cmd/screenshot-studio-orchestrator
POSTIZ_TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postiz_test?sslmode=disable go test ./screenshot-studio-backend/...
temporal server start-dev   # then run both binaries with the variables above
```

**Implementation notes:**

- **Temporal.** Workflow names, IDs and arguments match the earlier TypeScript
  deployment, but Go workers cannot replay workflows that a TypeScript worker
  started (Go has different `patched` markers). Drain or cut over the `main`
  workflow workers. Activity workers are interchangeable with the TypeScript
  ones. `cancellationType: ABANDON` is not available in Go. `SignalWithStart`
  sends one `null` argument.
- **HTTP.**
  - Response compression is supported (Brotli, gzip, and deflate).
  - Cookies use `Max-Age=0` and Go's attribute order.
  - JSON type mismatches fail at decode with a 400.
  - `/docs` serves Swagger UI with a minimal OpenAPI document that lists every
    route (method and path) without schemas. `/docs-json` serves the same
    document.
- **AI.** OpenAI is called with chat completions over HTTP. The Mastra and
  LangGraph event and memory tables are supported, not their internals.
  CopilotKit 1.72 is spoken through its single-route envelope.
- **Libraries.**
  - Google APIs, Neynar, Facebook, Transloadit, RSS, HTML, and audio metadata:
    plain HTTP or the standard library.
  - HTML sanitizing, HTML parsing, tag stripping, tweet text, and Markdown
    removal: Go implementations verified against golden outputs.
  - Stripe uses stripe-go v84, with API version `2026-02-25.clover`.
- **Data.**
  - Ent returns its in-memory timestamps, while Prisma returns the stored
    `timestamp(3)` values. The two can differ by 1 ms of rounding.
  - Some internal lookups load full rows where Prisma selected a few columns.
    Sensitive columns are never serialized.
- **Bounded recursion.** The Go code caps recursion that has no natural bound:
  - the `getMissingContent` refresh retry runs once
  - the random draft time search stops after 10,000 tries
  - a negative `intervalInDays` shows the post once
