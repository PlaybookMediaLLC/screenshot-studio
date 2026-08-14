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

The stack contains:

- Screenshot Studio in Next.js development mode with hot reload.
- Postgres and Redis.
- MinIO as the local R2-compatible object store.
- Supabase Storage, PgBouncer, and Imgproxy in front of MinIO.

Supabase Storage is private. The server-only storage client creates object keys
under `tenants/<tenant-id>/assets/<asset-id>/`. Local setup also generates
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

## Production storage

The Storage service uses an S3-compatible backend. Local development sets it to
MinIO. Production should set the same S3 settings to private Cloudflare R2
credentials and endpoint. The application remains responsible for tenant checks
and issuing short-lived upload URLs.
