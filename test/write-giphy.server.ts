import assert from 'node:assert/strict'
import test from 'node:test'
import { searchGiphy, selectedGiphy } from '../lib/content-drafts/giphy'
import type { Transport } from '../lib/launch/safe-fetch'

// Controlled protocol fixtures only: no approved GIPHY credentials or network calls.
test('TF-019: gated search, attribution records, rate limits, and re-resolved GIF source validation', async () => {
  const previous = {
    approval: process.env.PLATFORM_GIPHY_APPROVED_API_AND_STORAGE,
    key: process.env.GIPHY_API_KEY,
  }
  const gif = {
    id: 'local',
    title: 'Local animation',
    url: 'https://giphy.com/gifs/local',
    images: {
      fixed_height: { url: 'https://media.giphy.com/local-preview.gif', width: '20', height: '20' },
      original: { url: 'https://media.giphy.com/local.gif', width: '20', height: '20' },
    },
  }
  let requests = 0
  const request: typeof fetch = async (input) => {
    requests++
    const url = new URL(String(input))
    assert.equal(url.hostname, 'api.giphy.com')
    assert.equal(url.searchParams.get('api_key'), 'unit-test-key')
    return Response.json({ data: url.pathname.endsWith('/search') ? [gif] : gif })
  }
  const media: Transport = async () => ({
    status: 200,
    headers: { 'content-type': 'image/gif' },
    body: (async function* () {
      yield Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    })(),
    destroy() {},
  })
  try {
    delete process.env.PLATFORM_GIPHY_APPROVED_API_AND_STORAGE
    await assert.rejects(searchGiphy('release', { request }), /approved/)
    assert.equal(requests, 0)
    process.env.PLATFORM_GIPHY_APPROVED_API_AND_STORAGE = 'true'
    process.env.GIPHY_API_KEY = 'unit-test-key'
    const results = await searchGiphy('release', { request })
    assert.equal(results[0].sourceUrl, gif.url)
    assert.equal(JSON.stringify(results).includes('unit-test-key'), false)
    const result = await selectedGiphy('local', {
      request,
      media: { resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: media },
    })
    assert.equal(result.body.subarray(0, 6).toString(), 'GIF89a')
    await assert.rejects(
      searchGiphy('release', { request: async () => new Response('', { status: 429 }) }),
      /rate limited/
    )
    await assert.rejects(selectedGiphy('wrong', { request }), /no longer available/)
    gif.images.original.url = 'http://127.0.0.1/private.gif'
    await assert.rejects(selectedGiphy('local', { request }), /supported source/)
  } finally {
    if (previous.approval === undefined) delete process.env.PLATFORM_GIPHY_APPROVED_API_AND_STORAGE
    else process.env.PLATFORM_GIPHY_APPROVED_API_AND_STORAGE = previous.approval
    if (previous.key === undefined) delete process.env.GIPHY_API_KEY
    else process.env.GIPHY_API_KEY = previous.key
  }
})
