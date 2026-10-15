import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright-core'

// Production renders in Cloudflare Browser Rendering over CDP. This drives the
// same code path against a local Chromium with a fake render page.
const cdpPort = 9339
const exported = Buffer.from('rendered-design')
let app: Server
let thirdParty: Server
let thirdPartyRequests = 0
let browser: ChildProcess | undefined
let profile: string
const renderQueries: URLSearchParams[] = []

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    )
  )
}

async function startBrowser(): Promise<void> {
  browser = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
    ],
    { stdio: 'ignore' }
  )
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
      .then((response) => response.ok)
      .catch(() => false)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Chromium did not expose CDP.')
}

async function stopBrowser(): Promise<void> {
  const exited = new Promise((resolve) => browser?.once('exit', resolve))
  browser?.kill('SIGKILL')
  await exited
}

before(async () => {
  profile = mkdtempSync(join(tmpdir(), 'design-renderer-'))
  thirdParty = createServer((_request, response) => {
    thirdPartyRequests++
    response.end()
  })
  const thirdPartyUrl = await listen(thirdParty)
  app = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://app.local')
    renderQueries.push(url.searchParams)
    response.setHeader('content-type', 'text/html')
    response.end(`<!doctype html><script>
      fetch(${JSON.stringify(thirdPartyUrl)}).catch(() => {})
      window.__exportDesign = async () => ({
        base64: ${JSON.stringify(exported.toString('base64'))},
        height: innerHeight,
        width: innerWidth,
      })
      window.__designReady = true
    </script>`)
  })
  process.env.PLATFORM_RENDER_BASE_URL = await listen(app)
  process.env.PLATFORM_RENDER_CDP_URL = `http://127.0.0.1:${cdpPort}`
  process.env.PLATFORM_DESIGN_RENDERER = 'enabled'
  await startBrowser()
})

after(async () => {
  await stopBrowser()
  app.close()
  thirdParty.close()
  rmSync(profile, { force: true, recursive: true })
})

test('renders over CDP, keeps the page on the app origin, and reconnects', async () => {
  const { createDesignRenderer, isDesignRendererReady } = await import('../lib/design/renderer')
  assert.equal(await isDesignRendererReady(), true)

  const renderer = await createDesignRenderer()
  try {
    const first = await renderer.render('design1', 'org1', { format: 'jpeg', scale: 1 })
    assert.deepEqual(first.bytes, exported)
    assert.equal(first.mediaType, 'image/jpeg')
    assert.deepEqual([first.width, first.height], [2200, 1400])
    assert.equal(renderQueries[0]?.get('format'), 'jpeg')
    assert.ok(renderQueries[0]?.get('token'))
    assert.equal(thirdPartyRequests, 0)

    // Cloudflare ends an idle session; the next render opens a new one.
    await stopBrowser()
    await startBrowser()
    const second = await renderer.render('design1', 'org1')
    assert.deepEqual(second.bytes, exported)
    assert.equal(second.mediaType, 'image/png')
  } finally {
    await renderer.close().catch(() => {})
  }
})
