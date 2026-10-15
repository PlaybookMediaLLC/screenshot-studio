# Screenshot Studio Go social backend

The combined `screenshot-studio-backend` image contains the product API,
canonical publishing worker, social OAuth/API adapter, and provider workers.
The customer web app uses the published `screenshot-studio-backend-sdk` through
`lib/backend/sdk.ts`. It does not hold a PostgreSQL URL, social API key, or R2
signing credentials.

One PostgreSQL database and its `public` schema hold auth, product, scheduling,
and social integration tables. `/platform-migrate` is the only deployment
migration command. `scheduled_post` and `publication_attempt` are the customer
publication state; the worker calls LinkedIn, X, and Instagram adapters and
stores the confirmed remote receipt there. The legacy social `Post` table is
not written by the customer scheduling path.

## Local Compose

Run `./bin/studio up` for the web, product API and worker, PostgreSQL, Redis,
Temporal, and private RustFS. To add the social OAuth/API service and its own
Redis and Temporal execution namespace, use:

```sh
make postiz-go-up
curl --fail http://localhost:3100/
curl --fail http://localhost:3102/health/status
make postiz-go-down
```

The optional service is named `screenshot-studio-backend` in Compose and uses
the same `screenshot_studio` database. Its separate Temporal namespace avoids
workflow name collisions; it does not create another product database. The
local `.local/postiz-go.env` overlay is ignored and loaded only for the
optional service. The web receives no values from that overlay.

The operator binding maps a product workspace to the social organization's
integration records and a backend-held API key reference. Create the social
organization and key through the Go social API, store the key in ignored
`.local/dev.env`, and run:

```sh
npx tsx scripts/bind-postiz-tenant.ts <workspace-id> <key-variable-name>
```

This binding is temporary cutover compatibility. The customer worker uses
the canonical workspace ID and checks the mapped social organization before
accepting a destination; a missing or wrong binding blocks the action.
Retiring the binding and the social identity tables is still tracked in
[the cutover plan](plans/backend-owned-data-cutover.md).

Use `./bin/social-gate` for a full isolated test stack with a fake social API.
It does not access connected personal accounts. The
[verification record](social-publishing-verification.md) lists its assertions
and the live canaries still required.

## Provider credentials and callbacks

Provider application secrets belong to the Go social component, never the
web. In the local overlay, use `POSTIZ_GO_X_API_KEY`,
`POSTIZ_GO_X_API_SECRET`, `POSTIZ_GO_FACEBOOK_APP_ID`,
`POSTIZ_GO_FACEBOOK_APP_SECRET`, `POSTIZ_GO_INSTAGRAM_APP_ID`, and
`POSTIZ_GO_INSTAGRAM_APP_SECRET` as applicable. Compose maps them to the Go
process variables. LinkedIn uses `LINKEDIN_CLIENT_ID` and
`LINKEDIN_CLIENT_SECRET`. Do not commit the overlay or tokens.

The web's authenticated routes start OAuth at
`/integrations/social/<provider>/start` and receive callbacks at
`/integrations/social/<provider>`. They call the product backend through the
SDK. The backend binds one-use state to the workspace and session, exchanges
the code through the social service, verifies the destination, and registers
one canonical channel connection. The supported callback names are `x`,
`linkedin`, `instagram`, and `instagram-standalone`. Facebook Login's
Instagram flow includes Page selection.

Register each exact HTTPS callback URL with its provider for live tests.
Instagram Login rejects an HTTP callback; a local canary needs a temporary
HTTPS tunnel to the web app, a matching `POSTIZ_GO_FRONTEND_URL`, and that
origin in `BETTER_AUTH_TRUSTED_ORIGINS`. Sign in on the tunnel hostname so the
callback receives its own session cookie. The normal Connect action requires
two-factor authentication. Avoid putting any provider token in the browser or
the web container.

Private product media stays in R2. The canonical asset row holds a stable
object key; the worker signs it when publishing and again for a retry. Do not
make the bucket public. TikTok photo publishing remains unavailable until its
verified media URL requirement has a separate design and live test.

## Production release

The [DigitalOcean guide](digitalocean-deployment.md) describes the App
Platform renderer and release commands. The intended order is database backup,
`/platform-migrate`, combined backend image and readiness checks, then the
web image pinned to the published npm SDK. Keep the old data stores read-only
for the rollback window and never run old and new workers for the same
destination at once.

Production must provide one logical PostgreSQL URL to the migration, product,
and social processes; separate least-privilege roles may point to it. Keep
Redis, private R2, and distinct Temporal namespaces as execution
infrastructure. The web needs only `PUBLISHING_API_URL` and
`PUBLISHING_SERVICE_TOKEN` to reach the product backend. Confirm a harmless
test-destination post, remote receipt, and private-media fetch for each
enabled provider before customer traffic.
