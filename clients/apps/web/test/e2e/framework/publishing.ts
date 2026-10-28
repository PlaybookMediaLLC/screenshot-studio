import { createHash } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { signUpViaApi, getE2EUrl } from './auth'
import { type E2EIdentity, setupStep } from './flow'
import { db, grantWorkspacePlan } from './services'
import { socialSecretReference } from './social-mock'
import { getTotpCode } from './totp'

/** Publishing setup shared by the scheduling flows and the social gate. */
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64'
)
export const signedAssetSchema = z.object({
  asset: z.object({ id: z.string().uuid() }),
  uploadUrl: z.string().url(),
})
export const brandKitSchema = z.object({
  brandKit: z.object({ id: z.string().cuid(), version: z.number() }),
})
export const creativeTemplateSchema = z.object({ template: z.object({ id: z.string().cuid() }) })
export const creativeVariantSchema = z.object({
  variant: z.object({ id: z.string().cuid(), status: z.string() }),
})
export const releaseSchema = z.object({ release: z.object({ id: z.string().uuid() }) })
export const connectionSchema = z.object({ connection: z.object({ id: z.string().cuid() }) })
export const scheduledPostSchema = z.object({
  created: z.boolean(),
  scheduledPost: z.object({ id: z.string().cuid(), status: z.string() }),
})
export const activeSessionSchema = z.object({
  session: z.object({ activeOrganizationId: z.string().min(1) }),
})

export async function apiRequest(
  page: Page,
  path: string,
  input: { body?: unknown; headers?: Record<string, string>; method?: string } = {}
): Promise<{ body: unknown; status: number }> {
  const response = await page.context().request.fetch(getE2EUrl(path), {
    data: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: new URL(getE2EUrl('/')).origin,
      ...input.headers,
    },
    method: input.method ?? 'GET',
  })
  const raw = await response.text()
  let body: unknown = raw
  try {
    body = JSON.parse(raw)
  } catch {
    // Plain-text and empty responses are valid for some routes.
  }
  return { body, status: response.status() }
}

async function getActiveOrganizationId(page: Page): Promise<string> {
  const response = await apiRequest(page, '/api/auth/get-session')
  expect(response.status).toBe(200)
  return activeSessionSchema.parse(response.body).session.activeOrganizationId
}

export async function trpcMutation(
  page: Page,
  path: string,
  input: unknown
): Promise<{ body: unknown; status: number }> {
  const response = await apiRequest(page, `/api/trpc/${path}`, {
    body: { json: input },
    method: 'POST',
  })
  if (typeof response.body !== 'object' || response.body === null) return response
  if ('result' in response.body) {
    const result = response.body as { result: { data?: { json?: unknown } } }
    return { body: result.result.data?.json ?? null, status: response.status }
  }
  if ('error' in response.body) {
    const error = response.body as { error: { json?: unknown } }
    return { body: error.error.json ?? error.error, status: response.status }
  }
  return response
}

async function requestJson(
  page: Page,
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  headers: Record<string, string> = {}
): Promise<{ body: unknown; status: number }> {
  return apiRequest(page, path, { body, headers, method })
}

async function uploadSignedAsset(
  page: Page,
  uploadUrl: string,
  bytes: readonly number[],
  contentType: string
): Promise<number> {
  const response = await page.context().request.put(uploadUrl, {
    data: Buffer.from(bytes),
    headers: { 'content-type': contentType, 'if-none-match': '*' },
  })
  return response.status()
}

async function createPublishingWorkspaceSteps(identity: E2EIdentity, page: Page): Promise<void> {
  await signUpViaApi(identity, page)
  const workspace = await trpcMutation(page, 'workspace.create', {
    name: identity.workspaceName,
    slug: identity.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  })
  expect(workspace.status).toBe(200)
  // Publishing fixtures default to Pro; free-tier cases explicitly replace this plan.
  await grantWorkspacePlan(await getActiveOrganizationId(page), 'pro')
}
export const createPublishingWorkspace = setupStep(
  'create a workspace through the API',
  createPublishingWorkspaceSteps
)

async function enablePublishingTwoFactorSteps(page: Page, password: string): Promise<void> {
  const headers = { origin: new URL(getE2EUrl('/')).origin }
  const enable = await page.context().request.post(getE2EUrl('/api/auth/two-factor/enable'), {
    data: { password },
    headers,
  })
  expect(enable.status()).toBe(200)
  const setup = z.object({ totpURI: z.string() }).parse(await enable.json())
  const verify = await page.context().request.post(getE2EUrl('/api/auth/two-factor/verify-totp'), {
    data: { code: getTotpCode(setup.totpURI) },
    headers,
  })
  expect(verify.status()).toBe(200)
}
export const enablePublishingTwoFactor = setupStep(
  'enable two-factor through the API',
  enablePublishingTwoFactorSteps
)

