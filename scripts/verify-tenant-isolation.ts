import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { z } from 'zod'

type SessionClient = { cookie: string }
type SetCookieHeaders = Headers & { getSetCookie?: () => string[] }

const baseUrl = getLocalBaseUrl()
const testRunId = randomUUID()
const testPassword = 'LocalTenantIsolation2026!'
const organizationSchema = z.object({ id: z.string().min(1) }).passthrough()
const releaseSchema = z.object({ id: z.string().uuid(), title: z.string() })
const releaseResultSchema = z.object({ release: releaseSchema })
const releaseListSchema = z.object({ releases: z.array(releaseSchema) })
const assetResultSchema = z.object({ asset: z.object({ id: z.string().uuid() }) })
const apiKeyResultSchema = z.object({ apiKey: z.object({ id: z.string(), key: z.string().min(1) }) })
const onboardingRunSchema = z.object({ run: z.object({ id: z.string().min(1) }) })

function getLocalBaseUrl(): string {
  const url = new URL(process.env.TENANT_TEST_BASE_URL ?? 'http://localhost:3000')
  assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'Tenant tests only run locally.')
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

function updateSessionCookie(client: SessionClient | undefined, response: Response): void {
  const cookie = getResponseCookies(response)
  if (client && cookie) client.cookie = cookie
}

async function request(path: string, init: RequestInit = {}, client?: SessionClient): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('origin', baseUrl)
  headers.set('x-request-id', `tenant-isolation:${testRunId}`)
  if (client?.cookie) headers.set('cookie', client.cookie)
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
  updateSessionCookie(client, response)
  return response
}

async function trpcMutation(
  path: string,
  input: unknown,
  client?: SessionClient,
  headers: Record<string, string> = {}
): Promise<Response> {
  return request(
    `/api/trpc/${path}`,
    {
      body: JSON.stringify({ json: input }),
      headers: { 'content-type': 'application/json', ...headers },
      method: 'POST',
    },
    client
  )
}

async function trpcJson(response: Response): Promise<unknown> {
  const payload = (await response.json()) as { result?: { data?: { json?: unknown } } }
  return payload.result?.data?.json ?? null
}

function assertStatus(response: Response, expected: number): void {
  assert.equal(response.status, expected, `Expected ${expected}, received ${response.status}.`)
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json()
}

