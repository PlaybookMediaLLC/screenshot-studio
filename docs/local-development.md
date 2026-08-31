# Local development

Use `make` for all local services. It calls `bin/studio`, which creates
`.local/dev.env` on the first run. This ignored file contains generated local
passwords and connection strings. Do not copy it to another environment.

Run `make help` to list all commands. Use `make logs SERVICE=app` to follow a
specific Compose service, or `make kind-logs COMPONENT=screenshot-studio` for
the application running in Kind.

## Compose

```sh
make up
make status
make logs SERVICE=app
make down
```

The app reloads at `http://localhost:3000`. Postgres is available on port
`54329`, Supabase Storage on `5000`, and the MinIO console on `9004`.

`make down` asks whether to preserve data. Use `make reset` to remove all
Compose volumes without a second prompt.

`make smoke` checks the app, Postgres, Redis, MinIO, Storage, the
Redis-backed screenshot rate limit, and a temporary signed Storage
upload/read/delete operation. It also proves cache invalidation rejects an
unauthenticated request and validates an authenticated request body.

`make tenant-isolation` creates two disposable local users and workspaces. It
proves session and organization API-key requests cannot list another
organization's releases or access its asset by ID. It also proves key revocation
takes effect on the next request. It runs only against localhost; use `make
reset` when you want to remove its local fixtures.

## Onboarding browser test

After `make up`, run the full sign-up and workspace onboarding flow in Chromium:

```sh
npx playwright install chromium # once per machine
make e2e
make e2e-onboarding
make e2e-recovery
```

The browser suite creates unique local users and workspaces. It covers sign-in,
tenant assets, release webhooks, Redis limits, cache lifecycle, workspace
settings, audit controls, identity controls, and secret exposure.
`make e2e-recovery` runs serial failure and recovery checks for Redis, MinIO,
Storage, and Postgres. Use a Kind port-forward with
`E2E_MANAGE_SCREENSHOT_MOCK=false` so the command does not recreate Compose.
See [`e2e/README.md`](../e2e/README.md) to add flows with shared lifecycle hooks.

### Give Docker enough memory

Budget at least 12GB for the Docker VM before running the browser suite; CI
runners have 16GB. The app runs `next dev`, and compiling routes on demand is
memory-hungry enough to exhaust an 8GB VM mid-run. The failure does not look
like memory pressure from the test side: Playwright reports
`page.evaluate: Failed to fetch` or `net::ERR_CONNECTION_REFUSED`, because the
server died rather than answered. Confirm with

```sh
docker inspect screenshot-studio-app-1 --format '{{.State.OOMKilled}}'
```

The containers themselves are small, roughly 300MB in total, so raising Docker
Desktop's memory limit is the fix rather than trimming services.

### Warm routes before timing anything

`bin/studio` requests `/sign-up`, `/sign-in`, `/two-factor`, `/onboarding`,
`/workspace` and `/` before the suite starts. Under `next dev` a route compiles
on its first request, which costs 5-30s, and a browser navigation to an
uncompiled route leaves `page.url()` on the previous page until the server
answers. An unwarmed route is therefore indistinguishable from a redirect that
never happened, which is a slow and confusing thing to debug. Running specs
directly with `npx playwright test` skips that warm-up, so do it by hand:

```sh
for r in /sign-up /sign-in /two-factor /onboarding /workspace /; do
  curl -s -o /dev/null -w "$r %{time_total}s\n" "http://localhost:3000$r"
done
```

Repeated local runs can also trip auth rate limiting, which surfaces as a
sign-up that fails with an empty error element rather than a message. Clearing
Redis between runs rules that out:

```sh
docker exec screenshot-studio-redis-1 redis-cli FLUSHALL
```

The stack contains:

- Screenshot Studio in Next.js development mode with hot reload.
- Postgres and Redis.
- MinIO as the local R2-compatible object store.
- Supabase Storage, PgBouncer, and Imgproxy in front of MinIO.

### Go publishing services

The Postiz publishing backend and orchestrator are an optional Compose profile.
They share the application's Postgres publishing tables through Ent. Start and
verify them with:

```sh
make publishing-up
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8081/healthz
make publishing-test
```

For a service-level acceptance run, point the guarded test command at a fresh,
empty PostgreSQL database. Its name must contain `acceptance` or `test`:

```sh
createdb publishing_acceptance
PUBLISHING_ACCEPTANCE_DATABASE_URL='postgresql://localhost/publishing_acceptance?sslmode=disable' \
  make publishing-acceptance
```

The acceptance run applies the real Prisma migration SQL, starts both compiled
Go services, and verifies their HTTP, Ent, storage, Postiz, and audit boundaries.
It uses a local Postiz protocol endpoint, so it never publishes to a real social
account.

The backend is a server-to-server API and requires the local
`PUBLISHING_SERVICE_TOKEN` for tenant operations. The orchestrator polls durable
scheduled posts and can run beside the existing maintenance dispatcher because
both use an atomic `SCHEDULED` to `PROCESSING` claim. Configure a Postiz key only
when testing an actual publication.

Supabase Storage is private. The server-only storage client creates object keys
under `org/<organization-id>/<classification>/<asset-id>/<revision>/`. Local setup also generates
Better Auth and audit secrets. Do not copy `.local/dev.env` to another
environment.

Cache cleanup and invalidation use the generated `CLEANUP_SECRET` in the
`x-screenshot-studio-maintenance-secret` request header. It is server-only;
never send it from the browser.

## Quality checks

Run `make check` before you commit. It checks format, lint, TypeScript, unit
tests, file size, function size, complexity, nesting, and parameter count for
the server boundary. `npm install` installs the same check as the Git
pre-commit hook.

## Trigger.dev Cloud development

Trigger.dev Cloud remains the workflow service. The local Compose profile runs
only the hot-reload Trigger.dev development worker.

```sh
make trigger-login
make trigger-config PROJECT_REF=proj_your_project_ref
make trigger-dev
```

The Trigger.dev account and project reference are the only values the local CLI
cannot generate. It does not self-host Trigger.dev.

Trigger.dev also dispatches pending SIEM audit-drain events every minute and
purges expired audit records daily. See [authentication and enterprise
access](authentication.md) for production-only credentials and database-role
requirements.

## Production task deployment

The `Deploy Trigger.dev` workflow deploys task code after every merge to
`main`. Configure the GitHub `production` environment with the
`TRIGGER_ACCESS_TOKEN` secret and `TRIGGER_PROJECT_REF` variable. Keep runtime
secrets in the Trigger.dev production environment, not in GitHub Actions.

## Kind

```sh
make kind-up
kubectl --namespace screenshot-studio port-forward service/screenshot-studio 3000:80
curl --fail http://127.0.0.1:3000/api/health
make kind-down
```

`kind-up` builds the production image, loads it into the `screenshot-studio-dev`
Kind cluster, generates a Kubernetes Secret from the local values, and installs
the Helm chart with local Postgres, Redis, MinIO, Storage, PgBouncer, and
Imgproxy enabled. Kind is a production-like image test, not a hot-reload loop.
Its migration job uses `prisma db push` because the local database retains the
legacy screenshot-cache table. Production uses the reviewed Prisma migration
path in RFC 002.

## Production storage

The Storage service uses an S3-compatible backend. Local development sets it to
MinIO. Production should set the same S3 settings to private Cloudflare R2
credentials and endpoint. The application remains responsible for tenant checks
and issuing short-lived upload URLs. Local Storage has no browser CORS gateway,
so `STORAGE_PROXY_URL` sends signed transfers through the authenticated Next.js
route. In production, keep that route or configure the public Storage gateway
with equivalent CORS rules.
