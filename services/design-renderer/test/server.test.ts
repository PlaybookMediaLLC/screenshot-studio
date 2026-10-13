// Runs the render service against a fake app with real Chromium.
// `npm test` in services/design-renderer (run `npm run browsers:install` first).
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'

const SECRET = 'test-secret-0123456789-abcdefghij'
let service: string
let app: ReturnType<typeof createServer>
let appOrigin: string
let child: ChildProcess
let output = ''
let externalRequests = 0
let external: ReturnType<typeof createServer>

const page = (script: string) =>
  `<!doctype html><html><body><script>${script}</script></body></html>`

before(async () => {
  external = createServer((_, response) => {
    externalRequests += 1
    response.end('external')
  })
  await new Promise<void>((resolve) => external.listen(0, '127.0.0.1', resolve))
  const externalOrigin = `http://127.0.0.1:${(external.address() as AddressInfo).port}`
  app = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x')
    const path = url.pathname
    if (path === '/render/isolation') {
      const user = JSON.stringify(url.searchParams.get('user'))
      response.end(
        page(`
        const previous = { cookie: document.cookie, storage: localStorage.getItem('user') };
        document.cookie = 'user=' + ${user}; localStorage.setItem('user', ${user});
        window.__designReady = true;
        window.__exportDesign = async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { base64: btoa(JSON.stringify({ previous, user: localStorage.getItem('user') })), width: 1, height: 1 };
        };
      `)
      )
      return
    }
    if (path === '/render/ok' || path === '/en/render/ok') {
      response.end(
        page(
          `window.__exportDesign = async () => ({ base64: 'aGk=', width: 2, height: 1, mediaType: 'image/png' }); window.__designReady = true`
        )
      )
    } else if (path === '/render/slow') {
      response.end(
        page(
          `window.__exportDesign = async () => ({ base64: 'aGk=', width: 2, height: 1, mediaType: 'image/png' }); setTimeout(() => { window.__designReady = true }, 500)`
        )
      )
    } else if (path === '/render/hang') {
      response.end(
        page(`window.__designReady = true; window.__exportDesign = () => new Promise(() => {})`)
      )
    } else if (path === '/render/invalid') {
      response.end(
        page(
          `window.__designReady = true; window.__exportDesign = () => ({base64: 'not base64', width: -1, height: 1})`
        )
      )
    } else if (path === '/render/throw') {
      response.end(
        page(
          `window.__designReady = true; window.__exportDesign = () => { throw new Error('bad export') }`
        )
      )
    } else if (path === '/render/slow-failure') {
      response.end(
        page(`window.__designReady = true; window.__exportDesign = async () => {
        await new Promise(resolve => setTimeout(resolve, 1250)); throw new Error('retry');
      }`)
      )
    } else if (path === '/render/external') {
      response.end(
        page(`window.__designReady = true; window.__exportDesign = async () => {
        await fetch('${externalOrigin}/secret').catch(() => {});
        return {base64: 'aGk=', width: 2, height: 1};
      }`)
      )
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
  appOrigin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
  const reservation = createServer()
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as AddressInfo).port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  service = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [new URL('../dist/server.js', import.meta.url).pathname], {
    env: {
      ...process.env,
      PORT: String(port),
      RENDER_ALLOWED_ORIGIN: appOrigin,
      RENDER_CONCURRENCY: '2',
      RENDER_MAX_QUEUE: '1',
      RENDER_QUEUE_TIMEOUT_MS: '1000',
      RENDER_SERVICE_SECRET: SECRET,
      RENDER_TIMEOUT_MS: '2000',
      RENDER_RECYCLE_AFTER: '5',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await fetch(`${service}/ready`)
      .then((r) => r.ok)
      .catch(() => false)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`The render service did not become ready. ${output}`)
})

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  app?.closeAllConnections()
  app?.close()
  external?.close()
})

const render = (url: string, secret = SECRET, signal?: AbortSignal) =>
  fetch(`${service}/render`, {
    signal,
    body: JSON.stringify({ url }),
    headers: { 'content-type': 'application/json', 'x-render-secret': secret },
    method: 'POST',
  })

