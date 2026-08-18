import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

type SessionClient = { cookie: string }
type SetCookieHeaders = Headers & { getSetCookie?: () => string[] }

const baseUrl = getLocalBaseUrl()
const testRunId = randomUUID()
const testPassword = 'LocalTrpcSmoke2026!'

function getLocalBaseUrl(): string {
  const url = new URL(process.env.TENANT_TEST_BASE_URL ?? 'http://localhost:3000')
  assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'The tRPC smoke only runs locally.')
  return url.toString().replace(/\/$/, '')
}

function getResponseCookies(response: Response): string {
  const headers = response.headers as SetCookieHeaders
  const cookies = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
  return cookies
    .map((value) => value.split(';', 1)[0] ?? '')
    .filter(Boolean)
    .join('; ')
}

async function request(
  path: string,
  init: RequestInit = {},
  client?: SessionClient
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('origin', baseUrl)
  if (client?.cookie) headers.set('cookie', client.cookie)
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
  const cookie = getResponseCookies(response)
  if (client && cookie) client.cookie = cookie
  return response
}

async function trpcMutation(path: string, input: unknown, client: SessionClient) {
  return request(
    `/api/trpc/${path}`,
    {
      body: JSON.stringify({ json: input }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
}

async function trpcQuery(path: string, input: unknown | undefined, client: SessionClient) {
  const search =
    input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
  return request(`/api/trpc/${path}${search}`, {}, client)
}

async function trpcJson(response: Response): Promise<unknown> {
  const payload = (await response.json()) as { result?: { data?: { json?: unknown } } }
  return payload.result?.data?.json ?? null
}

function get(value: unknown, ...keys: (string | number)[]): unknown {
  return keys.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null
        ? (current as Record<string | number, unknown>)[key]
        : undefined,
    value
  )
}

async function createSession(): Promise<SessionClient> {
  const client: SessionClient = { cookie: '' }
  const email = `trpc-smoke-${testRunId}@example.invalid`
  const signUp = await request(
    '/api/auth/sign-up/email',
    {
      body: JSON.stringify({ email, name: 'tRPC smoke', password: testPassword }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assert.equal(signUp.status, 200, 'Sign-up must succeed.')
  const create = await request(
    '/api/auth/organization/create',
    {
      body: JSON.stringify({
        name: `tRPC smoke ${testRunId.slice(0, 8)}`,
        slug: `trpc-smoke-${testRunId.slice(0, 8)}`,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assert.equal(create.status, 200, 'Organization creation must succeed.')
  const organizationId = get(await create.json(), 'id')
  const setActive = await request(
    '/api/auth/organization/set-active',
    {
      body: JSON.stringify({ organizationId }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assert.equal(setActive.status, 200, 'Setting the active organization must succeed.')
  return client
}

async function main(): Promise<void> {
  const client = await createSession()

  // brandProfile.upsert and get
  const upsert = await trpcMutation(
    'brandProfile.upsert',
    {
      audience: 'Founders shipping weekly.',
      productDescription: 'Screenshot Studio turns releases into branded posts.',
      tone: 'Confident and concrete.',
    },
    client
  )
  assert.equal(upsert.status, 200, 'brandProfile.upsert must succeed.')
  const profile = await trpcQuery('brandProfile.get', undefined, client)
  assert.equal(profile.status, 200, 'brandProfile.get must succeed.')
  assert.equal(
    get(await trpcJson(profile), 'brandProfile', 'tone'),
    'Confident and concrete.',
    'brandProfile.get must return the upserted tone.'
  )

  // productSurface create, update, list, delete
  const surfaceCreate = await trpcMutation(
    'productSurface.create',
    { name: 'Dashboard', url: 'https://example.invalid/dashboard' },
    client
  )
  assert.equal(surfaceCreate.status, 200, 'productSurface.create must succeed.')
  const surfaceId = get(await trpcJson(surfaceCreate), 'productSurface', 'id')
  assert(typeof surfaceId === 'string', 'productSurface.create must return an id.')
  const surfaceUpdate = await trpcMutation(
    'productSurface.update',
    { description: 'The main dashboard.', surfaceId },
    client
  )
  assert.equal(surfaceUpdate.status, 200, 'productSurface.update must succeed.')
  const surfaceList = await trpcQuery('productSurface.list', undefined, client)
  assert.equal(surfaceList.status, 200, 'productSurface.list must succeed.')
  const missingUpdate = await trpcMutation(
    'productSurface.update',
    { description: 'x', surfaceId: 'c000000000000000000000000' },
    client
  )
  assert.equal(missingUpdate.status, 404, 'Updating a missing surface must return 404.')
  const surfaceDelete = await trpcMutation('productSurface.delete', { surfaceId }, client)
  assert.equal(surfaceDelete.status, 200, 'productSurface.delete must succeed.')

  // campaign create, get, list, approval transition
  const campaignCreate = await trpcMutation(
    'campaign.create',
    {
      name: 'Launch week',
      objective: 'Announce the new tRPC surface.',
      posts: [{ channel: 'x', copy: 'We shipped a typed API.' }],
    },
    client
  )
  assert.equal(campaignCreate.status, 200, 'campaign.create must succeed.')
  const campaignId = get(await trpcJson(campaignCreate), 'campaign', 'id')
  assert(typeof campaignId === 'string', 'campaign.create must return an id.')
  const campaignGet = await trpcQuery('campaign.get', { campaignId }, client)
  assert.equal(campaignGet.status, 200, 'campaign.get must succeed.')
  const campaignList = await trpcQuery('campaign.list', undefined, client)
  assert.equal(campaignList.status, 200, 'campaign.list must succeed.')
  const submit = await trpcMutation(
    'campaign.decideApproval',
    { campaignId, decision: 'submit' },
    client
  )
  assert.equal(submit.status, 200, 'campaign.decideApproval submit must succeed.')
  const missingCampaign = await trpcQuery(
    'campaign.get',
    { campaignId: 'c000000000000000000000000' },
    client
  )
  assert.equal(missingCampaign.status, 404, 'A missing campaign must return 404.')
  const missingSchedule = await trpcMutation(
    'campaign.schedulePost',
    {
      campaignId: 'c000000000000000000000000',
      channelConnectionId: 'c000000000000000000000000',
      postId: 'c000000000000000000000000',
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    },
    client
  )
  assert.equal(missingSchedule.status, 404, 'Scheduling a missing campaign post must return 404.')

  // release create (idempotent), list
  const idempotencyKey = `trpc-smoke-${testRunId}`
  const releaseCreate = await trpcMutation(
    'release.create',
    { benefitStatement: 'Typed API calls.', idempotencyKey, title: 'tRPC smoke release' },
    client
  )
  assert.equal(releaseCreate.status, 200, 'release.create must succeed.')
  assert.equal(get(await trpcJson(releaseCreate), 'created'), true, 'First create must be new.')
  const releaseDuplicate = await trpcMutation(
    'release.create',
    { benefitStatement: 'Typed API calls.', idempotencyKey, title: 'tRPC smoke release' },
    client
  )
  assert.equal(
    get(await trpcJson(releaseDuplicate), 'created'),
    false,
    'A duplicate idempotency key must not create a second release.'
  )
  const releaseList = await trpcQuery('release.list', { limit: 10 }, client)
  assert.equal(releaseList.status, 200, 'release.list must succeed.')
  const releases = get(await trpcJson(releaseList), 'releases')
  assert(Array.isArray(releases) && releases.length === 1, 'Exactly one release must exist.')

  // asset sign upload, error paths for missing assets
  const signUpload = await trpcMutation(
    'asset.signUpload',
    { bytes: 1, contentType: 'image/png', fileName: 'smoke.png' },
    client
  )
  assert.equal(signUpload.status, 200, 'asset.signUpload must succeed.')
  const pendingAssetId = get(await trpcJson(signUpload), 'asset', 'id')
  assert(typeof pendingAssetId === 'string', 'asset.signUpload must return an asset id.')
  const missingAssetId = randomUUID()
  const missingDownload = await trpcQuery(
    'asset.signDownload',
    { assetId: missingAssetId },
    client
  )
  assert.equal(missingDownload.status, 404, 'Signing a missing asset download must return 404.')
  const missingComplete = await trpcMutation(
    'asset.completeUpload',
    { assetId: missingAssetId },
    client
  )
  assert.equal(missingComplete.status, 404, 'Completing a missing asset must return 404.')
  const pendingDelete = await trpcMutation('asset.delete', { assetId: pendingAssetId }, client)
  assert.equal(pendingDelete.status, 409, 'Deleting a pending (not uploaded) asset must conflict.')

  // source app create
  const sourceApp = await trpcMutation(
    'sourceApp.create',
    { allowedHosts: ['https://example.invalid'], name: 'Smoke source', provider: 'generic' },
    client
  )
  assert.equal(sourceApp.status, 200, 'sourceApp.create must succeed.')

  // publishing and creative list queries
  const scheduledPosts = await trpcQuery('scheduledPost.list', { limit: 10 }, client)
  assert.equal(scheduledPosts.status, 200, 'scheduledPost.list must succeed.')
  const connections = await trpcQuery('channelConnection.list', undefined, client)
  assert.equal(connections.status, 200, 'channelConnection.list must succeed.')
  const templates = await trpcQuery('creativeTemplate.list', undefined, client)
  assert.equal(templates.status, 200, 'creativeTemplate.list must succeed.')

  // sensitive procedures require a fresh two-factor session
  const sensitive = await trpcMutation(
    'channelConnection.create',
    { externalAccountId: 'smoke-account' },
    client
  )
  assert.equal(
    sensitive.status,
    403,
    'channelConnection.create without two-factor must return 403.'
  )

  console.info(`tRPC smoke passed for local run ${testRunId}.`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