export async function createUploadedAsset(page: Page): Promise<string> {
  const sha256 = createHash('sha256').update(png).digest('hex')
  const signedResponse = await requestJson(page, '/api/tenant/assets/upload-url', {
    bytes: png.byteLength,
    classification: 'input',
    contentType: 'image/png',
    fileName: 'launch.png',
    sha256,
  })
  expect(signedResponse.status).toBe(201)
  const signed = signedAssetSchema.parse(signedResponse.body)
  expect(await uploadSignedAsset(page, signed.uploadUrl, [...png], 'image/png')).toBe(200)
  const complete = await requestJson(page, `/api/tenant/assets/${signed.asset.id}/complete`, {
    sha256,
  })
  expect(complete.status).toBe(200)
  return signed.asset.id
}

export async function createApprovedVariant(page: Page): Promise<string> {
  const assetId = await createUploadedAsset(page)
  const kitResponse = await trpcMutation(page, 'brandKit.create', {
    definition: {
      colors: { accent: '#7047eb', background: '#ffffff', text: '#111111' },
      schemaVersion: 1,
      typography: { headingFamily: 'inter' },
    },
    name: 'Launch brand',
    publish: true,
  })
  expect(kitResponse.status).toBe(200)
  const brandKit = brandKitSchema.parse(kitResponse.body).brandKit
  const releaseResponse = await requestJson(page, '/api/tenant/releases', {
    benefitStatement: 'Ship the launch update.',
    title: 'Launch update',
  })
  expect(releaseResponse.status).toBe(201)
  const releaseId = releaseSchema.parse(releaseResponse.body).release.id
  const templateResponse = await trpcMutation(page, 'creativeTemplate.create', {
    definition: { layout: 'social' },
    name: `Launch template ${releaseId}`,
  })
  expect(templateResponse.status).toBe(200)
  const template = creativeTemplateSchema.parse(templateResponse.body).template
  const variantResponse = await trpcMutation(page, 'creativeVariant.create', {
    aspectRatio: '1:1',
    brandKitId: brandKit.id,
    releaseId,
    sourceAssetId: assetId,
    templateId: template.id,
  })
  expect(variantResponse.status, JSON.stringify(variantResponse.body)).toBe(200)
  const variant = creativeVariantSchema.parse(variantResponse.body).variant
  const approvalResponse = await trpcMutation(page, 'creativeVariant.decideApproval', {
    status: 'APPROVED',
    variantId: variant.id,
  })
  expect(approvalResponse).toMatchObject({
    body: { variant: { id: variant.id, status: 'APPROVED' } },
    status: 200,
  })
  return variant.id
}

export async function createScheduledPost(
  page: Page,
  channelConnectionId: string,
  idempotencyKey: string,
  variantId: string,
  scheduledFor = new Date(Date.now() + 60_000)
) {
  const response = await trpcMutation(page, 'scheduledPost.create', {
    caption: 'The launch is ready.',
    channelConnectionId,
    idempotencyKey,
    scheduledFor: scheduledFor.toISOString(),
    variantId,
  })
  return { response, scheduledPost: scheduledPostSchema.parse(response.body).scheduledPost }
}

/**
 * This worker's social secret: workspaces bind to it, and its token routes the
 * backend's social API calls to this worker's mock (framework/social-mock.ts).
 */
export const e2eSecretReference = socialSecretReference(
  Number(process.env.TEST_PARALLEL_INDEX ?? 0)
)

/** Bind the active workspace to the social API mock's organization, `go-<organizationId>`. */
export async function bindTestGoOrganization(page: Page): Promise<string> {
  const organizationId = await getActiveOrganizationId(page)
  const goOrganizationId = `go-${organizationId}`
  await db.query('DELETE FROM social_tenant_binding WHERE "secretReference" = $1', [
    e2eSecretReference,
  ])
  await db.query(
    `INSERT INTO social_tenant_binding ("organizationId", "goOrganizationId", "secretReference")
       VALUES ($1, $2, $3)`,
    [organizationId, goOrganizationId, e2eSecretReference]
  )
  return organizationId
}

export async function unbindTestGoOrganization(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await db.query(
    'DELETE FROM social_tenant_binding WHERE "organizationId" = $1 AND "secretReference" = $2',
    [organizationId, e2eSecretReference]
  )
}
