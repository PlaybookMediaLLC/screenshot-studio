/* global Buffer, URL, console, performance, process, setTimeout, window */
// Design render service: renders Playbook design pages with headless Chromium.
//
// The web app keeps Chromium out of its own image and calls this service
// instead. It only opens /render/<id> pages on the configured app origin
// (each carries its own short-lived design token), requires a shared secret,
// and runs the editor's export inside the page, so the image matches what the
// editor's Export button produces.
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const config = {
  appOrigin: process.env.RENDER_ALLOWED_ORIGIN
    ? new URL(process.env.RENDER_ALLOWED_ORIGIN).origin
    : '',
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  concurrency: Number(process.env.RENDER_CONCURRENCY ?? 2),
  maxQueue: Number(process.env.RENDER_MAX_QUEUE ?? 20),
  port: Number(process.env.PORT ?? 8080),
  // Chromium accumulates memory; a fresh browser every N renders bounds it.
  recycleAfter: Number(process.env.RENDER_RECYCLE_AFTER ?? 200),
  secret: process.env.RENDER_SERVICE_SECRET ?? '',
  timeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? 60_000),
}

if (config.secret.length < 32 || !config.appOrigin) {
  console.error('RENDER_SERVICE_SECRET (32+ chars) and RENDER_ALLOWED_ORIGIN are required.')
  process.exit(1)
}

const RENDER_PATH = /^\/(?:[a-z]{2}\/)?render\/[\w-]+$/
const log = (event, fields = {}) => console.info(JSON.stringify({ event, ...fields }))

// ---------------------------------------------------------------- metrics --

const DURATION_BUCKETS = [0.5, 1, 2, 5, 10, 30, 60]
const metrics = {
  buckets: DURATION_BUCKETS.map(() => 0),
  durationCount: 0,
  durationSum: 0,
  renders: { failed: 0, ok: 0, rejected: 0 },
  restarts: 0,
}

function observeDuration(seconds) {
  metrics.durationSum += seconds
  metrics.durationCount += 1
  DURATION_BUCKETS.forEach((bucket, index) => {
    if (seconds <= bucket) metrics.buckets[index] += 1
  })
}

function prometheus() {
  return [
    '# TYPE design_renders_total counter',
    ...Object.entries(metrics.renders).map(
      ([status, count]) => `design_renders_total{status="${status}"} ${count}`
    ),
    '# TYPE design_render_duration_seconds histogram',
    ...DURATION_BUCKETS.map(
      (bucket, index) =>
        `design_render_duration_seconds_bucket{le="${bucket}"} ${metrics.buckets[index]}`
    ),
    `design_render_duration_seconds_bucket{le="+Inf"} ${metrics.durationCount}`,
    `design_render_duration_seconds_sum ${metrics.durationSum.toFixed(3)}`,
    `design_render_duration_seconds_count ${metrics.durationCount}`,
    '# TYPE design_render_active gauge',
    `design_render_active ${active}`,
    '# TYPE design_render_queued gauge',
    `design_render_queued ${waiting.length}`,
    '# TYPE design_render_browser_restarts_total counter',
    `design_render_browser_restarts_total ${metrics.restarts}`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------- browser --

let browserPromise
let rendersOnBrowser = 0

function getBrowser() {
  if (!browserPromise) {
    const launching = chromium.launch({
      executablePath: config.chromiumPath,
      // The service drains on SIGTERM itself; Playwright's own handlers would
      // kill Chromium under renders that are still finishing.
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      headless: true,
    })
    browserPromise = launching
    launching
      .then((browser) =>
        browser.on('disconnected', () => {
          // Only forget this browser; a replacement may already be running.
          if (browserPromise === launching) browserPromise = undefined
        })
      )
      .catch(() => {
        if (browserPromise === launching) browserPromise = undefined
      })
  }
  return browserPromise
}

async function retireBrowser(reason) {
  const current = browserPromise
  browserPromise = undefined
  rendersOnBrowser = 0
  metrics.restarts += 1
  log('browser.recycled', { reason })
  await current?.then((browser) => browser.close()).catch(() => undefined)
}

// ------------------------------------------------------------------ queue --

let active = 0
const waiting = []
let draining = false

class QueueFullError extends Error {}

async function withSlot(work) {
  if (active >= config.concurrency) {
    if (waiting.length >= config.maxQueue) throw new QueueFullError()
    await new Promise((resolve) => waiting.push(resolve))
  }
  active += 1
  try {
    return await work()
  } finally {
    active -= 1
    waiting.shift()?.()
  }
}

// ----------------------------------------------------------------- render --

async function renderOnce(target) {
  const browser = await getBrowser()
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { height: 1400, width: 2200 },
  })
  try {
    const page = await context.newPage()
    // Only the app itself: no analytics or ad scripts in a render.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      return url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === config.appOrigin
        ? route.continue()
        : route.abort()
    })
    const response = await page.goto(target.toString(), { timeout: config.timeoutMs })
    if (!response?.ok()) {
      const error = new Error(`Render page returned ${response?.status() ?? 'no response'}.`)
      error.permanent = true
      throw error
    }
    await page.waitForFunction(() => window.__designReady === true, undefined, {
      timeout: config.timeoutMs,
    })
    return await page.evaluate(() => window.__exportDesign())
  } finally {
    await context.close().catch(() => undefined)
    rendersOnBrowser += 1
  }
}

