# DigitalOcean production deployment

Production is `screenshot-studio-production` in DigitalOcean's `nyc` region,
app ID `c525b0ba-b92a-4174-ae91-4ab4d7c92fd2`, at
<https://shots.oppulence.io>. The local `doctl` context is `solomonai-cluster`.

| Component | Source | Readiness | Exposure |
| --- | --- | --- | --- |
| `web` | Existing pinned GHCR image | `/api/health`, port 3000 | `/` |
| `storage` | `supabase/storage-api:v1.37.8` | `/status`, port 5000 | Internal |
| `design-renderer` | `services/design-renderer/Dockerfile` | `/ready`, port 8080 | Internal |
| `screenshot-studio-backend` | Public GHCR image built on GitHub | `/readyz`, port 3003 | `/postiz` on port 3000; prefix stripped |

The web component retains its two replicas and image digest. The single Go
backend container starts the Postiz API and worker plus the tenant publishing
and maintenance orchestrator. Its readiness endpoint checks all three local
HTTP endpoints, including the tenant database and Temporal namespace. The
backend image is built on GitHub and pinned by digest in App Platform.

Storage and renderer use `internal_ports` and have no public ingress rules.
See DigitalOcean's [internal routing documentation](https://docs.digitalocean.com/products/app-platform/how-to/manage-internal-routing/)
and [app spec reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

## Existing managed dependencies

- PlanetScale: the existing application `postgres` and Storage API `storage`
  logical databases. Postiz has its own `screenshot_studio_postiz` logical
  database and login role on the same cluster.
- Upstash: the existing Screenshot Studio Redis instance. Postiz uses that
  instance too; its URL is independently configurable with `POSTIZ_REDIS_URL`.
- R2: the existing tenant bucket and the dedicated private Postiz media bucket.
  No local filesystem is used for durable media.
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
ingress. It refuses missing credentials and colliding Postiz/application
databases or Temporal namespaces. `--stack core` can bootstrap web, storage,
and renderer without backend credentials; it does not remove already deployed
components. Generated specs contain plaintext secrets and must never enter git
or logs. Delete local exported secrets when finished.

For a web release, update the web image digest in the private base spec before
rendering. The pre-deploy web migration job uses that same image. App Platform
service builds use the selected Git branch; the default is `main` and there is
no automatic deployment of an agent's uncommitted files.

## Migrations and database permissions

`web-migrate` runs the image's Prisma CLI with `MIGRATION_DATABASE_URL` before
deployment. `postiz-migrate` runs `/postiz-migrate` against only the Postiz
database. A migration failure stops the deployment. Never use `db push` or Ent
automatic schema creation in production.

The web and publishing runtime role has CRUD access to application tables,
but only SELECT and INSERT on `audit_log`. The migration owner is separate.
The storage connection role must have access to the storage schema and be able
to assume `anon`, `authenticated`, `service_role`, and
`supabase_storage_admin`. The [storage guide](tenant-storage.md) explains
these grants. Storage's Node Postgres URL uses `sslmode=require`, without
the Prisma/pgx-specific `sslrootcert=system` setting.

Before applying pending migrations, take a database backup and review their
compatibility with the previous app. The 2026-10-13 deployment applied the
eight existing migrations from `20260820090000_workspace_administration`
through `20261008120000_launch_intelligence`. The private backup and migration
record are in `.context/digitalocean/` for this workspace. Database rollback is
a separate operation; rolling back an app deployment does not undo migrations.

## Verification and rollback

Wait for `ACTIVE`, then check public web health, session handling, unauthenticated
API rejection, and an authenticated Postiz integrations read. From the web
console, check every internal readiness endpoint in the table. Verify a signed
storage upload/download/delete with an isolated deployment probe, and inspect
Temporal worker logs for a completed recovery activity followed by its timer.
Do not publish a social post as a smoke test.

Use App Platform's previous successful deployment for a code/configuration
rollback. Keep its database compatibility in mind. The old Fly resources were
not removed by this deployment; decommission them separately after confirming
that nothing still depends on them.

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
The web's explicitly invoked outbox/audit-drain administrative endpoints remain
for compatibility; they are not scheduled.

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
manual `deploy` input copies the live encrypted component secrets into the
new service, proposes the topology, and updates the app only after validation.
The workflow preserves the web, storage, renderer, and both migration jobs.

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
