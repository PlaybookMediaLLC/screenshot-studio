# Publishing services

This directory contains the two Go deployables that replace the Podinfo service
templates and implement Screenshot Studio's Postiz publishing boundary.

## Architecture

The split follows the useful boundary in Postiz's `apps/backend` and
`apps/orchestrator`, without copying Postiz's full platform:

- **backend** is the control plane. It exposes tenant-scoped APIs for Postiz
  channel connections and scheduled posts, validates approved creative variants,
  preserves idempotency, and writes audit records.
- **orchestrator** is the execution plane. It polls the durable `scheduled_post`
  queue, atomically claims work, re-checks workspace and approval eligibility,
  reads the tenant asset, calls Postiz, and records publication attempts.
- **Ent** is the shared Go data model. The schemas map to the existing Prisma
  table and column names so the Next.js application and both Go services operate
  on the same durable state machine.

The orchestrator deliberately retries only HTTP 429 responses. A timeout or an
invalid receipt after the final Postiz mutation is `UNKNOWN_DELIVERY` and is not
retried automatically because the provider may already have published the post.

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
| `GET` | `/readyz` | Database readiness |
| `GET` / `POST` | `/v1/channel-connections` | List or create Postiz destinations |
| `GET` / `POST` | `/v1/scheduled-posts` | List or create scheduled posts |
| `POST` | `/v1/scheduled-posts/{id}/cancel` | Cancel an unpublished post |

Service requests use `Authorization: Bearer $PUBLISHING_SERVICE_TOKEN` and the
server-trusted headers `X-Organization-ID`, `X-User-ID`, `X-Request-ID`, and
optionally `X-Actor-Display`. Browser clients must not call this service directly.

The orchestrator listens on `:8081` only for `/healthz` and `/readyz`.

## Configuration

Both services require `DATABASE_URL`. The backend also requires
`PUBLISHING_SERVICE_TOKEN` and refuses to start or authenticate without it. The
orchestrator also requires:

- `STORAGE_API_URL`, `STORAGE_BUCKET`, `STORAGE_SERVICE_KEY`
- `POSTIZ_API_URL` (defaults to `https://api.postiz.com/public/v1`)
- each allow-listed credential reference stored by a connection, for example
  `POSTIZ_API_KEY` or `POSTIZ_OAUTH_TOKEN_CUSTOMER_A`

Optional worker controls are `PUBLISHING_BATCH_SIZE`,
`PUBLISHING_POLL_INTERVAL`, `PUBLISHING_STALE_AFTER`,
`PUBLISHING_RETRY_DELAY`, `PUBLISHING_MAX_ATTEMPTS`, and
`POSTIZ_REQUEST_TIMEOUT`.

## Development

```sh
make generate
make check
make build
```

From the repository root, start the optional Compose profile with:

```sh
make publishing-up
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8081/healthz
```

The backend and orchestrator images use the `services` directory as their Docker
build context.
