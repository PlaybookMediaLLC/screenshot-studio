import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BackendSDKError,
  ScreenshotStudioBackendSDK,
} from '../packages/screenshot-studio-backend-sdk/src'

test('campaign studio SDK sends scoped requests to the campaign asset routes', async () => {
  const requests: { body?: unknown; method?: string; path: string }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      const path = new URL(String(input)).pathname
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method,
        path,
      })
      if (path.endsWith('/missing')) {
        return Response.json({ error: 'not found' }, { status: 404 })
      }
      return Response.json({ assetStatus: 'UPLOADED', kind: 'capture-mobile' })
    }
  )

  assert.deepEqual(await sdk.getCampaignAsset('campaign-1', 'asset/1'), {
    assetStatus: 'UPLOADED',
    kind: 'capture-mobile',
  })
  await sdk.linkCampaignAsset('campaign-1', 'asset-1', {
    caption: 'Hero',
    kind: 'design-render',
    planAssetKey: null,
  })
  await sdk.saveCampaignCopy('campaign-1', {
    angles: [{ hook: 'Fast', title: 'Speed' }],
    posts: [{ angleIndex: 0, channel: 'x', copy: 'Ship faster' }],
  })
  await sdk.replaceDesign('design-1', { document: { version: 1 }, variantLabel: 'B' })
  await assert.rejects(
    sdk.getCampaignAsset('campaign-1', 'missing'),
    (error: unknown) => error instanceof BackendSDKError && error.status === 404
  )

  assert.deepEqual(
    requests.map(({ method, path }) => `${method ?? 'GET'} ${path}`),
    [
      'GET /v1/campaigns/campaign-1/assets/asset%2F1',
      'PUT /v1/campaigns/campaign-1/assets/asset-1',
      'POST /v1/campaigns/campaign-1/copy',
      'PUT /v1/designs/design-1',
      'GET /v1/campaigns/campaign-1/assets/missing',
    ]
  )
  assert.deepEqual(requests[1].body, { caption: 'Hero', kind: 'design-render', planAssetKey: null })
  assert.deepEqual(requests[2].body, {
    angles: [{ hook: 'Fast', title: 'Speed' }],
    posts: [{ angleIndex: 0, channel: 'x', copy: 'Ship faster' }],
  })
  assert.deepEqual(requests[3].body, { document: { version: 1 }, variantLabel: 'B' })
})
