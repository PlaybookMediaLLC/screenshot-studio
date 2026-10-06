# Design renderer

Renders Playbook design documents to PNG with headless Chromium, using the
web app's own `/render/<designId>` page and the editor's export pipeline. The
web app calls it so Chromium never ships in the web image.

| Variable                | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `RENDER_SERVICE_SECRET` | Shared secret (32+ characters); the app sends it as `x-render-secret`       |
| `RENDER_ALLOWED_ORIGIN` | The app origin, e.g. `https://shots.oppulence.io`. Nothing else is rendered |
| `RENDER_CONCURRENCY`    | Pages rendered at once (default 2)                                          |
| `PORT`                  | Listen port (default 8080)                                                  |

In the web app, set `PLATFORM_DESIGN_RENDERER=enabled`,
`PLATFORM_RENDER_SERVICE_URL` to this service, and
`PLATFORM_RENDER_SERVICE_SECRET` to the same secret.

API:

- `POST /render` with `{ "url": "<app>/render/<id>?token=…&format=png&scale=2" }`
  returns `{ "base64", "width", "height", "mediaType" }`. The app chooses the
  format (`png`, `jpeg`, `webp`) and scale (1-3) in the render URL.
- `GET /health`: the process is up. `GET /ready`: Chromium is launched and the
  service is accepting work (it stops being ready while draining).
- `GET /metrics`: Prometheus counters for renders by status, a duration
  histogram, active and queued renders, and browser restarts.

Behaviour:

- **Backpressure.** Renders beyond the concurrency limit queue, and anything
  beyond `RENDER_MAX_QUEUE` gets 503 with `Retry-After`.
- **Resilience.** A Chromium crash or transient failure is retried once on a
  fresh browser. A page that answers non-2xx (bad token, missing design) fails
  immediately.
- **Memory.** Chromium is recycled every `RENDER_RECYCLE_AFTER` renders.
- **Deploys.** On SIGTERM it stops accepting work, finishes what is in flight
  (up to 30s), then exits. Requests carry `x-request-id` through to the logs.

Deploy with the included `fly.toml`. It runs on the private network only:
point the web app at `http://playbook-design-renderer.internal:8080`.

Test: `npm test` (needs `npx playwright install chromium` locally) runs the
service against a fake app with real Chromium.

Each render page carries its own five-minute, single-design HMAC token, so
the service holds no tenant credentials. Give it about 1 GB of memory per two
concurrent renders.