test('renders an app render page and returns the export', async () => {
  const response = await render(`${appOrigin}/render/ok?token=t`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    base64: 'aGk=',
    height: 1,
    width: 2,
    mediaType: 'image/png',
  })
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

test('validates request bodies with Zod', async () => {
  for (const body of [
    'null',
    '[]',
    '{}',
    '{"url":1}',
    '{',
    JSON.stringify({ url: 'file:///render/ok' }),
    JSON.stringify({ url: `${appOrigin}/render/ok`, extra: true }),
    JSON.stringify({ url: 'x'.repeat(20000) }),
  ]) {
    const response = await fetch(`${service}/render`, {
      method: 'POST',
      body,
      headers: { 'x-render-secret': SECRET },
    })
    assert.equal(response.status, 400, body.slice(0, 50))
  }
})

test('supports localized pages and blocks external network requests', async () => {
  assert.equal((await render(`${appOrigin}/en/render/ok`)).status, 200)
  assert.equal((await render(`${appOrigin}/render/external`)).status, 200)
  assert.equal(externalRequests, 0)
})

test('rejects malformed exports and bounds hung exports without leaking slots', async () => {
  assert.equal((await render(`${appOrigin}/render/invalid`)).status, 502)
  const started = Date.now()
  assert.equal((await render(`${appOrigin}/render/hang`)).status, 502)
  assert.ok(Date.now() - started < 6000)
  assert.equal((await render(`${appOrigin}/render/ok`)).status, 200)
})

test('a retry does not interrupt another active render', async () => {
  const [slow, failed] = await Promise.all([
    render(`${appOrigin}/render/slow`),
    render(`${appOrigin}/render/throw?token=do-not-log-this`),
  ])
  assert.equal(slow.status, 200)
  assert.equal(failed.status, 502)
  assert.ok(!output.includes('do-not-log-this'))
  assert.ok(!output.includes(SECRET))
})

test('retry attempts share one deadline instead of doubling the render timeout', async () => {
  const started = performance.now()
  assert.equal((await render(`${appOrigin}/render/slow-failure`)).status, 502)
  assert.ok(performance.now() - started < 3000)
  assert.equal((await render(`${appOrigin}/render/ok`)).status, 200)
})

test('exposes liveness and readiness after browser recycling', async () => {
  assert.equal((await fetch(`${service}/health`)).status, 200)
  assert.equal((await fetch(`${service}/ready`)).status, 200)
  assert.equal((await fetch(`${service}/unknown`)).status, 404)
  assert.match(output, /browser.recycled/)
})

async function waitForMetric(expected: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const metrics = await (await fetch(`${service}/metrics`)).text()
    if (metrics.includes(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`Did not observe ${expected}`)
}

test('disconnecting queued and active callers frees capacity for other users', async () => {
  const clients = [new AbortController(), new AbortController(), new AbortController()]
  const active = clients
    .slice(0, 2)
    .map((client) => render(`${appOrigin}/render/hang`, SECRET, client.signal).catch(() => null))
  await waitForMetric('design_render_active 2')
  const queued = render(`${appOrigin}/render/ok`, SECRET, clients[2]!.signal).catch(() => null)
  await waitForMetric('design_render_queued 1')
  clients[2]!.abort()
  await queued
  await waitForMetric('design_render_queued 0')
  clients[0]!.abort()
  clients[1]!.abort()
  await Promise.all(active)
  await waitForMetric('design_render_active 0')
  assert.equal((await render(`${appOrigin}/render/ok`)).status, 200)
})

test('requests expire in the queue while busy users keep their active slots', async () => {
  const clients = [new AbortController(), new AbortController()]
  const active = clients.map((client) =>
    render(`${appOrigin}/render/hang`, SECRET, client.signal).catch(() => null)
  )
  try {
    await waitForMetric('design_render_active 2')
    const waiting = await render(`${appOrigin}/render/ok`)
    assert.equal(waiting.status, 503)
    assert.equal(waiting.headers.get('retry-after'), '5')
    assert.match(output, /queue-timeout/)
  } finally {
    clients.forEach((client) => client.abort())
    await Promise.all(active)
    await waitForMetric('design_render_active 0')
  }
})

test('bursts shed excess load and never share cookies or local storage between users', async () => {
  let successes = 0
  let rejected = 0
  for (let wave = 0; wave < 5; wave += 1) {
    await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const user = `user-${wave}-${index}`
        const response = await render(`${appOrigin}/render/isolation?user=${user}`)
        if (response.status === 503) {
          rejected += 1
          assert.equal(response.headers.get('retry-after'), '5')
          return
        }
        assert.equal(response.status, 200)
        const result = (await response.json()) as { base64: string }
        assert.deepEqual(JSON.parse(Buffer.from(result.base64, 'base64').toString()), {
          previous: { cookie: '', storage: null },
          user,
        })
        successes += 1
      })
    )
    await waitForMetric('design_render_active 0')
    await waitForMetric('design_render_queued 0')
  }
  assert.ok(successes >= 10, `${successes} successful renders`)
  assert.ok(rejected > 0)
  assert.equal(successes + rejected, 50)
  assert.equal((await fetch(`${service}/ready`)).status, 200)
})

test('SIGTERM finishes active renders and rejects queued work', async () => {
  const responses = Array.from({ length: 3 }, () => render(`${appOrigin}/render/slow`))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const metrics = await (await fetch(`${service}/metrics`)).text()
    if (metrics.includes('design_render_queued 1')) break
    if (attempt === 99) assert.fail('Requests did not enter the queue')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const statuses = await Promise.all(responses.map(async (response) => (await response).status))
  assert.deepEqual(statuses.sort(), [200, 200, 503])
  const [code] = await exited
  assert.equal(code, 0)
})
