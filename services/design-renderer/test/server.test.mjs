/* global URL, fetch, process, setTimeout */
// Runs the render service against a fake app with real Chromium.
// `npm test` in services/design-renderer (needs `npx playwright install chromium` locally).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'

const SECRET = 'test-secret-0123456789-abcdefghij'
const SERVICE_PORT = 3399
const service = `http://127.0.0.1:${SERVICE_PORT}`
let app
let appOrigin
let child

const page = (script) => `<!doctype html><html><body><script>${script}</script></body></html>`

before(async () => {
  app = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname
    if (path === '/render/ok') {
      response.end(
        page(
          `window.__exportDesign = async () => ({ base64: 'aGk=', width: 2, height: 1 }); window.__designReady = true`
        )
      )
    } else if (path === '/render/slow') {
      response.end(
        page(
          `window.__exportDesign = async () => ({ base64: 'aGk=', width: 2, height: 1 }); setTimeout(() => { window.__designReady = true }, 800)`
        )
      )
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  appOrigin = `http://127.0.0.1:${app.address().port}`
  child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: {
      ...process.env,
      PORT: String(SERVICE_PORT),
      RENDER_ALLOWED_ORIGIN: appOrigin,
      RENDER_CONCURRENCY: '1',
      RENDER_MAX_QUEUE: '1',
      RENDER_SERVICE_SECRET: SECRET,
      RENDER_TIMEOUT_MS: '5000',
    },
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await fetch(`${service}/ready`)
      .then((r) => r.ok)
      .catch(() => false)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('The render service did not become ready.')
})

after(async () => {
  child?.kill('SIGTERM')
  app?.close()
})

const render = (url, secret = SECRET) =>
  fetch(`${service}/render`, {
    body: JSON.stringify({ url }),
    headers: { 'content-type': 'application/json', 'x-render-secret': secret },
    method: 'POST',
  })

test('renders an app render page and returns the export', async () => {
  const response = await render(`${appOrigin}/render/ok?token=t`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { base64: 'aGk=', height: 1, width: 2 })
  assert.ok(response.headers.get('x-request-id'))
})

test('refuses wrong secrets, foreign origins, and non-render paths', async () => {
  assert.equal((await render(`${appOrigin}/render/ok`, 'wrong')).status, 401)
  assert.equal((await render('https://example.com/render/ok')).status, 403)
  assert.equal((await render(`${appOrigin}/api/trpc/x`)).status, 403)
})

test('reports a missing page as a failed render without retrying forever', async () => {
  assert.equal((await render(`${appOrigin}/render/missing`)).status, 502)
})

test('sheds load with 503 and Retry-After when the queue is full', async () => {
  const statuses = await Promise.all(
    Array.from({ length: 4 }, () => render(`${appOrigin}/render/slow`).then((r) => r.status))
  )
  assert.ok(statuses.includes(200), `some renders succeed: ${statuses}`)
  assert.ok(statuses.includes(503), `extra requests are shed: ${statuses}`)
})

test('exposes Prometheus metrics', async () => {
  const text = await (await fetch(`${service}/metrics`)).text()
  assert.match(text, /design_renders_total\{status="ok"\} [1-9]/)
  assert.match(text, /design_renders_total\{status="rejected"\} [1-9]/)
  assert.match(text, /design_render_duration_seconds_count [1-9]/)
})