/** One retry on a fresh browser: a crashed Chromium should cost a retry, not a failure. */
async function render(target) {
  try {
    return await renderOnce(target)
  } catch (error) {
    if (error?.permanent) throw error
    await retireBrowser('render-error')
    return renderOnce(target)
  } finally {
    if (rendersOnBrowser >= config.recycleAfter && active <= 1) await retireBrowser('recycle')
  }
}

// ------------------------------------------------------------------- http --

function authorized(header) {
  const provided = Buffer.from(String(header ?? ''))
  const expected = Buffer.from(config.secret)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16_384) throw new Error('Request too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function handleRender(request, response, requestId) {
  if (draining) return send(response, 503, { error: 'Shutting down.' }, { 'retry-after': '5' })
  if (!authorized(request.headers['x-render-secret'])) {
    metrics.renders.rejected += 1
    return send(response, 401, { error: 'Unauthorized.' })
  }
  let target
  try {
    target = new URL((await readJson(request)).url)
  } catch {
    metrics.renders.rejected += 1
    return send(response, 400, { error: 'Send { "url": "<app>/render/<id>?token=…" }.' })
  }
  if (target.origin !== config.appOrigin || !RENDER_PATH.test(target.pathname)) {
    metrics.renders.rejected += 1
    return send(response, 403, {
      error: 'Only design render pages on the app origin can be rendered.',
    })
  }
  const started = performance.now()
  try {
    const result = await withSlot(() => render(target))
    const seconds = (performance.now() - started) / 1_000
    observeDuration(seconds)
    metrics.renders.ok += 1
    log('render.done', { durationMs: Math.round(seconds * 1_000), requestId })
    send(response, 200, result)
  } catch (error) {
    if (error instanceof QueueFullError) {
      metrics.renders.rejected += 1
      log('render.rejected', { reason: 'queue-full', requestId })
      return send(response, 503, { error: 'The render queue is full.' }, { 'retry-after': '5' })
    }
    metrics.renders.failed += 1
    log('render.failed', { reason: error instanceof Error ? error.message : 'unknown', requestId })
    send(response, 502, { error: 'The design could not be rendered.' })
  }
}

const server = createServer(async (request, response) => {
  const requestId = String(request.headers['x-request-id'] ?? randomUUID())
  response.setHeader('x-request-id', requestId)
  if (request.method === 'GET' && request.url === '/health')
    return send(response, 200, { ok: true })
  if (request.method === 'GET' && request.url === '/ready') {
    const ready = !draining && Boolean(await browserPromise?.catch(() => null))
    return send(response, ready ? 200 : 503, { ready })
  }
  if (request.method === 'GET' && request.url === '/metrics') {
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
    return response.end(prometheus())
  }
  if (request.method === 'POST' && request.url === '/render') {
    return handleRender(request, response, requestId)
  }
  send(response, 404, { error: 'Not found.' })
})

server.listen(config.port, () => {
  log('render.listening', { port: config.port })
  // Warm start: the first render should not pay for launching Chromium.
  getBrowser()
    .then(() => log('browser.ready'))
    .catch((error) => log('browser.failed', { reason: error.message }))
})

/** Stop taking work, finish what is in flight, then close the browser. */
async function shutdown(signal) {
  if (draining) return
  draining = true
  log('render.draining', { active, queued: waiting.length, signal })
  server.close()
  const deadline = Date.now() + 30_000
  while ((active > 0 || waiting.length > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await browserPromise?.then((browser) => browser.close()).catch(() => undefined)
  log('render.stopped')
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
