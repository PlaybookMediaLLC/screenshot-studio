import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BackendSDKError,
  ScreenshotStudioBackendSDK,
} from '../../../packages/screenshot-studio-backend-sdk/src'

test('configuration SDK sends scoped requests to the backend', async () => {
  const requests: { path: string; body?: unknown; headers: Headers; method?: string }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      const path = new URL(String(input)).pathname
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init?.headers),
        method: init?.method,
      })
      if (path.endsWith('/brand-kits')) {
        return Response.json({ brandKits: [] })
      }
      return Response.json({ id: 'profile-1' })
    }
  )

  assert.deepEqual(await sdk.listBrandKits(), { brandKits: [] })
  await sdk.upsertBrandProfile({
    audience: 'Developers',
    preferredStyles: [],
    productDescription: 'A product',
    prohibitedTerms: [],
    socialHandles: {},
    tone: 'Concise',
  })
  await sdk.updateProductSurface('surface-1', { name: 'New name' })
  await sdk.deleteProductSurface('surface-1')
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      '/v1/brand-kits',
      '/v1/brand-profile',
      '/v1/product-surfaces/surface-1',
      '/v1/product-surfaces/surface-1',
    ]
  )
  assert.deepEqual(
    requests.slice(2).map((request) => request.method),
    ['PATCH', 'DELETE']
  )
  assert.equal(requests[0].headers.get('authorization'), 'Bearer service-secret')
  assert.equal(requests[0].headers.get('x-session-id'), 'session-1')
  assert.equal(requests[0].headers.get('x-organization-id'), 'org-1')
  assert.deepEqual(requests[1].body, {
    audience: 'Developers',
    preferredStyles: [],
    productDescription: 'A product',
    prohibitedTerms: [],
    socialHandles: {},
    tone: 'Concise',
  })
})

test('workspace SDK distinguishes session and organization requests', async () => {
  const requests: { body?: unknown; path: string; headers: Headers; method?: string }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      path,
      headers: new Headers(init?.headers),
      method: init?.method,
    })
    return Response.json(
      path.startsWith('/v1/workspace/invitations')
        ? {
            id: 'invite +1',
            organizationId: 'org-2',
            inviterId: 'user-1',
            email: 'test@example.test',
            role: 'viewer',
            status: 'pending',
            createdAt: '2026-10-21T00:00:00Z',
            expiresAt: '2026-10-28T00:00:00Z',
            organization: { name: 'Workspace' },
            user: { name: 'Owner', email: 'owner@example.test' },
          }
        : path === '/v1/workspaces'
          ? { workspaces: [] }
          : { updated: true }
    )
  }
  const sessionScope = {
    organizationId: '',
    requestId: 'req-1',
    sessionId: 'session-1',
    userId: 'user-1',
  }
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'secret',
    sessionScope,
    fetcher
  )
  assert.deepEqual(await sdk.listWorkspaces(), { workspaces: [] })
  await sdk.setActiveWorkspace('org-2')
  assert.deepEqual(
    requests.map(({ path, method }) => [path, method]),
    [
      ['/v1/workspaces', 'GET'],
      ['/v1/workspaces/active', 'POST'],
    ]
  )
  assert.equal(requests[0].headers.get('x-session-id'), 'session-1')
  assert.equal(requests[0].headers.get('x-organization-id'), '')

  const workspaceSDK = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'secret',
    { ...sessionScope, organizationId: 'org-2' },
    fetcher
  )
  await workspaceSDK.inviteWorkspaceMember({ email: 'test@example.test', role: 'viewer' })
  await workspaceSDK.resendWorkspaceInvitation('invite +1')
  await workspaceSDK.revokeWorkspaceInvitation('invite +1')
  await workspaceSDK.requestWorkspaceDeletion('Workspace')
  assert.deepEqual(
    requests.slice(2).map(({ path, method }) => [path, method]),
    [
      ['/v1/workspace/invitations', 'POST'],
      ['/v1/workspace/invitations/invite%20%2B1/resend', 'POST'],
      ['/v1/workspace/invitations/invite%20%2B1', 'DELETE'],
      ['/v1/workspace/deletion', 'POST'],
    ]
  )
  assert.deepEqual(requests[2].body, { email: 'test@example.test', role: 'viewer' })
  assert.equal(requests[2].headers.get('x-organization-id'), 'org-2')
})

test('bootstrap and audit SDK calls preserve scope, filters, and audit context', async () => {
  const requests: { url: URL; headers: Headers }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
      return Response.json({ items: [] })
    }
  )
  await sdk.getBootstrap()
  await sdk.getCurrentUser()
  await sdk.listAuditLogs(
    { limit: 2, outcome: 'FAILED', search: 'release', startDate: new Date('2026-10-14T12:00:00Z') },
    { ipHash: 'hash', userAgentSummary: 'test browser' }
  )
  assert.deepEqual(
    requests.map(({ url }) => url.pathname),
    ['/v1/bootstrap', '/v1/me', '/v1/audit-logs']
  )
  assert.equal(requests[2].url.searchParams.get('startDate'), '2026-10-14T12:00:00.000Z')
  assert.equal(requests[2].url.searchParams.get('outcome'), 'FAILED')
  assert.equal(requests[2].headers.get('x-organization-id'), 'org-1')
  assert.equal(requests[2].headers.get('x-audit-ip-hash'), 'hash')
  assert.equal(requests[2].headers.get('x-audit-user-agent-summary'), 'test browser')
})

