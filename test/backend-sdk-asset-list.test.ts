import assert from 'node:assert/strict'
import test from 'node:test'
import { ScreenshotStudioBackendSDK } from '../packages/screenshot-studio-backend-sdk/src'

test('asset filtering, order, and opaque cursor reach the backend together', async () => {
  let request: URL | undefined
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'test-secret',
    {
      organizationId: 'org-1',
      requestId: 'req-1',
      sessionId: 'session-1',
      userId: 'user-1',
    },
    async (url) => {
      request = new URL(String(url))
      return Response.json({ assets: [], nextCursor: null })
    }
  )
  await sdk.listAssets({ limit: 24, type: 'video', sort: 'oldest', cursor: 'v1.a_b-c' })
  assert.equal(request?.pathname, '/v1/assets')
  assert.deepEqual(Object.fromEntries(request!.searchParams), {
    limit: '24',
    cursor: 'v1.a_b-c',
    type: 'video',
    sort: 'oldest',
  })
})