async function createSession(label: string): Promise<SessionClient> {
  const email = `tenant-${label}-${testRunId}@example.invalid`
  const signUpResponse = await request('/api/auth/sign-up/email', {
    body: JSON.stringify({ email, name: `Tenant ${label}`, password: testPassword }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  assertStatus(signUpResponse, 200)
  const signInResponse = await request('/api/auth/sign-in/email', {
    body: JSON.stringify({ email, password: testPassword }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  assertStatus(signInResponse, 200)
  const cookie = getResponseCookies(signInResponse)
  assert(cookie, `A session cookie was not issued for organization ${label}.`)
  return { cookie }
}

async function createOrganization(client: SessionClient, label: string): Promise<string> {
  const response = await request(
    '/api/auth/organization/create',
    {
      body: JSON.stringify({ name: `Tenant ${label} ${testRunId}`, slug: `tenant-${label}-${testRunId}` }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assertStatus(response, 200)
  const organization = organizationSchema.parse(await responseJson(response))
  const activeResponse = await request(
    '/api/auth/organization/set-active',
    {
      body: JSON.stringify({ organizationId: organization.id }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assertStatus(activeResponse, 200)
  return organization.id
}

async function createRelease(client: SessionClient, label: string): Promise<z.infer<typeof releaseSchema>> {
  const response = await request(
    '/api/tenant/releases',
    {
      body: JSON.stringify({ benefitStatement: `Benefit ${label}`, title: `Release ${label}` }),
      headers: { 'content-type': 'application/json', 'idempotency-key': `${testRunId}:${label}` },
      method: 'POST',
    },
    client
  )
  assertStatus(response, 201)
  return releaseResultSchema.parse(await responseJson(response)).release
}

async function createPendingAsset(client: SessionClient): Promise<string> {
  const response = await request(
    '/api/tenant/assets/upload-url',
    {
      body: JSON.stringify({ bytes: 1, contentType: 'image/png', fileName: 'tenant-test.png' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assertStatus(response, 201)
  return assetResultSchema.parse(await responseJson(response)).asset.id
}

async function createApiKey(client: SessionClient): Promise<{ id: string; key: string }> {
  const response = await trpcMutation(
    'apiKey.create',
    { name: `tenant-${testRunId.slice(0, 20)}`, scopes: ['artifact:read', 'release:create'] },
    client
  )
  assertStatus(response, 200)
  return apiKeyResultSchema.parse(await trpcJson(response)).apiKey
}

async function assertSessionIsolation(
  client: SessionClient,
  ownReleaseId: string,
  otherReleaseId: string,
  otherOrganizationId: string,
  otherAssetId: string
): Promise<void> {
  const listResponse = await request(`/api/tenant/releases?organizationId=${otherOrganizationId}`, {}, client)
  assertStatus(listResponse, 200)
  const releases = releaseListSchema.parse(await responseJson(listResponse)).releases
  assert(releases.some((release) => release.id === ownReleaseId))
  assert(!releases.some((release) => release.id === otherReleaseId))

  const downloadResponse = await request(`/api/tenant/assets/${otherAssetId}/download-url`, {}, client)
  assertStatus(downloadResponse, 404)
  const completeResponse = await request(
    `/api/tenant/assets/${otherAssetId}/complete`,
    { body: JSON.stringify({}), headers: { 'content-type': 'application/json' }, method: 'POST' },
    client
  )
  assertStatus(completeResponse, 404)
}

async function assertApiKeyIsolation(
  client: SessionClient,
  apiKey: { id: string; key: string },
  ownReleaseId: string,
  otherReleaseId: string,
  otherOrganizationId: string,
  otherAssetId: string
): Promise<void> {
  const headers = { 'x-api-key': apiKey.key }
  const listResponse = await request(`/api/tenant/releases?organizationId=${otherOrganizationId}`, { headers })
  assertStatus(listResponse, 200)
  const releases = releaseListSchema.parse(await responseJson(listResponse)).releases
  assert(releases.some((release) => release.id === ownReleaseId))
  assert(!releases.some((release) => release.id === otherReleaseId))

  const downloadResponse = await request(`/api/tenant/assets/${otherAssetId}/download-url`, { headers })
  assertStatus(downloadResponse, 404)
  const revokeResponse = await trpcMutation('apiKey.revoke', { keyId: apiKey.id }, client)
  assertStatus(revokeResponse, 200)
  const revokedResponse = await request('/api/tenant/releases', { headers })
  assertStatus(revokedResponse, 403)
}

/**
 * Start an onboarding run (docs/rfcs/032). The site is unreachable on
 * purpose: the run still completes, so no external request is made.
 */
async function createOnboardingRun(client: SessionClient, label: string): Promise<string> {
  const response = await request(
    '/api/v1/onboarding-runs',
    {
      body: JSON.stringify({ url: `https://tenant-${label}.invalid/` }),
      headers: { 'content-type': 'application/json', 'idempotency-key': `${testRunId}:${label}` },
      method: 'POST',
    },
    client
  )
  assertStatus(response, 201)
  return onboardingRunSchema.parse(await responseJson(response)).run.id
}

/** Another workspace's run, its pages' findings, and its ICP are invisible and untouchable. */
async function assertOnboardingIsolation(
  client: SessionClient,
  ownRunId: string,
  otherRunId: string
): Promise<void> {
  assertStatus(await request(`/api/v1/onboarding-runs/${ownRunId}`, {}, client), 200)
  for (const [path, method] of [
    [`/api/v1/onboarding-runs/${otherRunId}`, 'GET'],
    [`/api/v1/onboarding-runs/${otherRunId}/enrichment`, 'GET'],
    [`/api/v1/onboarding-runs/${otherRunId}/cancel`, 'POST'],
    [`/api/v1/onboarding-runs/${otherRunId}/rerun`, 'POST'],
  ] as const) {
    assertStatus(await request(path, { method }, client), 404)
  }
}

/**
 * There is no free plan, so each fixture workspace gets Pro directly in the
 * local database, the same way the e2e framework does.
 */
async function grantProPlan(organizationIds: string[]): Promise<void> {
  const connection = process.env.HOST_DATABASE_URL
  assert(connection, 'HOST_DATABASE_URL is required to give the fixture workspaces a plan.')
  const url = new URL(connection)
  url.searchParams.delete('schema')
  const database = new Pool({ connectionString: url.toString() })
  try {
    for (const organizationId of organizationIds) {
      await database.query(
        `INSERT INTO workspace_entitlement ("organizationId", plan, status, "updatedAt")
         VALUES ($1, 'pro', 'active', now())
         ON CONFLICT ("organizationId") DO UPDATE SET plan = 'pro', status = 'active', "updatedAt" = now()`,
        [organizationId]
      )
    }
  } finally {
    await database.end()
  }
}

async function main(): Promise<void> {
  const clientA = await createSession('a')
  const clientB = await createSession('b')
  const organizationA = await createOrganization(clientA, 'a')
  const organizationB = await createOrganization(clientB, 'b')
  await grantProPlan([organizationA, organizationB])
  const releaseA = await createRelease(clientA, 'a')
  const releaseB = await createRelease(clientB, 'b')
  const assetA = await createPendingAsset(clientA)
  const assetB = await createPendingAsset(clientB)
  const apiKeyA = await createApiKey(clientA)

  await assertSessionIsolation(clientA, releaseA.id, releaseB.id, organizationB, assetB)
  await assertSessionIsolation(clientB, releaseB.id, releaseA.id, organizationA, assetA)
  await assertApiKeyIsolation(clientA, apiKeyA, releaseA.id, releaseB.id, organizationB, assetB)
  const runA = await createOnboardingRun(clientA, 'a')
  const runB = await createOnboardingRun(clientB, 'b')
  await assertOnboardingIsolation(clientA, runA, runB)
  await assertOnboardingIsolation(clientB, runB, runA)
  console.info(`Tenant isolation passed for local run ${testRunId}.`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
