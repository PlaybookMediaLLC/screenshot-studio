# Design renderer

Standalone TypeScript/Node.js service with Zod validation. Headless Chromium
opens the web app's signed `/render/<designId>` page and runs the same export
pipeline as the editor. No Next.js build or tenant credentials are needed in
this container.

## Local development and checks

Requires Node.js 22 or newer. Run from `services/design-renderer`:

```sh
npm ci
npm run browsers:install
npm run typecheck
npm run lint
npm test
npm run build
# Set the required environment variables below first.
npm start
```

`npm run dev` watches TypeScript. `npm test` builds production JavaScript and
runs TypeScript schema and HTTP integration tests against real Chromium and a
local fixture app. CI installs this service's own locked dependencies and the
matching Chromium version. Generated `dist/` is not committed.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `RENDER_ALLOWED_ORIGIN` | required | Exact HTTP(S) app origin, e.g. `https://shots.oppulence.io`; no credentials, path, query or fragment |
| `RENDER_SERVICE_SECRET` | required | Shared secret with at least 32 characters, sent as `x-render-secret` |
| `PORT` | `8080` | Listen port on `0.0.0.0` (1–65535) |
| `RENDER_CONCURRENCY` | `2` | Concurrent render contexts (1–32) |
| `RENDER_MAX_QUEUE` | `20` | Queued requests (0–1000); excess returns 503 with `Retry-After` |
| `RENDER_TIMEOUT_MS` | `60000` | Timeout for each page/export attempt (100–300000 ms); browser launch has the same timeout |
| `RENDER_RECYCLE_AFTER` | `200` | Completed attempts before recycling Chromium when other renders are idle |
| `RENDER_SHUTDOWN_TIMEOUT_MS` | `30000` | Maximum shutdown wait; the platform grace period must be longer |
| `CHROMIUM_PATH` | bundled browser | Optional local Chromium executable override; omit in App Platform |

Invalid configuration exits immediately with the names of invalid fields;
secret values are never included. Requests and page export results are checked
with Zod. Render errors omit signed URLs from logs.

## DigitalOcean App Platform: existing GitHub workflow connection

Use `.github/workflows/design-renderer.yml`. No DigitalOcean GitHub App
installation or local `doctl` login is needed. It uses the same GHCR package,
DigitalOcean Actions secret, app ID, production environment and Infisical OIDC
identity as the existing App Platform deployment workflow.

- Pull requests run TypeScript, lint, schema/deployment tests and real Chromium
  integration tests with no deployment credentials.
- Branch pushes also build Linux AMD64 and publish
  `ghcr.io/playbookmediallc/screenshot-studio:design-renderer-<commit>`.
  The existing public package is reused; web and renderer tags are distinct.
- After merging to `main`, run **Design renderer image and deployment** with
  **deploy = true**. It builds and publishes the selected commit, waits for the
  existing production environment rules, and deploys the immutable image digest.
  Deployment is deliberately manual and limited to `main`, matching the current
  Infisical trust and GitHub production branch restrictions.

Existing repository settings used:

| Setting | Kind |
| --- | --- |
| `DIGITALOCEAN_PRODUCTION_TOKEN` | Actions secret |
| `SCREENSHOT_STUDIO_APP_ID` | Actions variable |
| `SCREENSHOT_STUDIO_INFISICAL_IDENTITY_ID` | Actions variable |
| `SCREENSHOT_STUDIO_INFISICAL_PROJECT_ID` | Actions variable |

The existing Infisical `prod` folder `/screenshot-studio` must contain
`PLATFORM_RENDER_SERVICE_SECRET` (32+ characters). The workflow puts that same
value in the renderer's `RENDER_SERVICE_SECRET` and web service's
`PLATFORM_RENDER_SERVICE_SECRET`, encrypted in App Platform. No secrets are
committed or uploaded as workflow artifacts.

The TypeScript/Zod deployment helper reads the **current** app spec, adds or
updates only the internal `design-renderer` service, and merges the web app's
renderer settings. It preserves other components, web image, domains, jobs and
existing encrypted variables. It shares the existing deployment concurrency
lock and refuses to update an app with an in-progress deployment. It verifies
the new active deployment, renderer digest, unchanged web image and public web
health endpoint.

The renderer uses internal port 8080, readiness `/ready`, liveness `/health`,
and a 35-second platform grace period for its 30-second shutdown deadline.
A new component defaults to one 2 GB instance with two concurrent renders;
existing instance count and size are preserved. The web service uses
`http://design-renderer:8080`. No public renderer route is added.

When merging the separate full-app deployment branch, retain the renderer and
its web environment variables in `.do/screenshot-studio-production.yaml`.
A complete app spec replaces the live topology; applying a web-only spec would
remove the renderer. Use the renderer's published immutable digest (never
`ci-placeholder`, which the web-image workflow replaces with the web digest).
For a coordinated full-stack release, the generated full spec must likewise
use this GHCR digest rather than a Git source for the renderer.

The Dockerfile uses `npm ci`, compiled JavaScript, a non-root runtime user, and
`tini` to forward shutdown signals and reap browser processes. Chromium and
`playwright-core` are pinned to the same version. The existing `fly.toml` is
retained for compatibility. App settings follow the
[DigitalOcean App Spec reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

## Container smoke test

From the repository root:

```sh
docker build --platform linux/amd64 -t playbook-design-renderer services/design-renderer
docker run --rm -p 8080:8080 \
  -e RENDER_ALLOWED_ORIGIN -e RENDER_SERVICE_SECRET playbook-design-renderer
curl --fail http://localhost:8080/ready
```

No `--ipc=host` setting is required: Playwright's default Chromium arguments
include `--disable-dev-shm-usage`. Do not override the launch arguments to remove it
on App Platform, where the Docker shared-memory settings are not configurable.

## API and operations

- `POST /render`, header `x-render-secret`, body `{ "url": "<app>/render/<id>?token=…&format=png&scale=2" }`.
  Returns `{ "base64", "width", "height", "mediaType" }`; `mediaType` may be absent
  for older app pages. Supported types are PNG, JPEG and WebP.
- `GET /health`: process liveness. `GET /ready`: Chromium is connected and the
  service is accepting work; also attempts recovery after a browser crash.
- `GET /metrics`: Prometheus render counters, duration histogram, active and
  queued counts, and browser recycling count. Metrics contain no tenant data.

Only the configured app origin and render paths are accepted. Browser contexts
block external HTTP requests and service workers. The web app must embed design
assets or proxy them through its origin. Non-2xx pages and invalid exports fail
with 502; transient browser errors get one retry in a new context. Export calls
are bounded even when the page never resolves its export promise. Queuing time
is additional to render time; tune the queue to fit the web client's timeout.

SIGTERM stops admission, rejects queued work with 503, and lets active renders
finish up to the shutdown deadline. Redeploy the previous image/commit to roll
back; this service has no database migrations.
