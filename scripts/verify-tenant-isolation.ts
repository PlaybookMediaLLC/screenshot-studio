import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
  const response = await request(
    '/api/tenant/api-keys',
    {
      body: JSON.stringify({ name: `tenant-${testRunId.slice(0, 20)}`, scopes: ['artifact:read', 'release:create'] }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    client
  )
  assertStatus(response, 201)
  return apiKeyResultSchema.parse(await responseJson(response)).apiKey
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
  const revokeResponse = await request(
    '/api/tenant/api-keys',
    { body: JSON.stringify({ keyId: apiKey.id }), headers: { 'content-type': 'application/json' }, method: 'DELETE' },
    client
  )
  assertStatus(revokeResponse, 200)
  const revokedResponse = await request('/api/tenant/releases', { headers })
  assertStatus(revokedResponse, 403)
}

async function main(): Promise<void> {
  const clientA = await createSession('a')
  const clientB = await createSession('b')
  const organizationA = await createOrganization(clientA, 'a')
  const organizationB = await createOrganization(clientB, 'b')
  const releaseA = await createRelease(clientA, 'a')
  const releaseB = await createRelease(clientB, 'b')
  const assetA = await createPendingAsset(clientA)
  const assetB = await createPendingAsset(clientB)
  const apiKeyA = await createApiKey(clientA)

  await assertSessionIsolation(clientA, releaseA.id, releaseB.id, organizationB, assetB)
  await assertSessionIsolation(clientB, releaseB.id, releaseA.id, organizationA, assetA)
  await assertApiKeyIsolation(clientA, apiKeyA, releaseA.id, releaseB.id, organizationB, assetB)
  console.info(`Tenant isolation passed for local run ${testRunId}.`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
