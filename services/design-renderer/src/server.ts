// Design render service: renders Playbook design pages with headless Chromium.
//
// The web app keeps Chromium out of its own image and calls this service
// instead. It only opens /render/<id> pages on the configured app origin
// (each carries its own short-lived design token), requires a shared secret,
// and runs the editor's export inside the page, so the image matches what the
// editor's Export button produces.
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
} from 'node:http'
import { chromium, type Browser } from 'playwright-core'
import { RenderQueue, QueueFullError, QueueTimeoutError, DrainingError } from './queue.js'
import {
  environmentSchema,
  renderRequestSchema,
  renderResultSchema,
  renderPath,
  type RenderResult,
} from './schemas.js'

const parsedConfig = environmentSchema.safeParse(process.env)
if (!parsedConfig.success) {
  // Report field names, never environment values (especially the shared secret).
  console.error(
    'Invalid renderer configuration:',
    parsedConfig.error.issues.map((issue) => issue.path.join('.')).join(', ')
  )
  process.exit(1)
}
const config = parsedConfig.data
const queue = new RenderQueue(config.concurrency, config.maxQueue, config.queueTimeoutMs)
const log = (event: string, fields: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ event, ...fields }) + '\n')

// ---------------------------------------------------------------- metrics --

const DURATION_BUCKETS = [0.5, 1, 2, 5, 10, 30, 60]
const metrics = {
  buckets: DURATION_BUCKETS.map(() => 0),
  durationCount: 0,
  durationSum: 0,
  renders: { cancelled: 0, failed: 0, ok: 0, rejected: 0 },
  restarts: 0,
}

function observeDuration(seconds: number) {
  metrics.durationSum += seconds
  metrics.durationCount += 1
  DURATION_BUCKETS.forEach((bucket, index) => {
    if (seconds <= bucket) metrics.buckets[index] = (metrics.buckets[index] ?? 0) + 1
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
    `design_render_active ${queue.active}`,
    '# TYPE design_render_queued gauge',
    `design_render_queued ${queue.queued}`,
    '# TYPE design_render_browser_restarts_total counter',
    `design_render_browser_restarts_total ${metrics.restarts}`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------- browser --

let browserPromise: Promise<Browser> | undefined
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
      timeout: config.timeoutMs,
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

async function retireBrowser(reason: string) {
  const current = browserPromise
  browserPromise = undefined
  rendersOnBrowser = 0
  metrics.restarts += 1
  log('browser.recycled', { reason })
  await current?.then((browser) => browser.close()).catch(() => undefined)
}

// ------------------------------------------------------------------ queue --

class PermanentRenderError extends Error {}
class RenderTimeoutError extends Error {}

/** Stop awaiting shared browser startup or page work when this caller leaves. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// ----------------------------------------------------------------- render --

async function renderOnce(target: URL, signal: AbortSignal): Promise<RenderResult> {
  const browser = await abortable(getBrowser(), signal)
  signal.throwIfAborted()
  const creatingContext = browser.newContext({
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    viewport: { height: 1400, width: 2200 },
  })
  // Context creation may finish after cancellation; never leave it orphaned.
  void creatingContext
    .then((context) => {
      if (signal.aborted) return context.close().catch(() => undefined)
    })
    .catch(() => undefined)
  const context = await abortable(creatingContext, signal)
  try {
    signal.throwIfAborted()
    const work = async () => {
      const page = await context.newPage()
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        return url.protocol === 'data:' ||
          url.protocol === 'blob:' ||
          url.origin === config.appOrigin
          ? route.continue()
          : route.abort()
      })
      const response = await page.goto(target.toString(), { timeout: config.timeoutMs })
      if (!response?.ok())
        throw new PermanentRenderError('Render page returned a non-success status.')
      await page.waitForFunction(
        () => (window as Window & { __designReady?: boolean }).__designReady === true,
        undefined,
        { timeout: config.timeoutMs }
      )
      const result: unknown = await page.evaluate(() => {
        const exportDesign = (window as Window & { __exportDesign?: () => Promise<unknown> })
          .__exportDesign
        if (!exportDesign) throw new Error('The page has no design exporter.')
        return exportDesign()
      })
      const parsed = renderResultSchema.safeParse(result)
      if (!parsed.success) throw new PermanentRenderError('Invalid design export.')
      return parsed.data
    }
    // The signal covers startup, navigation, export, and both retry attempts.
    return await abortable(work(), signal)
  } finally {
    await context.close().catch(() => undefined)
    rendersOnBrowser += 1
  }
}

/** Retry a transient failure in a fresh context. A disconnected browser is replaced
 * by getBrowser; never close a connected browser underneath another render. */
async function render(target: URL, clientSignal: AbortSignal): Promise<RenderResult> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new RenderTimeoutError()), config.timeoutMs)
  const signal = AbortSignal.any([clientSignal, deadline.signal])
  try {
    try {
      return await renderOnce(target, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof PermanentRenderError) throw error
      return await renderOnce(target, signal)
    }
  } finally {
    clearTimeout(timer)
    if (rendersOnBrowser >= config.recycleAfter && queue.active <= 1) await retireBrowser('recycle')
  }
}

