import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import sharp from 'sharp'
import { captureScreenshot, getScreenshotFailure } from '../lib/screenshot-service'

const input = {
  colorScheme: 'light',
  deviceType: 'desktop',
  forceRefresh: false,
  url: 'https://example.com',
} as const

function blank(): Promise<Buffer> {
  return sharp({ create: { background: '#000', channels: 3, height: 36, width: 64 } })
    .png()
    .toBuffer()
}

function rendered(): Promise<Buffer> {
  const pixels = Buffer.alloc(64 * 36 * 3, 0).map((_, index) => index % 251)
  return sharp(pixels, { raw: { channels: 3, height: 36, width: 64 } })
    .png()
    .toBuffer()
}

/** Serves each capture in turn and records the capture-service requests. */
function stubCaptures(t: TestContext, images: Buffer[]): string[] {
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    if (String(url).includes('screenshot=true')) {
      requests.push(String(url))
      const screenshot = { url: `https://cdn.example.com/${requests.length}.png` }
      return Response.json({ data: { screenshot }, status: 'success' })
    }
    return new Response(new Uint8Array(images.shift()!), {
      headers: { 'content-type': 'image/png' },
    })
  })
  return requests
}

test('a blank capture is retried once after the page settles', async (t) => {
  const page = await rendered()
  const requests = stubCaptures(t, [await blank(), page])
  const capture = await captureScreenshot(input)
  assert.equal(capture.screenshot, page.toString('base64'))
  assert.equal(requests.length, 2)
  assert.doesNotMatch(requests[0]!, /waitForTimeout/)
  assert.match(requests[1]!, /waitForTimeout=4000/)
})

test('a page that stays blank fails as a 502 without caching anything', async (t) => {
  stubCaptures(t, [await blank(), await blank()])
  const error = await captureScreenshot(input).catch((caught: unknown) => caught)
  assert.equal(getScreenshotFailure(error).status, 502)
})

test('a rendered page is captured once', async (t) => {
  const requests = stubCaptures(t, [await rendered()])
  await captureScreenshot(input)
  assert.equal(requests.length, 1)
})
