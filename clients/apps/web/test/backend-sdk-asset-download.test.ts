import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScreenshotStudioBackendSDK } from '../../../packages/screenshot-studio-backend-sdk/src'

test('asset reads preserve range streams and send grants only in the backend POST body', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    {
      kind: 'service',
      display: 'web',
      organizationId: '',
      requestId: 'asset-download-test',
    },
    async (input, init) => {
      requests.push({ url: new URL(String(input)), init })
      return new Response('private', {
        status: 206,
        headers: { 'content-type': 'image/png', 'content-range': 'bytes 0-6/13' },
      })
    }
  )
  for (const response of [
    await sdk.readAssetResponse('asset-1', 'bytes=0-6'),
    await sdk.readAssetDownload('asset-1', 'opaque-grant', 'bytes=0-6'),
  ]) {
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), 'bytes 0-6/13')
    assert.equal(await response.text(), 'private')
  }
  assert.equal(requests[0].url.pathname, '/v1/assets/asset-1/bytes')
  assert.equal(requests[1].url.pathname, '/v1/internal/assets/asset-1/download')
  assert.equal(requests[1].url.search, '')
  assert.equal(requests[1].init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { token: 'opaque-grant' })
  assert.equal(new Headers(requests[1].init?.headers).get('range'), 'bytes=0-6')
})

test('asset streams preserve unsatisfiable ranges and reject revoked grants', async () => {
  for (const status of [416, 401, 403, 404, 503]) {
    const sdk = new ScreenshotStudioBackendSDK(
      'https://backend.example',
      'service-secret',
      {
        kind: 'service',
        display: 'web',
        organizationId: '',
        requestId: 'asset-range-test',
      },
      async () => new Response(JSON.stringify({ error: 'refused' }), { status })
    )
    if (status === 416) assert.equal((await sdk.readAssetDownload('asset-1', 'grant')).status, 416)
    else await assert.rejects(sdk.readAssetDownload('asset-1', 'grant'), { status })
  }
})
