# Screenshot Studio social backend

The Go social API and Temporal workers run in `screenshot-studio-backend`
when `RUN_WORKER=true`. The tenant publishing API and worker are also in the
combined image. Their Ent models use one PostgreSQL database and its `public`
schema. The Next.js server uses the typed backend SDK for publishing when the
Ent publishing flag is enabled. The legacy web and social publish paths remain
available during the cutover; do not enable both schedulers for one destination.

The worker is disabled by default. During the App Platform cutover, deploy the
combined backend image with `RUN_WORKER=true`, verify both `/` and
`/health/status` on ports 3000 and 3002, then remove the old standalone
Postiz orchestrator component. Keep one backend instance until its worker
queue and memory use have been checked at production load; additional API
instances also start additional workers. The backend process exits if the
embedded worker fails, so App Platform restarts the unit as a whole.

## Optional local stack

Start the API, workers, the shared product PostgreSQL container, Redis, and
Temporal with:

```sh
make postiz-go-up
curl --fail http://localhost:3100/
curl --fail http://localhost:3102/health/status
make postiz-go-down
```

The one-shot `postiz-go-migrate` service applies the social tables to the
same `screenshot_studio` database and `public` schema before the social API or
workers start. Its migration is repeatable. The
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
reference before a destination can be registered. Once the shared database is
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

The tenant orchestrator's direct adapter path is opt-in through
`PUBLISHING_DIRECT_PROVIDER=true`. It reads social integrations from the same
PostgreSQL database as `scheduled_post`, stages media through the social upload
API, signs that private R2 media immediately before calling a LinkedIn, X, or
Instagram Login adapter, and records the remote receipt only in the canonical
publication attempt. Keep this flag off until the shared schema, OAuth
reconnection, and provider canaries have passed in the target environment.

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

## App Platform production configuration

Run the backend as one private App Platform service. The web app reaches it over
App Platform's private network without exposing its
administrative routes to the internet. The web app handles LinkedIn, X, and
Instagram callbacks under `/integrations/social/` and forwards them to the
private Go API using `POSTIZ_API_URL`. X and Instagram start at
`/integrations/social/<provider>/start` after an operator has bound that web
organization to its Go organization. Their live connection and publishing paths
still need provider credentials and canary evidence before customer use.

Provision before deployment:

1. A dedicated PostgreSQL database for Postiz, with a role allowed to create
   and alter its schema. Do not point the backend at the web app's
   `DATABASE_URL`.
2. A dedicated Redis instance and Temporal namespace. The Go workers use the
   `main` task queue; sharing a namespace with Screenshot Studio's publishing
   workers would dispatch workflows to the wrong implementation.
3. A separate private Cloudflare R2 bucket and Postiz storage credentials for
   the combined API and worker. Do not reuse Screenshot Studio's tenant asset bucket.
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

For X, register `/integrations/social/x` on the web host as an OAuth 1.0a
callback and grant Read and write access. The Go process reads `X_API_KEY` and
`X_API_SECRET`. For Instagram with Facebook Login, it reads `FACEBOOK_APP_ID`
and `FACEBOOK_APP_SECRET`; for Instagram Login, it reads `INSTAGRAM_APP_ID` and
`INSTAGRAM_APP_SECRET`. In the optional local Compose stack, set these in the
ignored `.local/postiz-go.env` overlay with a `POSTIZ_GO_` prefix (for example,
`POSTIZ_GO_X_API_KEY` and `POSTIZ_GO_INSTAGRAM_APP_SECRET`). Compose maps them
to the Go process names, and `make postiz-go-up` reads the overlay only for the
Go services. Use the same `POSTIZ_GO_` source names for X, Facebook, and
Instagram in the production secret store; the DigitalOcean spec renderer and
cutover map them to the Go process names. Existing LinkedIn production keys
remain `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. Never commit the
credentials.
Instagram Login requires a direct HTTPS `FRONTEND_URL`; the Go adapter rejects
HTTP instead of sending authorization codes through a redirect service. For a
local canary, point a temporary HTTPS tunnel at the web app. Set
`POSTIZ_GO_FRONTEND_URL` to the tunnel origin in `.local/postiz-go.env`. In
`.local/dev.env`, set `NEXT_PUBLIC_APP_URL` to the tunnel origin, include it in
`BETTER_AUTH_TRUSTED_ORIGINS`, and set
`BETTER_AUTH_URL` to it if that variable is in use. Set
`PLATFORM_ALLOWED_DEV_ORIGINS` to the tunnel hostname without a scheme or port,
so Next.js serves the local app through the tunnel. Recreate the web app and Go
backend, then register the exact tunnel
`/integrations/social/instagram-standalone` callback in Meta. Visit the tunnel
origin, sign in there, and start OAuth there with two-factor authentication
enabled: a `localhost` session cookie does not authenticate a callback on the
tunnel hostname. After the canary, restore
the local web origins, recreate the services, and stop the tunnel.

Set `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`,
`JWT_SECRET`, `FRONTEND_URL`, `MAIN_URL`, `NEXT_PUBLIC_BACKEND_URL`,
`BACKEND_INTERNAL_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`,
`CLOUDFLARE_SECRET_ACCESS_KEY`, `CLOUDFLARE_REGION`,
`CLOUDFLARE_BUCKETNAME`, and `CLOUDFLARE_BUCKET_URL` as encrypted App Platform
environment variables on the backend. Set `POSTIZ_PRIVATE_MEDIA=true` and
`RUN_WORKER=true`. Set
`TEMPORAL_TLS=true` and `TEMPORAL_API_KEY` when using
Temporal Cloud. Keep the Postiz and web app secrets separate.

Run `/postiz-migrate` as a pre-deploy job before the combined backend takes
traffic. Keep schema changes compatible with running workers during a rolling
deployment. Confirm the API's `/` check and the worker's `/health/status`
check, then test a Postiz public API read with an organization key. Set the web
app's `POSTIZ_API_URL` to the combined backend's private URL plus `/public/v1`, provision distinct
`POSTIZ_API_KEY_<TENANT>` secrets, and bind each web organization to the matching
Go organization only after that check.

Remove the standalone Postiz orchestrator App Platform component only after the
combined backend is serving worker health checks and processing its Temporal
queues. Remove the old component from the complete live app spec as well so a
later deployment does not recreate it. The publishing backend and publishing
orchestrator are separate tenant scheduling services; deleting them requires
their own usage and workflow-history audit.
