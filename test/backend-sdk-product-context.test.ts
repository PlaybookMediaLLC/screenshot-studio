import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BackendSDKError,
  prohibitedTermMatches,
  ScreenshotStudioBackendSDK,
} from '../packages/screenshot-studio-backend-sdk/src'

test('product context SDK reaches surfaces, captures, the profile, and post edits', async () => {
  const requests: { body?: unknown; method?: string; url: URL }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      const url = new URL(String(input))
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method,
        url,
      })
      if (init?.method === 'PATCH') {
        return Response.json(
          {
            code: 'brand_prohibited_terms',
            error: 'This copy uses terms the brand prohibits: "Acme" (Competitor).',
            matches: [{ matchMode: 'word', reason: 'Competitor', term: 'Acme' }],
          },
          { status: 409 }
        )
      }
      return Response.json({ captures: [], matches: [], productProfile: null })
    }
  )

  await sdk.findSurfacesForFeature({ feature: 'invoice approvals', limit: 3, tags: ['a', 'b'] })
  await sdk.listSurfaceCaptures('surface/1')
  await sdk.recordSurfaceCapture('surface/1', { assetId: 'asset-1', source: 'agent' })
  await sdk.getProductProfile()
  await sdk.upsertProductProfile({ audience: 'Clinics', source: 'automated' })
  await sdk.submitCampaignPosts('campaign-1')
  await sdk.submitCampaignPosts('campaign-1', ['post-1'])
  await sdk.upsertBrandProfile({
    audience: 'Developers',
    preferredStyles: [],
    productDescription: 'Studio',
    prohibitedTerms: ['legacy', { matchMode: 'phrase', reason: 'Off brand', term: 'cheap' }],
    socialHandles: {},
    tone: 'Clear',
  })
  const refused = await sdk
    .updateCampaignPost('campaign-1', 'post-1', { copy: 'Beats Acme', expectedCopy: 'Old' })
    .catch((error: unknown) => error)
  assert.ok(refused instanceof BackendSDKError && refused.status === 409)
  assert.deepEqual(prohibitedTermMatches(refused), [
    { matchMode: 'word', reason: 'Competitor', term: 'Acme' },
  ])
  assert.equal(prohibitedTermMatches(new BackendSDKError('Conflict', 409)), null)

  assert.deepEqual(
    requests.map(({ method, url }) => `${method} ${url.pathname}`),
    [
      'GET /v1/product-surfaces/match',
      'GET /v1/product-surfaces/surface%2F1/captures',
      'POST /v1/product-surfaces/surface%2F1/captures',
      'GET /v1/product-profile',
      'POST /v1/product-profile',
      'POST /v1/campaigns/campaign-1/posts/submit',
      'POST /v1/campaigns/campaign-1/posts/submit',
      'POST /v1/brand-profile',
      'PATCH /v1/campaigns/campaign-1/posts/post-1',
    ]
  )
  assert.equal(requests[0].url.searchParams.get('feature'), 'invoice approvals')
  assert.deepEqual(requests[0].url.searchParams.getAll('tag'), ['a', 'b'])
  assert.equal(requests[0].url.searchParams.get('limit'), '3')
  assert.deepEqual(requests[2].body, { assetId: 'asset-1', source: 'agent' })
  assert.deepEqual(requests[5].body, {})
  assert.deepEqual(requests[6].body, { postIds: ['post-1'] })
  assert.deepEqual(requests[8].body, { copy: 'Beats Acme', expectedCopy: 'Old' })
})
