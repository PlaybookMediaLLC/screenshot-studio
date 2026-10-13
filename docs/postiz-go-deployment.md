# Screenshot Studio backend and orchestrator

The Go Postiz port runs as `screenshot-studio-backend` and
`screenshot-studio-orchestrator`. It uses Postiz's database schema and API; it
does not share Screenshot Studio's tenant database. The existing web app remains
the tenant authority and calls the backend through the Postiz public API.

## Optional local stack

Start the API, workers, a dedicated `postiz_go` PostgreSQL container, Redis, and
Temporal with:

```sh
make postiz-go-up
curl --fail http://localhost:3100/
curl --fail http://localhost:3102/health/status
make postiz-go-down
```

The one-shot `postiz-go-migrate` service applies the Postiz schema before the
API or workers start. Its migration is repeatable. The database volume and
credentials are separate from Screenshot Studio's PostgreSQL instance. The
Postiz Temporal server uses ports 7243 and 8243
to avoid competing with the publishing service's `main` task queue.

To connect the web app to this fixture, create a Postiz organization through
the backend's `/auth/register` route and get its `publicApi` key from
`/user/self`. Set these values in the local `.local/dev.env`, then recreate the
`app` service:

```text
POSTIZ_API_URL=http://screenshot-studio-backend:3000/public/v1
POSTIZ_API_KEY=<Postiz organization's publicApi key>
```

The default local values still point at the deterministic E2E Postiz mock.
Each web organization must be bound to its own Go organization and credential
reference before a destination can be registered. Once both databases are
available, run the operator command from the repository root with the web
organization ID and the name of the environment variable containing that Go
organization's public API key:

```sh
npx tsx scripts/bind-postiz-tenant.ts <web-organization-id> POSTIZ_API_KEY
```

The command reads `.local/dev.env`, asks the Go API which organization owns the
key, and stores only the Go organization ID and secret reference in the web
database. It does not print the key. For a host database URL or a different
reachable Go API URL, set `POSTIZ_BIND_DATABASE_URL` and `POSTIZ_BIND_API_URL`
in the operator environment. One Go organization and key reference can bind to
only one web organization. The app verifies that binding and that the selected
destination belongs to it before accepting a channel connection; the worker
checks the Go organization again before uploading media.

Local file storage is ephemeral and is intended for API and workflow testing.
For live media publishing from a private Postiz R2 bucket, set
`POSTIZ_GO_STORAGE_PROVIDER=cloudflare`, `POSTIZ_PRIVATE_MEDIA=true`, and the
`CLOUDFLARE_*` variables in the ignored, mode-0600 `.local/postiz-go.env`.
`make postiz-go-up` reads this optional overlay only for the Postiz services;
the web app does not receive the Postiz R2 token through its `dev.env`. Set
`CLOUDFLARE_BUCKET_URL` to the private path-style S3 URL
`https://<account-id>.r2.cloudflarestorage.com/<bucket-name>`. Do not attach a
public bucket domain. The stored post keeps this stable object URL. When the
scheduled worker actually publishes, it signs its media and thumbnail URLs
for 24 hours, then gives those temporary URLs to the provider. An activity
retry signs again. The web UI does not yet proxy private Postiz media for
pre-publication previews.

## Social provider readiness

The Go port registers X, both Instagram login variants, Facebook, Threads,
TikTok, Pinterest, and other providers. Registration and passing mocked API
tests do not establish that a customer can connect or publish to a live
account. The current local setup has completed live text, image, and scheduled
image publishing only for a personal LinkedIn account. X and Instagram still
need their own developer apps, publishing permissions, OAuth connection flows,
and a harmless live scheduled-media test. The web app implements authenticated
OAuth start, callback, and web destination registration for X and both Instagram
variants, but these flows still require browser and live provider validation.
Do not label other destinations ready
for customers until their connection and live publishing paths are verified.

Private media is signed at publication time for the worker's media fields.
Provider-specific paths need separate review: X article covers and inline
images are signed when uploaded, while Instagram and Threads receive an
encoded temporary URL that their servers fetch. The URL expires after 24
hours; a provider fetch delayed beyond that window will fail. Both Instagram
variants convert PNG attachments to JPEG before handoff. X video sizing uses a
ranged GET because a private R2 URL signed for GET rejects HEAD.
TikTok video uses file upload from the worker, but TikTok photo publishing
requires `PULL_FROM_URL` from a verified domain or URL prefix. The current
private R2 S3 hostname is not configured as a verified TikTok media source, so
photo publishing must remain unadvertised until that path is designed and
tested without exposing the bucket.

