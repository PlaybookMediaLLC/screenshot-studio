# DigitalOcean production deployment

**Cutover status (2026-10-16):** The single-database Go product/SDK cutover is
applied in production. `doctl apps get` shows the `web`, `storage`, and combined
`screenshot-studio-backend` services, the `platform-migrate` and
`postiz-migrate` pre-deploy jobs, and no `web-migrate`; the active deployment
runs the images built from `d2482e6`. Every push to `main` now deploys the
backend first and the web second. Live social canaries on the cutover
architecture are still outstanding; see
[social publishing verification](social-publishing-verification.md).

Production is `screenshot-studio-production` in DigitalOcean's `nyc` region,
app ID `c525b0ba-b92a-4174-ae91-4ab4d7c92fd2`, at
<https://shots.playbookmedia.io>. The retired `shots.oppulence.io` stays on the
app as an alias: its pages redirect, and its API routes still answer for
webhooks configured with the old host. The local `doctl` context is
`solomonai-cluster`.

| Component | Source | Readiness | Exposure |
| --- | --- | --- | --- |
| `web` | Existing pinned GHCR image | `/api/health`, port 3000 | `/` |
| `screenshot-studio-backend` | Public GHCR image built on GitHub | `/readyz`, port 3003 | Internal only: ports 3003 and 8082; the social API on 3000 is loopback-only |

The web component retains its two replicas. The single Go
backend container starts the Postiz API and worker plus the tenant publishing
and maintenance orchestrator. Its readiness endpoint checks all three local
HTTP endpoints, including the tenant database and Temporal namespace. The
backend image is built on GitHub and selected by a unique commit SHA tag in
App Platform. The image workflow verifies the public digest before deployment.

Storage uses `internal_ports` and has no public ingress rule. Designs render
in Cloudflare Browser Rendering, not on App Platform: the web deploy removes
the old `design-renderer` component and requires `PLATFORM_RENDER_CDP_URL`
(`wss://api.cloudflare.com/client/v4/accounts/<account>/browser-run/devtools/browser?keep_alive=600000`)
and `PLATFORM_RENDER_CDP_TOKEN` (a Cloudflare API token with Browser Rendering
Edit) in Infisical.

The MCP server (RFC 038) runs in `screenshot-studio-backend` and is public at
`https://shots-mcp.playbookmedia.io/mcp`. Set `PLATFORM_MCP_URL` to that URL
in Infisical. The renderer then adds the host as an alias domain and, on that
host only, routes the MCP and OAuth paths (`/mcp*`, `/.well-known`, `/oauth`)
to the backend ahead of the web; OAuth discovery reads metadata from the host
root. The backend has no other public route. Point a `CNAME` for `shots-mcp.playbookmedia.io`
at the app's default domain. App Platform issues the certificate once the name
resolves.