// ------------------------------------------------------------------- http --

function authorized(header: string | string[] | undefined) {
  const provided = Buffer.from(String(header ?? ''))
  const expected = Buffer.from(config.secret)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16_384) throw new Error('Request too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {}
) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function handleRender(request: IncomingMessage, response: ServerResponse, requestId: string) {
  if (queue.draining)
    return send(response, 503, { error: 'Shutting down.' }, { 'retry-after': '5' })
  if (!authorized(request.headers['x-render-secret'])) {
    metrics.renders.rejected += 1
    return send(response, 401, { error: 'Unauthorized.' })
  }
  let target: URL
  try {
    target = new URL(renderRequestSchema.parse(await readJson(request)).url)
  } catch {
    metrics.renders.rejected += 1
    return send(response, 400, { error: 'Send { "url": "<app>/render/<id>?token=…" }.' })
  }
  if (target.origin !== config.appOrigin || !renderPath.test(target.pathname)) {
    metrics.renders.rejected += 1
    return send(response, 403, {
      error: 'Only design render pages on the app origin can be rendered.',
    })
  }
  const started = performance.now()
  const client = new AbortController()
  const disconnected = () => {
    if (!response.writableEnded) client.abort(new Error('Client disconnected.'))
  }
  response.on('close', disconnected)
  if (response.destroyed) disconnected()
  try {
    const result = await queue.run(client.signal, () => render(target, client.signal))
    const seconds = (performance.now() - started) / 1_000
    observeDuration(seconds)
    metrics.renders.ok += 1
    log('render.done', { durationMs: Math.round(seconds * 1_000), requestId })
    send(response, 200, result)
  } catch (error) {
    if (client.signal.aborted) {
      metrics.renders.cancelled += 1
      return
    }
    if (error instanceof DrainingError)
      return send(response, 503, { error: 'Shutting down.' }, { 'retry-after': '5' })
    if (error instanceof QueueFullError || error instanceof QueueTimeoutError) {
      metrics.renders.rejected += 1
      const reason = error instanceof QueueTimeoutError ? 'queue-timeout' : 'queue-full'
      log('render.rejected', { reason, requestId })
      return send(
        response,
        503,
        { error: 'Renderer is busy; retry later.' },
        { 'retry-after': '5' }
      )
    }
    metrics.renders.failed += 1
    // Playwright error messages may contain signed render URLs. Log only the class.
    log('render.failed', { reason: error instanceof Error ? error.name : 'unknown', requestId })
    send(response, 502, { error: 'The design could not be rendered.' })
  } finally {
    response.removeListener('close', disconnected)
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const requestId = String(request.headers['x-request-id'] ?? randomUUID())
  response.setHeader('x-request-id', requestId)
  if (request.method === 'GET' && request.url === '/health')
    return send(response, 200, { ok: true })
  if (request.method === 'GET' && request.url === '/ready') {
    const ready =
      !queue.draining &&
      Boolean(
        await getBrowser()
          .then((browser) => browser.isConnected())
          .catch(() => false)
      )
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
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    if (!response.headersSent) send(response, 500, { error: 'Internal server error.' })
    else response.destroy()
  })
})
server.requestTimeout = 15000
server.headersTimeout = 10000

server.listen(config.port, '0.0.0.0', () => {
  log('render.listening', { port: config.port })
  // Warm start: the first render should not pay for launching Chromium.
  getBrowser()
    .then(() => log('browser.ready'))
    .catch(() => log('browser.failed'))
})

/** Stop taking work, finish what is in flight, then close the browser. */
async function shutdown(signal: string) {
  if (queue.draining) return
  log('render.draining', { active: queue.active, queued: queue.queued, signal })
  queue.drain()
  server.close()
  // Enforce the deadline even if Chromium itself hangs while closing.
  const forcedExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forcedExit.unref()
  const deadline = Date.now() + config.shutdownTimeoutMs
  while ((queue.active > 0 || queue.queued > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await browserPromise?.then((browser) => browser.close()).catch(() => undefined)
  log('render.stopped')
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
