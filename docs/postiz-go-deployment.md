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
Local file storage is ephemeral and is intended for API and workflow testing;
it does not provide media URLs reachable by the Go worker in a real social
network post. For the live LinkedIn image smoke test, we kept the separate R2
bucket private and passed a one-hour presigned object URL in the post's media
path. The worker fetched it and uploaded the image to LinkedIn. Generate the
URL close to publication time; scheduled posts need a durable delivery path.

## Fly production configuration

The two Fly configs live at `services/screenshot-studio-backend/backend/fly.toml` and
`services/screenshot-studio-backend/orchestrator/fly.toml`. They define private Fly services, so
the web app can reach the API over Fly's private network without exposing its
administrative routes to the internet. The web app handles the personal LinkedIn
OAuth callback at `/integrations/social/linkedin` and forwards it to the private
Go API using `POSTIZ_API_URL`. Other providers still need their callback UI and
self-service connection flow before customers can connect them.

Provision before deployment:

1. A dedicated PostgreSQL database for Postiz, with a role allowed to create
   and alter its schema. Do not point either service at the web app's
   `DATABASE_URL`.
2. A dedicated Redis instance and Temporal namespace. The Go workers use the
   `main` task queue; sharing a namespace with Screenshot Studio's publishing
   workers would dispatch workflows to the wrong implementation.
3. A separate Cloudflare R2 bucket and Postiz storage credentials for media
   posts. Do not reuse Screenshot Studio's private tenant asset bucket. With a
   private bucket, the current uploader's bare object URLs are not fetchable by
   the worker. Supply a short-lived presigned URL at publication time or add a
   durable media delivery service before enabling scheduled media posts.
4. Postiz organization API keys and social integrations in that database. An
   empty database has no connected social destinations.

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
`CLOUDFLARE_BUCKETNAME`, and `CLOUDFLARE_BUCKET_URL` as Fly secrets for the
appropriate app. Set `TEMPORAL_TLS=true` and `TEMPORAL_API_KEY` when using
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
`http://screenshot-studio-backend.internal:3000/public/v1` and its
`POSTIZ_API_KEY` to the corresponding organization key only after that check.

If replacing TypeScript Postiz workers, drain their workflows before moving
the `main` queue. Go workers cannot replay TypeScript workflow histories.
Deploying into a fresh Temporal namespace avoids that collision but does not
migrate in-flight workflows. For rollback, restore the previous API and worker
images together; database migrations are forward-only, so review their
backward compatibility before deployment.
