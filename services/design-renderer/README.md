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

API: `POST /render` with `{ "url": "<app>/render/<id>?token=…" }` returns
`{ "base64", "width", "height" }`. `GET /health` returns `{ "ok": true }`.

Each render page carries its own five-minute, single-design HMAC token, so
the service holds no tenant credentials. Give it about 1 GB of memory per two
concurrent renders.
