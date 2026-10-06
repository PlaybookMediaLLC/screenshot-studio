/* global Buffer, URL, console, process, window */
// Design render service: renders Playbook design pages with headless Chromium.
//
// The web app keeps Chromium out of its own image and calls this service
// instead. It only opens /render/<id> pages on the configured app origin
// (each carries its own short-lived design token), requires a shared secret,
// and runs the editor's export inside the page, so the PNG matches what the
// editor's Export button produces.
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.PORT ?? 8080)
const SECRET = process.env.RENDER_SERVICE_SECRET ?? ''
const APP_ORIGIN = process.env.RENDER_ALLOWED_ORIGIN
  ? new URL(process.env.RENDER_ALLOWED_ORIGIN).origin
  : ''
const MAX_CONCURRENT = Number(process.env.RENDER_CONCURRENCY ?? 2)
const TIMEOUT_MS = 60_000

if (SECRET.length < 32 || !APP_ORIGIN) {
  console.error('RENDER_SERVICE_SECRET (32+ chars) and RENDER_ALLOWED_ORIGIN are required.')
  process.exit(1)
}

let browserPromise
function getBrowser() {
  browserPromise ??= chromium
    .launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true })
    .then((browser) => {
      browser.on('disconnected', () => {
        browserPromise = undefined
      })
      return browser
    })
  return browserPromise
}

let active = 0
const waiting = []
async function withSlot(work) {
  if (active >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(resolve))
  active += 1
  try {
    return await work()
  } finally {
    active -= 1
    waiting.shift()?.()
  }
}

function authorized(header) {
  const provided = Buffer.from(String(header ?? ''))
  const expected = Buffer.from(SECRET)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

async function render(target) {
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
      return url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === APP_ORIGIN
        ? route.continue()
        : route.abort()
    })
    const response = await page.goto(target.toString(), { timeout: TIMEOUT_MS })
    if (!response?.ok())
      throw new Error(`Render page returned ${response?.status() ?? 'no response'}.`)
    await page.waitForFunction(() => window.__designReady === true, undefined, {
      timeout: TIMEOUT_MS,
    })
    return await page.evaluate(() => window.__exportDesign())
  } finally {
    await context.close()
  }
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

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health')
    return send(response, 200, { ok: true })
  if (request.method !== 'POST' || request.url !== '/render')
    return send(response, 404, { error: 'Not found.' })
  if (!authorized(request.headers['x-render-secret']))
    return send(response, 401, { error: 'Unauthorized.' })
  let target
  try {
    target = new URL((await readJson(request)).url)
  } catch {
    return send(response, 400, { error: 'Send { "url": "<app>/render/<id>?token=…" }.' })
  }
  if (target.origin !== APP_ORIGIN || !/^\/(?:[a-z]{2}\/)?render\/[\w-]+$/.test(target.pathname)) {
    return send(response, 403, {
      error: 'Only design render pages on the app origin can be rendered.',
    })
  }
  const started = Date.now()
  try {
    const result = await withSlot(() => render(target))
    console.info(
      JSON.stringify({ durationMs: Date.now() - started, event: 'render.done', status: 200 })
    )
    send(response, 200, result)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'render.failed',
        reason: error instanceof Error ? error.message : 'unknown',
      })
    )
    send(response, 502, { error: 'The design could not be rendered.' })
  }
}).listen(PORT, () => console.info(JSON.stringify({ event: 'render.listening', port: PORT })))