## Fly production configuration

The two Fly configs live at `services/screenshot-studio-backend/backend/fly.toml` and
`services/screenshot-studio-backend/orchestrator/fly.toml`. They define private Fly services, so
the web app can reach the API over Fly's private network without exposing its
administrative routes to the internet. The web app handles LinkedIn, X, and
Instagram callbacks under `/integrations/social/` and forwards them to the
private Go API using `POSTIZ_API_URL`. X and Instagram start at
`/integrations/social/<provider>/start` after an operator has bound that web
organization to its Go organization. Their live connection and publishing paths
still need provider credentials and canary evidence before customer use.

Provision before deployment:

1. A dedicated PostgreSQL database for Postiz, with a role allowed to create
   and alter its schema. Do not point either service at the web app's
   `DATABASE_URL`.
2. A dedicated Redis instance and Temporal namespace. The Go workers use the
   `main` task queue; sharing a namespace with Screenshot Studio's publishing
   workers would dispatch workflows to the wrong implementation.
3. A separate private Cloudflare R2 bucket and Postiz storage credentials for
   both API and worker. Do not reuse Screenshot Studio's tenant asset bucket.
   Set `CLOUDFLARE_BUCKET_URL` to the private path-style S3 URL shown above.
   The backend omits public-read ACLs, and the worker signs its own bucket
   objects at publication time. External media URLs are left unchanged.
4. Postiz organization API keys and social integrations in that database. An
   empty database has no connected social destinations. Give each web
   organization its own Go organization and public API key, store that key in a
   distinct `POSTIZ_API_KEY_<TENANT>` secret on the web host, and run
   `scripts/bind-postiz-tenant.ts` for each pairing before enabling channel
   registration or deploying the new web worker. An existing queued post with
   no matching binding fails visibly before upload. Keep the operator's
   database and Go API overrides scoped to that binding command.

For a personal LinkedIn connection, create a LinkedIn developer app associated
with a company page you administer, enable **Sign In with LinkedIn using OpenID
Connect** and **Share on LinkedIn**, and register
`https://<FRONTEND_URL host>/integrations/social/linkedin` as an exact redirect
URL. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` on the Go API. The
personal provider requests only `openid`, `profile`, and `w_member_social`;
LinkedIn Page publishing requires separate Community Management access. Start
the connection with an authenticated `GET /integrations/social/linkedin` on the
Go API, then visit the returned authorization URL. The callback consumes the
one-use state and saves the channel in the Go database.

Set `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`,
`JWT_SECRET`, `FRONTEND_URL`, `MAIN_URL`, `NEXT_PUBLIC_BACKEND_URL`,
`BACKEND_INTERNAL_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`,
`CLOUDFLARE_SECRET_ACCESS_KEY`, `CLOUDFLARE_REGION`,
`CLOUDFLARE_BUCKETNAME`, and `CLOUDFLARE_BUCKET_URL` as Fly secrets for both
apps. `POSTIZ_PRIVATE_MEDIA=true` is set in the Fly configs. Set
`TEMPORAL_TLS=true` and `TEMPORAL_API_KEY` when using
Temporal Cloud. Keep the Postiz and web app secrets separate.

From `services/`, deploy the API first and then the workers:

```sh
flyctl config validate --config screenshot-studio-backend/backend/fly.toml
flyctl config validate --config screenshot-studio-backend/orchestrator/fly.toml
flyctl deploy --config screenshot-studio-backend/backend/fly.toml --app screenshot-studio-backend
flyctl deploy --config screenshot-studio-backend/orchestrator/fly.toml --app screenshot-studio-orchestrator
```

The API's Fly release command runs `/postiz-migrate` before the new API takes
traffic. Keep schema changes compatible with the running workers during a
rolling deployment. Confirm the API's `/` check and the worker's
`/health/status` check in Fly, then test a Postiz public API read with an
organization key. Set the web app's `POSTIZ_API_URL` to
`http://screenshot-studio-backend.internal:3000/public/v1`, provision distinct
`POSTIZ_API_KEY_<TENANT>` secrets, and bind each web organization to the matching
Go organization only after that check.

If replacing TypeScript Postiz workers, drain their workflows before moving
the `main` queue. Go workers cannot replay TypeScript workflow histories.
Deploying into a fresh Temporal namespace avoids that collision but does not
migrate in-flight workflows. For rollback, restore the previous API and worker
images together; database migrations are forward-only, so review their
backward compatibility before deployment.
