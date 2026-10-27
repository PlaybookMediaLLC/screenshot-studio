import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScreenshotStudioBackendSDK } from '../../../packages/screenshot-studio-backend-sdk/src'

type Recorded = { body?: unknown; headers: Headers; method?: string; url: URL }

function recordingSDK(scope: ConstructorParameters<typeof ScreenshotStudioBackendSDK>[2]) {
  const requests: Recorded[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    scope,
    async (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      requests.push({
        body: init?.body
          ? headers.get('content-type') === 'image/png'
            ? Buffer.from(init.body as ArrayBuffer)
            : JSON.parse(String(init.body))
          : undefined,
        headers,
        method: init?.method,
        url,
      })
      if (url.pathname.endsWith('/query')) return Response.json({ entries: [] })
      if (url.pathname.endsWith('/purge')) return Response.json({ deleted: 0 })
      if (url.pathname.endsWith('/object'))
        return Response.json(init?.method === 'PUT' ? { stored: true } : { base64: 'cG5n' })
      if (url.pathname.endsWith('/bytes')) return new Response(new Uint8Array([1, 2, 3]))
      if (url.pathname === '/v1/assets/lookup') return Response.json({ assets: [] })
      return Response.json({ deleted: true })
    }
  )
  return { requests, sdk }
}

test('screenshot cache SDK calls the service-only cache routes', async () => {
  const { requests, sdk } = recordingSDK({
    display: 'web',
    kind: 'service',
    organizationId: '',
    requestId: 'req-1',
  })
  const hash = 'a'.repeat(64)
  const entry = {
    cloudinaryPublicId: 'screenshots/a.png',
    cloudinaryUrl: 'https://cdn/a',
    url: 'u',
  }

  await sdk.getScreenshotCache(hash)
  await sdk.putScreenshotCache(hash, entry)
  assert.deepEqual(await sdk.getScreenshotCacheObject(hash), { base64: 'cG5n' })
  assert.deepEqual(await sdk.putScreenshotCacheObject(hash, new Uint8Array([1, 2, 3])), {
    stored: true,
  })
  await sdk.deleteScreenshotCache(hash)
  assert.deepEqual(await sdk.listScreenshotCache({ urls: ['u'] }), { entries: [] })
  await sdk.purgeScreenshotCache({ createdBefore: '2026-01-01T00:00:00.000Z' })

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url.pathname}`),
    [
      `GET /v1/internal/screenshot-cache/${hash}`,
      `PUT /v1/internal/screenshot-cache/${hash}`,
      `GET /v1/internal/screenshot-cache/${hash}/object`,
      `PUT /v1/internal/screenshot-cache/${hash}/object`,
      `DELETE /v1/internal/screenshot-cache/${hash}`,
      'POST /v1/internal/screenshot-cache/query',
      'POST /v1/internal/screenshot-cache/purge',
    ]
  )
  assert.deepEqual(requests[1].body, entry)
  assert.deepEqual(requests[3].body, Buffer.from([1, 2, 3]))
  assert.deepEqual(requests[5].body, { urls: ['u'] })
  assert.deepEqual(requests[6].body, { createdBefore: '2026-01-01T00:00:00.000Z' })
  assert.equal(requests[3].headers.get('content-type'), 'image/png')
  assert.equal(requests[0].headers.get('authorization'), 'Bearer service-secret')
  assert.equal(requests[0].headers.get('x-principal-kind'), 'service')
})

test('render SDK reads workspace assets and design renders for the principal', async () => {
  const { requests, sdk } = recordingSDK({
    display: 'design-1',
    kind: 'service',
    organizationId: 'org-1',
    requestId: 'req-1',
  })

  await sdk.findAssets({ ids: ['a-1', 'a-2'] })
  await sdk.findAssets({ objectKey: 'org/org-1/input/a-1/1/image.png' })
  await sdk.findDesignRender('b'.repeat(64))
  assert.deepEqual(await sdk.readAsset('a-1'), new Uint8Array([1, 2, 3]))

  assert.deepEqual(requests[0].url.searchParams.getAll('id'), ['a-1', 'a-2'])
  assert.equal(requests[1].url.searchParams.get('objectKey'), 'org/org-1/input/a-1/1/image.png')
  assert.equal(requests[2].url.pathname, `/v1/design-renders/${'b'.repeat(64)}`)
  assert.equal(requests[3].url.pathname, '/v1/assets/a-1/bytes')
  assert.ok(requests.every((request) => request.headers.get('x-organization-id') === 'org-1'))
})