See DigitalOcean's [internal routing documentation](https://docs.digitalocean.com/products/app-platform/how-to/manage-internal-routing/)
and [app spec reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

## Existing managed dependencies

- PlanetScale: the cutover uses one Screenshot Studio PostgreSQL logical
  database and its `public` schema for auth, product, and social tables.
  Previous application, storage, and Postiz databases remain read-only for
  rollback until the cutover is accepted; they are not runtime dependencies.
- Upstash: the existing Screenshot Studio Redis instance. Postiz uses that
  instance too; its URL is independently configurable with `POSTIZ_REDIS_URL`.
- R2: the private product media bucket (`screenshot-studio`) contains
  canonical assets and has no public domain. Editor backgrounds and overlays
  live in the separate public bucket `screenshot-studio-public-assets` at
  `shots-assets.oppulence.io` ([storage guide](tenant-storage.md#public-editor-assets)).
  The legacy Postiz media bucket may remain for rollback, but customer
  publishing signs the product asset directly at dispatch. No local filesystem
  is durable media.
- Temporal Cloud: `screenshot-studio-publishing.kpisa` and
  `screenshot-studio-postiz.kpisa`, both in AWS US East, with seven-day history
  retention. Each registers `organizationId` and `postId` as Keyword search
  attributes. These namespaces must remain separate because both stacks use
  the `main` task queue with different workflow registrations.

The Temporal service account `screenshot-studio-production` has Write access
to these two namespaces. Its deployment API key expires on 2027-10-13; rotate
it in Infisical and redeploy before then. It does not use Rowboat's API key.

The Postiz service organization is `screenshot-studio-production`. Its public
API key is stored in Infisical. Social channels must be connected to this
production organization separately; a healthy backend does not imply a
connected social account. No customer social post is part of deployment checks.

## Secrets and repeatable releases

Infisical is the configuration source: **Desktop App Backend**, project
`04ebc1cf-0ec5-4e9e-8ab9-4c6da4252574`, environment `prod`, path
`/screenshot-studio`. Credentials are component-scoped App Platform secrets
available only at runtime. App Platform holds a snapshot: updating Infisical
alone does not update the running containers.

From the repository root:

```sh
umask 077
mkdir -p .context/digitalocean
doctl --context solomonai-cluster apps get \
  c525b0ba-b92a-4174-ae91-4ab4d7c92fd2 --output json \
  > .context/digitalocean/current-app.json
infisical export --silent --format=json --env=prod \
  --projectId=04ebc1cf-0ec5-4e9e-8ab9-4c6da4252574 \
  --path=/screenshot-studio \
  --output-file=.context/digitalocean/secrets.json
python3 infra/digitalocean/render-spec.py \
  --base .context/digitalocean/current-app.json \
  --secrets .context/digitalocean/secrets.json \
  --output .context/digitalocean/app.json
python3 -m unittest discover -s infra/digitalocean -p 'test_*.py'
# Schema validation echoes secrets; suppress output. The update validates
# against the existing app, which is required for preserved encrypted values.
doctl --context solomonai-cluster apps spec validate \
  .context/digitalocean/app.json --schema-only > /dev/null
doctl --context solomonai-cluster apps update \
  c525b0ba-b92a-4174-ae91-4ab4d7c92fd2 \
  --spec .context/digitalocean/app.json > /dev/null
```

The renderer accepts an app object, a one-element `doctl` JSON array, or a
bare spec. It preserves unrelated components, web settings, domains, and
ingress. It refuses missing credentials, mismatched product database URLs, or
colliding Temporal namespaces. It always renders the backend: the web has no
database and calls the backend at `PUBLISHING_API_URL` with
`PUBLISHING_SERVICE_TOKEN`. Rendering strips any database URL from the web and
replaces `web-migrate` with `platform-migrate`. Generated specs contain
plaintext secrets and must never enter git or logs. Delete local exported
secrets when finished.

## Releases

Every push to `main` deploys what it changed:

1. `Social backend image` runs when the commit changes the backend. It
   records the database restore point in the run summary
   (`infra/digitalocean/backup-database.sh`), then deploys the backend, whose
   `platform-migrate` job applies pending migrations first.
2. `Web image` runs when the commit changes the web. If the same commit also
   changed the backend, it waits for that backend deploy to succeed. It then
   builds the image, refreshes encrypted web credentials and any `STRIPE_*`
   keys from Infisical, and updates web to the commit SHA tag. It refuses an
   app that still has `web-migrate`.

A deploy for a commit that `main` has already moved past is skipped; the
newer commit's run deploys. To redeploy without a new commit, dispatch either
workflow on `main` with `deploy=true`. App Platform does not deploy
uncommitted files.

PlanetScale Postgres backs up production every 12 hours and supports
point-in-time recovery to any moment from the oldest backup (2 days by
default) up to 5 minutes ago. To undo a bad migration, restore the recorded
timestamp to a new branch (Backups > Restore to new branch) and point the
database URLs at it. If Infisical holds `PLANETSCALE_SERVICE_TOKEN_ID`,
`PLANETSCALE_SERVICE_TOKEN` (`read_backups`, `write_backups`),
`PLANETSCALE_ORGANIZATION`, and `PLANETSCALE_DATABASE` (optionally
`PLANETSCALE_BRANCH`, default `main`), the deploy also takes an on-demand
backup kept 14 days, and stops if it fails.

## Migrations and database permissions

`platform-migrate` runs the backend image's `/platform-migrate` with
`MIGRATION_DATABASE_URL` before deployment. It applies the product SQL in
`services/platformmigrations/sql` and the social SQL in
`services/screenshot-studio-backend/migrations` to the same database and
`public` schema. It records migration history and adopts product migrations
Prisma already applied. The `Social backend image` deploy replaces
`web-migrate` with this single job. A migration failure stops the deployment.
Never use `db push` or Ent automatic schema creation in production.

The backend runtime role has CRUD access to application tables, but only
SELECT and INSERT on `audit_log`. The web has no database role. The migration
owner is separate.
Asset bytes stay in private R2, signed by the backend; there is no separate
storage service or database. The [storage guide](tenant-storage.md) covers the
bucket settings and CORS.

The backend deploy records a restore point before applying migrations.
Review each migration's compatibility with the previous app before merging
it. The 2026-10-13 deployment applied the
eight existing migrations from `20260820090000_workspace_administration`
through `20261008120000_launch_intelligence`. The private backup and migration
record are in `.context/digitalocean/` for this workspace. Database rollback is
a separate operation; rolling back an app deployment does not undo migrations.

## Verification and rollback

Wait for `ACTIVE`, then check public web health, session handling, unauthenticated
API rejection, and an authenticated social connection read through the web SDK.
From the web console, check every internal readiness endpoint in the table.
Verify a signed storage upload/download/delete with an isolated deployment
probe, and inspect Temporal worker logs for a completed recovery activity
followed by its timer. Publish only an approved, harmless canary to a dedicated
test destination; record its canonical attempt and remote receipt before
enabling customer traffic.

Use App Platform's previous successful deployment for a code/configuration
recovery. Keep its database compatibility in mind. The Fly deployment is
retired and is not a recovery target.

## Deployment record: 2026-10-13

Deployment `ca5af69e-5fde-432e-bfa5-1bb456a54095` reached `ACTIVE` with all
seven services and both migration jobs. Live checks passed for:

- Web health, authenticated sessions, and rejection of anonymous API requests.
- Two isolated workspace fixtures: own-workspace reads returned 200 and
  cross-workspace requests returned 403. Both fixtures were removed.
- Readiness of all six adjacent services from the web container.
- Signed storage upload and download through the deployed Storage API and R2;
  the probe object was deleted afterward.
- Authenticated Postiz integrations read and anonymous rejection.
- A Temporal recovery activity completing and entering its next timer.

The deployment-spec unit tests, 273 JavaScript tests, lint, focused Go tests,
and a non-root Go backend container build/readiness check passed. These checks
do not establish successful social publishing: no channels were connected or
customer posts sent. The initial deployment did not activate maintenance; the Go maintenance rollout
is described below.

## Temporal maintenance

The tenant orchestrator inside `screenshot-studio-backend` owns six durable schedules in
`screenshot-studio-publishing.kpisa`, on task queue `platform-maintenance`:

| Schedule ID | Cadence (UTC) | Go handler |
| --- | --- | --- |
| `platform-maintenance-tenant-outbox` | Every minute | Outbox dispatch and deleted-asset cleanup |
| `platform-maintenance-audit-drains` | Every minute | Signed CloudEvents delivery |
| `platform-maintenance-communications` | Every minute | Consented release announcement delivery through Resend |
| `platform-maintenance-workspace-cleanup` | Every minute | Due workspace deletion after its grace period |
| `platform-maintenance-scheduled-posts` | Every minute | Start the existing stable-ID publishing workflows for due posts |
| `platform-maintenance-audit-retention` | Daily at 03:05 | Expired audit deletion, honoring legal holds |

`RUN_MAINTENANCE=true` enables registration and the Go worker. Each schedule
skips overlapping runs and has bounded activity retries. Minute schedules catch
up only five minutes; retention catches up one day. Existing schedules are
updated on restart without clearing an operator's pause. To stop scheduled work,
pause these schedules in Temporal before disabling the worker; disabling a worker
alone leaves scheduled executions queued. The hourly publishing recovery loop
remains a backstop and uses the same post workflow IDs, so it does not start a
second provider delivery path.

These jobs execute entirely in Go. They do not invoke TypeScript, a web endpoint,
or Trigger.dev. The old Trigger task directory, SDK, project configuration,
GitHub deployment workflow, and local development commands have been removed.
The web no longer dispatches the outbox or audit drains; only the operator
endpoint that replays a dead-lettered outbox event remains.

Outbox and drain jobs enforce retry ceilings and recover stale claims. Database
advisory locks serialize each maintenance job across worker replicas. Drain
secrets retain the AES-256-GCM format written by the web; signatures retain the
existing CloudEvents contract. Drain requests reject private network addresses
and redirects. Email uses per-recipient records, stable provider idempotency keys,
and a consent check before each send. Ambiguous provider outcomes are marked
`UNKNOWN_DELIVERY` for review, never automatically resent. Unsubscribe tokens
remain compatible with the web endpoint. Empty eligible audiences complete without
sending. Workspace cleanup preserves the organization tombstone and audit evidence.

The combined service receives `TENANT_AUDIT_RETENTION_DATABASE_URL`; its
supervisor passes that value to the tenant orchestrator as
`AUDIT_RETENTION_DATABASE_URL`. Its dedicated
`screenshot_studio_retention` role has schema usage; SELECT on `organization`,
`audit_retention_policy`, and `audit_drain`; SELECT/INSERT/DELETE on `audit_log`;
and SELECT/INSERT on `audit_outbox` and `audit_drain_delivery`. It cannot read
customer communications. The normal application role still cannot delete audit
logs. Never substitute `MIGRATION_DATABASE_URL` for this restricted role.

Additional orchestrator configuration comes from the existing Infisical folder:
`AUDIT_DRAIN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`,
`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and optional `COMPANY_POSTAL_ADDRESS`.
No new schema migration is required for the maintenance port.

Tests in `services/internal/maintenance` use a disposable, fully migrated
`maintenance_test` database and fake provider transports. CI runs these tests
with the race detector, plus Temporal workflow retry/schedule reconciliation
tests. Crypto fixtures are checked against independently generated Node values.

The combined backend image includes the maintenance code merged in PR #80.
The backend is released with the `Social backend image` GitHub workflow. Its
manual `deploy` input authenticates to Infisical with the repository's scoped
OIDC identity, loads the new backend credentials, proposes the topology, and
updates the app only after validation. It preserves the live web, storage,
renderer, and both migration jobs.

### Production maintenance verification: 2026-10-13

Deployment `665ff091-5d23-465e-8491-fda7115851f6` reached `ACTIVE` with
orchestrator source commit `0330d757f4bf10e2fe854344743453e20d48e2a3`.
All five minute schedules completed automatically at 10:47 UTC. The daily
retention schedule was manually exercised at 10:46:28 UTC and completed too.
The web health endpoint returned 200, and a signed unsubscribe request for a
nonexistent test subscriber returned 204, confirming compatibility with the
running web secret without changing a customer's subscription.

The production preflight found no scheduled announcements, scheduled posts, or
pending workspace deletions. No customer email or social post was sent as a
smoke test. Local retention integration tests also passed using a role with the
same restricted grants as production, including audit-drain receipt creation.