test('access and media SDK methods retain scope and surface backend status', async () => {
  const requests: { body?: unknown; method?: string; url: URL }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      const url = new URL(String(input))
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method,
        url,
      })
      if (url.pathname.endsWith('/download-url')) {
        return Response.json({ error: 'Asset not found.' }, { status: 404 })
      }
      if (url.pathname === '/v1/access') {
        return Response.json({ organizationId: 'org-1', role: 'owner' })
      }
      return Response.json({ assets: [], nextCursor: null })
    }
  )

  assert.deepEqual(await sdk.getActiveAccess(), { organizationId: 'org-1', role: 'owner' })
  await sdk.verifySupportGrant('org-2', 'metadata:read')
  await sdk.listAssets({ cursor: 'asset-1', limit: 20 })
  await sdk.signAssetUpload({ bytes: 12, contentType: 'image/png', fileName: 'canary.png' })
  await assert.rejects(
    sdk.signAssetDownload('asset-1'),
    (error) => error instanceof BackendSDKError && error.status === 404
  )
  assert.equal(requests[1].url.searchParams.get('organizationId'), 'org-2')
  assert.equal(requests[1].url.searchParams.get('scope'), 'metadata:read')
  assert.equal(requests[2].url.searchParams.get('cursor'), 'asset-1')
  assert.equal(requests[2].url.searchParams.get('limit'), '20')
  assert.equal(requests[3].method, 'POST')
  assert.deepEqual(requests[3].body, {
    bytes: 12,
    contentType: 'image/png',
    fileName: 'canary.png',
  })
})

test('release SDK preserves nullable updates, idempotency, and tenant scope', async () => {
  const requests: { body?: unknown; headers: Headers; method?: string; url: URL }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init?.headers),
        method: init?.method,
        url: new URL(String(input)),
      })
      return Response.json({ releases: [] })
    }
  )
  await sdk.listReleases(25)
  await sdk.createRelease({
    title: 'Launch',
    benefitStatement: '',
    sourceUrls: ['https://example.test'],
    idempotencyKey: 'key-1',
  })
  await sdk.updateRelease('release-1', { audience: null, productSurfaceId: null })
  assert.equal(requests[0].url.searchParams.get('limit'), '25')
  assert.deepEqual(
    requests.slice(1).map(({ method }) => method),
    ['POST', 'PATCH']
  )
  assert.equal(requests[1].url.pathname, '/v1/releases')
  assert.equal(requests[2].url.pathname, '/v1/releases/release-1')
  assert.deepEqual(requests[2].body, { audience: null, productSurfaceId: null })
  assert.equal(requests[1].headers.get('x-organization-id'), 'org-1')
  assert.deepEqual(requests[1].body, {
    title: 'Launch',
    benefitStatement: '',
    sourceUrls: ['https://example.test'],
    idempotencyKey: 'key-1',
  })
})

test('generated asset SDK sends bytes and metadata without JSON encoding', async () => {
  const requests: { body?: BodyInit | null; headers: Headers; path: string }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      requests.push({
        body: init?.body,
        headers: new Headers(init?.headers),
        path: new URL(String(input)).pathname,
      })
      return Response.json({
        id: 'asset-1',
        mediaType: 'image/png',
        objectKey: 'org/org-1/derived/asset-1/1/render.png',
      })
    }
  )
  await sdk.storeGeneratedAsset({
    body: Uint8Array.from([137, 80, 78, 71]),
    classification: 'derived',
    contentType: 'image/png',
    fileName: 'render.png',
    height: 1,
    parentAssetId: 'asset-parent',
    width: 1,
  })
  await sdk.consumeWorkspaceQuota('generation:monthly', 2)
  assert.equal(requests[0].path, '/v1/assets/generated')
  assert.deepEqual(Array.from(new Uint8Array(requests[0].body as ArrayBuffer)), [137, 80, 78, 71])
  assert.equal(requests[0].headers.get('content-type'), 'image/png')
  assert.equal(requests[0].headers.get('x-parent-asset-id'), 'asset-parent')
  assert.equal(requests[0].headers.get('x-asset-width'), '1')
  assert.equal(requests[1].path, '/v1/quotas/consume')
  assert.deepEqual(JSON.parse(String(requests[1].body)), { amount: 2, quota: 'generation:monthly' })
})

test('campaign, design, creative, and entitlement SDK calls hit their backend routes', async () => {
  const requests: { body?: unknown; method?: string; path: string }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method,
        path: new URL(String(input)).pathname,
      })
      return Response.json({})
    }
  )

  await sdk.listCampaigns()
  await sdk.transitionCampaign('campaign-1', 'READY_FOR_REVIEW')
  await sdk.decideCampaignPosts('campaign-1', { decision: 'approve', postIds: ['post-1'] })
  await sdk.scheduleCampaignPost('campaign-1', 'post-1', { channelConnectionId: 'conn-1' })
  await sdk.listCampaignDesigns('campaign-1')
  await sdk.updateDesignDocument('design-1', { pages: [] })
  await sdk.setDesignRender('design-1', 'asset-1', null)
  await sdk.decideCreativeVariant('variant-1', { status: 'APPROVED' })
  await sdk.getFeatureDecision('asset:delete')

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      'GET /v1/campaigns',
      'POST /v1/campaigns/campaign-1/transition',
      'POST /v1/campaigns/campaign-1/posts/decide',
      'POST /v1/campaigns/campaign-1/posts/post-1/schedule',
      'GET /v1/campaigns/campaign-1/designs',
      'PUT /v1/designs/design-1/document',
      'PUT /v1/designs/design-1/render',
      'POST /v1/creative-variants/variant-1/decision',
      'GET /v1/entitlements/features/asset%3Adelete',
    ]
  )
  assert.deepEqual(requests[1].body, { status: 'READY_FOR_REVIEW' })
  assert.deepEqual(requests[5].body, { document: { pages: [] } })
  assert.deepEqual(requests[6].body, { assetId: 'asset-1', renderKey: null })
})
