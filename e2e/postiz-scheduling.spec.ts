import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { getE2EUrl } from './framework/auth'
import { configureE2EFlow, test, type E2EIdentity } from './framework/flow'
import { startHttpMockServer, type HttpMockRequest } from './framework/http-server'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabaseClient } from './framework/services'
import { getTotpCode } from './framework/totp'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL6fQAAAABJRU5ErkJggg==',
  'base64'
)
const signedAssetSchema = z.object({
  asset: z.object({ id: z.string().uuid() }),
  uploadUrl: z.string().url(),
})
const brandKitSchema = z.object({
  brandKit: z.object({ id: z.string().cuid(), version: z.number() }),
})
const creativeTemplateSchema = z.object({ template: z.object({ id: z.string().cuid() }) })
const creativeVariantSchema = z.object({
  variant: z.object({ id: z.string().cuid(), status: z.string() }),
})
const releaseSchema = z.object({ release: z.object({ id: z.string().uuid() }) })
const connectionSchema = z.object({ connection: z.object({ id: z.string().cuid() }) })
const scheduledPostSchema = z.object({
  created: z.boolean(),
  scheduledPost: z.object({ id: z.string().cuid(), status: z.string() }),
})
const e2eSecretReference = 'POSTIZ_API_KEY_E2E'
const activeSessionSchema = z.object({
  session: z.object({ activeOrganizationId: z.string().min(1) }),
})

async function apiRequest(
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

async function trpcMutation(
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
    headers: { 'content-type': contentType },
  })
  return response.status()
}

async function createPublishingWorkspace(identity: E2EIdentity, page: Page): Promise<void> {
  const signup = await apiRequest(page, '/api/auth/sign-up/email', {
    body: { email: identity.email, name: identity.name, password: identity.password },
    method: 'POST',
  })
  expect(signup.status).toBe(200)
  const workspace = await trpcMutation(page, 'workspace.create', {
    name: identity.workspaceName,
    slug: identity.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  })
  expect(workspace.status).toBe(200)
  await getActiveOrganizationId(page)
}

async function enablePublishingTwoFactor(page: Page, password: string): Promise<void> {
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

async function bindTestGoOrganization(page: Page): Promise<string> {
  const organizationId = await getActiveOrganizationId(page)
  const goOrganizationId = `go-${organizationId}`
  const database = createE2EDatabaseClient()
  try {
    await database.postizTenantBinding.deleteMany({
      where: { secretReference: e2eSecretReference },
    })
    await database.postizTenantBinding.create({
      data: { goOrganizationId, organizationId, secretReference: e2eSecretReference },
    })
  } finally {
    await database.$disconnect()
  }
  return organizationId
}

async function unbindTestGoOrganization(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  const database = createE2EDatabaseClient()
  try {
    await database.postizTenantBinding.deleteMany({
      where: { organizationId, secretReference: e2eSecretReference },
    })
  } finally {
    await database.$disconnect()
  }
}

async function createUploadedAsset(page: Page): Promise<string> {
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

async function createApprovedVariant(page: Page): Promise<string> {
  const assetId = await createUploadedAsset(page)
  const kitResponse = await trpcMutation(page, 'brandKit.create', {
    definition: { accent: '#7047eb' },
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

function postRequests(calls: readonly HttpMockRequest[]): HttpMockRequest[] {
  return calls.filter((call) => call.url === '/api/public/v1/posts')
}

async function createScheduledPost(
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

async function makeScheduledPostDue(id: string): Promise<void> {
  const database = createE2EDatabaseClient()
  try {
    await database.scheduledPost.update({
      data: { scheduledFor: new Date(Date.now() - 1_000) },
      where: { id },
    })
  } finally {
    await database.$disconnect()
  }
}

async function makeScheduledPostStaleProcessing(id: string): Promise<void> {
  const database = createE2EDatabaseClient()
  try {
    await database.scheduledPost.update({
      data: {
        scheduledFor: new Date(Date.now() - 1_000),
        status: 'PROCESSING',
        updatedAt: new Date(Date.now() - 11 * 60 * 1_000),
      },
      where: { id },
    })
  } finally {
    await database.$disconnect()
  }
}

configureE2EFlow()

test('an approved variant schedules through Postiz once, retries a throttle, and respects cancellation', async ({
  identity,
  page,
}) => {
  let postAttempts = 0
  let remoteState: 'QUEUE' | 'PUBLISHED' = 'QUEUE'
  let organizationId: string | null = null
  const provider = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: 'postiz-x-integration', identifier: 'x', disabled: false }] }
    }
    if (request.url === '/api/public/v1/upload') {
      return {
        body: { id: `media-${postAttempts}`, path: 'https://postiz.test/media.png' },
        status: 201,
      }
    }
    if (request.url === '/api/public/v1/posts') {
      postAttempts += 1
      return postAttempts === 1
        ? { body: { message: 'Retry later.' }, status: 429 }
        : {
            body: [{ postId: `post-${postAttempts}`, integration: 'postiz-x-integration' }],
            status: 201,
          }
    }
    if (request.url === '/api/public/v1/posts/post-2/status') {
      return {
        body: {
          postId: 'post-2',
          state: remoteState,
          releaseId: remoteState === 'PUBLISHED' ? 'remote-post-2' : null,
          releaseURL: remoteState === 'PUBLISHED' ? 'https://social.test/post/2' : null,
        },
        status: 200,
      }
    }
    if (request.url === '/api/public/v1/posts/post-3/status') {
      return {
        body: { postId: 'post-3', state: 'ERROR', releaseId: null, releaseURL: null },
        status: 200,
      }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)

  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const unbound = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      secretReference: e2eSecretReference,
    })
    expect(unbound.status).toBe(409)
    expect(provider.calls).toHaveLength(0)

    organizationId = await bindTestGoOrganization(page)
    const wrongCredential = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      secretReference: 'POSTIZ_API_KEY',
    })
    expect(wrongCredential.status).toBe(409)
    expect(provider.calls).toHaveLength(0)
    const foreignDestination = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'another-organizations-destination',
      platform: 'x',
      secretReference: e2eSecretReference,
    })
    expect(foreignDestination.status).toBe(404)
    expect(provider.calls.map((call) => call.url)).toEqual([
      '/api/public/v1/me',
      '/api/public/v1/integrations',
    ])
    const connectionResponse = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      providerSettings: { who_can_reply_post: 'everyone' },
      secretReference: e2eSecretReference,
    })
    expect(connectionResponse.status).toBe(200)
    const connectionId = connectionSchema.parse(connectionResponse.body).connection.id

    const first = await createScheduledPost(page, connectionId, 'postiz-launch', variantId)
    expect(first.response.status).toBe(200)
    expect(scheduledPostSchema.parse(first.response.body).created).toBe(true)
    const duplicate = await createScheduledPost(page, connectionId, 'postiz-launch', variantId)
    expect(duplicate.response.status).toBe(200)
    expect(scheduledPostSchema.parse(duplicate.response.body).created).toBe(false)
    expect(duplicate.scheduledPost.id).toBe(first.scheduledPost.id)
    await makeScheduledPostDue(first.scheduledPost.id)

    const firstDispatch = await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    // The maintenance endpoint drains all tenants; assert this post's attempts below.
    expect(firstDispatch.status).toBe(200)
    const secondDispatch = await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(secondDispatch.status).toBe(200)

    const database = createE2EDatabaseClient()
    try {
      const accepted = await database.scheduledPost.findUnique({
        include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
        where: { id: first.scheduledPost.id },
      })
      expect(accepted).toMatchObject({ status: 'PROCESSING' })
      expect(accepted?.attempts).toMatchObject([
        { failureCode: '429', outcome: 'FAILED' },
        { outcome: null, providerPostId: 'post-2' },
      ])
      expect(
        (
          await requestJson(
            page,
            '/api/internal/scheduled-posts/dispatch',
            {},
            'POST',
            getMaintenanceHeaders()
          )
        ).status
      ).toBe(200)
      expect(
        await database.scheduledPost.findUnique({ where: { id: first.scheduledPost.id } })
      ).toMatchObject({
        status: 'PROCESSING',
      })
      remoteState = 'PUBLISHED'
      await requestJson(
        page,
        '/api/internal/scheduled-posts/dispatch',
        {},
        'POST',
        getMaintenanceHeaders()
      )
      const published = await database.scheduledPost.findUnique({
        include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
        where: { id: first.scheduledPost.id },
      })
      expect(published).toMatchObject({ status: 'PUBLISHED' })
      expect(published?.attempts).toMatchObject([
        { failureCode: '429', outcome: 'FAILED' },
        { outcome: 'SUCCEEDED', providerPostId: 'post-2' },
      ])
    } finally {
      await database.$disconnect()
    }
    expect(postRequests(provider.calls)).toHaveLength(2)
    expect(JSON.parse(postRequests(provider.calls)[0]?.body ?? '{}')).toMatchObject({
      posts: [
        {
          integration: { id: 'postiz-x-integration' },
          settings: { __type: 'x', who_can_reply_post: 'everyone' },
        },
      ],
      type: 'now',
    })

    const cancelled = await createScheduledPost(page, connectionId, 'postiz-cancelled', variantId)
    expect(cancelled.response.status).toBe(200)
    const cancelResponse = await trpcMutation(page, 'scheduledPost.cancel', {
      scheduledPostId: cancelled.scheduledPost.id,
    })
    expect(cancelResponse).toMatchObject({
      body: { scheduledPost: { status: 'CANCELLED' } },
      status: 200,
    })
    await makeScheduledPostDue(cancelled.scheduledPost.id)
    await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(postRequests(provider.calls)).toHaveLength(2)

    const rejected = await createScheduledPost(
      page,
      connectionId,
      'postiz-provider-error',
      variantId
    )
    await makeScheduledPostDue(rejected.scheduledPost.id)
    await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    const databaseAfterError = createE2EDatabaseClient()
    try {
      const failed = await databaseAfterError.scheduledPost.findUnique({
        include: { attempts: true },
        where: { id: rejected.scheduledPost.id },
      })
      expect(failed).toMatchObject({
        attempts: [{ failureCode: 'PROVIDER_ERROR', outcome: 'FAILED', providerPostId: 'post-3' }],
        status: 'FAILED',
      })
    } finally {
      await databaseAfterError.$disconnect()
    }
    expect(postRequests(provider.calls)).toHaveLength(3)
  } finally {
    await provider.close()
    await unbindTestGoOrganization(organizationId)
  }
})

test('a queued post is cancelled when its approval or destination is revoked before dispatch', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const provider = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/me'
        ? { body: { organization: { id: `go-${organizationId}` } } }
        : request.url === '/api/public/v1/integrations'
          ? { body: [{ id: 'revocation-integration', identifier: 'x', disabled: false }] }
          : request.url === '/api/public/v1/upload'
            ? { body: { id: 'media', path: 'https://postiz.test/media.png' }, status: 201 }
            : { body: [{ postId: 'post', integration: 'revocation-integration' }], status: 201 },
    5679
  )

  try {
    await createPublishingWorkspace(identity, page)
    organizationId = await bindTestGoOrganization(page)
    await enablePublishingTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await trpcMutation(page, 'channelConnection.create', {
          externalAccountId: 'revocation-integration',
          platform: 'x',
          providerSettings: {},
          secretReference: e2eSecretReference,
        })
      ).body
    ).connection
    const connectionRevoked = await createScheduledPost(
      page,
      connection.id,
      'postiz-connection-revoked',
      variantId
    )
    expect(connectionRevoked.response.status).toBe(200)
    await makeScheduledPostDue(connectionRevoked.scheduledPost.id)

    const database = createE2EDatabaseClient()
    try {
      await database.channelConnection.update({
        data: { status: 'REVOKED' },
        where: { id: connection.id },
      })
      expect(
        await requestJson(
          page,
          '/api/internal/scheduled-posts/dispatch',
          {},
          'POST',
          getMaintenanceHeaders()
        )
      ).toMatchObject({ body: { dispatched: expect.any(Number) }, status: 200 })
      expect(
        await database.scheduledPost.findUniqueOrThrow({
          where: { id: connectionRevoked.scheduledPost.id },
        })
      ).toMatchObject({ status: 'CANCELLED' })
      expect(
        await database.publicationAttempt.count({
          where: { scheduledPostId: connectionRevoked.scheduledPost.id },
        })
      ).toBe(0)

      await database.channelConnection.update({
        data: { status: 'ACTIVE' },
        where: { id: connection.id },
      })
      const approvalRevoked = await createScheduledPost(
        page,
        connection.id,
        'postiz-approval-revoked',
        variantId
      )
      expect(approvalRevoked.response.status).toBe(200)
      await makeScheduledPostDue(approvalRevoked.scheduledPost.id)
      await database.approval.update({ data: { status: 'REJECTED' }, where: { variantId } })
      expect(
        await requestJson(
          page,
          '/api/internal/scheduled-posts/dispatch',
          {},
          'POST',
          getMaintenanceHeaders()
        )
      ).toMatchObject({ body: { dispatched: expect.any(Number) }, status: 200 })
      expect(
        await database.scheduledPost.findUniqueOrThrow({
          where: { id: approvalRevoked.scheduledPost.id },
        })
      ).toMatchObject({ status: 'CANCELLED' })
      expect(
        await database.publicationAttempt.count({
          where: { scheduledPostId: approvalRevoked.scheduledPost.id },
        })
      ).toBe(0)
    } finally {
      await database.$disconnect()
    }
    expect(postRequests(provider.calls)).toHaveLength(0)
  } finally {
    await provider.close()
    await unbindTestGoOrganization(organizationId)
  }
})

test('a worker recovers an unclaimed post and does not retry uncertain delivery', async ({
  identity,
  page,
}) => {
  let boundOrganizationId: string | null = null
  const provider = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/me'
        ? { body: { organization: { id: `go-${boundOrganizationId}` } } }
        : request.url === '/api/public/v1/integrations'
          ? { body: [{ id: 'recovery-integration', identifier: 'x', disabled: false }] }
          : request.url === '/api/public/v1/upload'
            ? { body: { id: 'media', path: 'https://postiz.test/media.png' }, status: 201 }
            : request.url === '/api/public/v1/posts/published-post/status'
              ? {
                  body: {
                    postId: 'published-post',
                    state: 'PUBLISHED',
                    releaseId: 'remote-1',
                    releaseURL: 'https://social.test/post/1',
                  },
                  status: 200,
                }
              : {
                  body: [{ postId: 'published-post', integration: 'recovery-integration' }],
                  status: 201,
                },
    5679
  )

  try {
    await createPublishingWorkspace(identity, page)
    const organizationId = await getActiveOrganizationId(page)
    boundOrganizationId = await bindTestGoOrganization(page)
    await enablePublishingTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await trpcMutation(page, 'channelConnection.create', {
          externalAccountId: 'recovery-integration',
          platform: 'x',
          providerSettings: {},
          secretReference: e2eSecretReference,
        })
      ).body
    ).connection
    const unclaimed = await createScheduledPost(
      page,
      connection.id,
      'postiz-recover-safe',
      variantId
    )
    const uncertain = await createScheduledPost(
      page,
      connection.id,
      'postiz-recover-uncertain',
      variantId
    )
    await makeScheduledPostStaleProcessing(unclaimed.scheduledPost.id)
    await makeScheduledPostStaleProcessing(uncertain.scheduledPost.id)

    const database = createE2EDatabaseClient()
    try {
      await database.publicationAttempt.create({
        data: {
          attemptNumber: 1,
          organizationId,
          scheduledPostId: uncertain.scheduledPost.id,
        },
      })
      expect(
        await requestJson(
          page,
          '/api/internal/scheduled-posts/dispatch',
          {},
          'POST',
          getMaintenanceHeaders()
        )
      ).toMatchObject({ body: { dispatched: expect.any(Number) }, status: 200 })
      expect(provider.calls.map((call) => call.url)).toEqual([
        '/api/public/v1/me',
        '/api/public/v1/integrations',
        '/api/public/v1/me',
        '/api/public/v1/integrations',
        '/api/public/v1/upload',
        '/api/public/v1/posts',
      ])

      await requestJson(
        page,
        '/api/internal/scheduled-posts/dispatch',
        {},
        'POST',
        getMaintenanceHeaders()
      )

      const [recovered, stopped, audit] = await Promise.all([
        database.scheduledPost.findUnique({
          include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
          where: { id: unclaimed.scheduledPost.id },
        }),
        database.scheduledPost.findUnique({
          include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
          where: { id: uncertain.scheduledPost.id },
        }),
        database.auditLog.findFirst({
          where: {
            action: 'post.publish_recovery_required',
            entityId: uncertain.scheduledPost.id,
            organizationId,
          },
        }),
      ])
      expect(recovered).toMatchObject({
        attempts: [{ outcome: 'SUCCEEDED', providerPostId: 'published-post' }],
        status: 'PUBLISHED',
      })
      expect(stopped).toMatchObject({
        attempts: [{ failureCode: 'UNKNOWN_DELIVERY', outcome: 'FAILED' }],
        status: 'FAILED',
      })
      expect(audit).not.toBeNull()
    } finally {
      await database.$disconnect()
    }
    expect(postRequests(provider.calls)).toHaveLength(1)
  } finally {
    await provider.close()
    await unbindTestGoOrganization(boundOrganizationId)
  }
})

test('a removed Go organization binding fails a queued post before media upload', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const backend = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/me'
        ? { body: { organization: { id: `go-${organizationId}` } } }
        : request.url === '/api/public/v1/integrations'
          ? { body: [{ id: 'bound-x-destination', identifier: 'x', disabled: false }] }
          : { body: { error: 'Unexpected request.' }, status: 500 },
    5679
  )
  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await trpcMutation(page, 'channelConnection.create', {
          externalAccountId: 'bound-x-destination',
          platform: 'x',
          secretReference: e2eSecretReference,
        })
      ).body
    ).connection
    const post = await createScheduledPost(page, connection.id, 'binding-revoked', variantId)
    await makeScheduledPostDue(post.scheduledPost.id)
    await unbindTestGoOrganization(organizationId)
    const dispatched = await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(dispatched).toMatchObject({ body: { dispatched: 1 }, status: 200 })
    const database = createE2EDatabaseClient()
    try {
      expect(
        await database.scheduledPost.findUnique({
          select: { status: true },
          where: { id: post.scheduledPost.id },
        })
      ).toEqual({ status: 'FAILED' })
      expect(
        await database.publicationAttempt.findFirst({
          select: { failureCode: true, outcome: true },
          where: { scheduledPostId: post.scheduledPost.id },
        })
      ).toEqual({ failureCode: '403', outcome: 'FAILED' })
    } finally {
      await database.$disconnect()
    }
    expect(backend.calls.map((call) => call.url)).toEqual([
      '/api/public/v1/me',
      '/api/public/v1/integrations',
    ])
  } finally {
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('a Go destination disabled after scheduling fails before media upload', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  let disabled = false
  const backend = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/me'
        ? { body: { organization: { id: `go-${organizationId}` } } }
        : request.url === '/api/public/v1/integrations'
          ? { body: [{ id: 'disabled-x-destination', identifier: 'x', disabled }] }
          : { body: { error: 'Unexpected request.' }, status: 500 },
    5679
  )
  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await trpcMutation(page, 'channelConnection.create', {
          externalAccountId: 'disabled-x-destination',
          platform: 'x',
          secretReference: e2eSecretReference,
        })
      ).body
    ).connection
    const post = await createScheduledPost(page, connection.id, 'destination-disabled', variantId)
    await makeScheduledPostDue(post.scheduledPost.id)
    disabled = true
    expect(
      await requestJson(
        page,
        '/api/internal/scheduled-posts/dispatch',
        {},
        'POST',
        getMaintenanceHeaders()
      )
    ).toMatchObject({ body: { dispatched: 1 }, status: 200 })
    const database = createE2EDatabaseClient()
    try {
      expect(
        await database.scheduledPost.findUnique({
          select: { status: true },
          where: { id: post.scheduledPost.id },
        })
      ).toEqual({ status: 'FAILED' })
    } finally {
      await database.$disconnect()
    }
    expect(backend.calls.map((call) => call.url)).toEqual([
      '/api/public/v1/me',
      '/api/public/v1/integrations',
      '/api/public/v1/me',
      '/api/public/v1/integrations',
    ])
  } finally {
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('another workspace cannot attach or control a bound Go destination', async ({
  browser,
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const backend = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/me'
        ? { body: { organization: { id: `go-${organizationId}` } } }
        : request.url === '/api/public/v1/integrations'
          ? { body: [{ id: 'tenant-a-destination', identifier: 'x', disabled: false }] }
          : { body: { error: 'Unexpected request.' }, status: 500 },
    5679
  )
  const secondContext = await browser.newContext()
  try {
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    organizationId = await bindTestGoOrganization(page)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await trpcMutation(page, 'channelConnection.create', {
          externalAccountId: 'tenant-a-destination',
          platform: 'x',
          secretReference: e2eSecretReference,
        })
      ).body
    ).connection
    const post = await createScheduledPost(page, connection.id, 'tenant-a-post', variantId)
    const providerCallCount = backend.calls.length

    const secondPage = await secondContext.newPage()
    const secondIdentity = {
      ...identity,
      email: `foreign-${identity.email}`,
      workspaceName: `Foreign ${identity.workspaceName}`,
    }
    await createPublishingWorkspace(secondIdentity, secondPage)
    await enablePublishingTwoFactor(secondPage, secondIdentity.password)
    expect(
      (
        await trpcMutation(secondPage, 'channelConnection.create', {
          externalAccountId: 'tenant-a-destination',
          platform: 'x',
          secretReference: e2eSecretReference,
        })
      ).status
    ).toBe(409)
    expect(
      (
        await trpcMutation(secondPage, 'scheduledPost.create', {
          caption: 'A foreign post',
          channelConnectionId: connection.id,
          idempotencyKey: 'foreign-schedule',
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
          variantId,
        })
      ).status
    ).toBe(404)
    expect(
      (
        await trpcMutation(secondPage, 'scheduledPost.cancel', {
          scheduledPostId: post.scheduledPost.id,
        })
      ).status
    ).toBe(404)
    expect(backend.calls).toHaveLength(providerCallCount)
  } finally {
    await secondContext.close()
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('X OAuth start binds its one-use callback to the active workspace', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-x'
  const integrationId = 'go-x-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/x') {
      return {
        body: { url: `https://api.x.com/oauth/authenticate?oauth_token=${state}` },
      }
    }
    if (request.url === '/integrations/social-connect/x') {
      return { body: { id: integrationId, pages: [] } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'x', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)

  try {
    await createPublishingWorkspace(identity, page)
    organizationId = await getActiveOrganizationId(page)
    await enablePublishingTwoFactor(page, identity.password)

    const database = createE2EDatabaseClient()
    try {
      await database.postizTenantBinding.deleteMany({
        where: { secretReference: 'POSTIZ_API_KEY_E2E' },
      })
      await database.postizTenantBinding.create({
        data: {
          goOrganizationId: `go-${organizationId}`,
          organizationId,
          secretReference: 'POSTIZ_API_KEY_E2E',
        },
      })
    } finally {
      await database.$disconnect()
    }

    const start = await page
      .context()
      .request.get('http://localhost:3000/integrations/social/x/start', {
        maxRedirects: 0,
      })
    expect(start.status(), `${await start.text()} ${backend.calls.map((call) => call.url)}`).toBe(
      303
    )
    expect(start.headers().location).toBe(
      `https://api.x.com/oauth/authenticate?oauth_token=${state}`
    )

    await page.goto(`/integrations/social/x?oauth_token=${state}&oauth_verifier=test-verifier`)
    await expect(page.getByText('x connected to Screenshot Studio Backend.')).toBeVisible()

    const verifier = createE2EDatabaseClient()
    try {
      const connection = await verifier.channelConnection.findFirst({
        where: { externalAccountId: integrationId, organizationId },
      })
      expect(connection?.platform).toBe('x')
      expect(connection?.secretReference).toBe('POSTIZ_API_KEY_E2E')
      expect(await verifier.socialOAuthStart.findUnique({ where: { state } })).toBeNull()
    } finally {
      await verifier.$disconnect()
    }

    const callsBeforeReplay = backend.calls.length
    const replay = await page
      .context()
      .request.get(
        `http://localhost:3000/integrations/social/x?oauth_token=${state}&oauth_verifier=test-verifier`
      )
    expect(replay.status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    const database = createE2EDatabaseClient()
    try {
      await database.socialOAuthStart.deleteMany({ where: { state } })
      if (organizationId) {
        await database.postizTenantBinding.deleteMany({
          where: { organizationId, secretReference: 'POSTIZ_API_KEY_E2E' },
        })
      }
    } finally {
      await database.$disconnect()
    }
    await backend.close()
  }
})

test('Instagram with Facebook Login registers the selected Page once', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-instagram'
  const integrationId = 'go-instagram-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/instagram') {
      return {
        body: { url: `https://www.facebook.com/v24.0/dialog/oauth?state=${state}` },
      }
    }
    if (request.url === '/integrations/social-connect/instagram') {
      return {
        body: {
          id: integrationId,
          pages: [
            { id: 'instagram-test-account', name: 'Test Page', pageId: 'facebook-test-page' },
          ],
        },
      }
    }
    if (request.url === `/integrations/public/provider/${integrationId}/connect`) {
      return { body: { success: true } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'instagram', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)
  try {
    await createPublishingWorkspace(identity, page)
    organizationId = await bindTestGoOrganization(page)
    await enablePublishingTwoFactor(page, identity.password)

    const start = await page
      .context()
      .request.get(getE2EUrl('/integrations/social/instagram/start'), {
        maxRedirects: 0,
      })
    expect(start.status(), `${await start.text()} ${backend.calls.map((call) => call.url)}`).toBe(
      303
    )
    expect(start.headers().location).toBe(
      `https://www.facebook.com/v24.0/dialog/oauth?state=${state}`
    )

    const callbackURL = getE2EUrl(`/integrations/social/instagram?code=test-code&state=${state}`)
    const picker = await page.context().request.get(callbackURL)
    expect(picker.status()).toBe(200)
    const choice = (await picker.text()).match(/name="choice" value="([^"]+)"/)?.[1]
    expect(choice).toBeTruthy()
    const selection = await page.context().request.post(callbackURL, {
      form: { choice: choice as string },
      headers: { origin: new URL(getE2EUrl('/')).origin },
    })
    expect(selection.status()).toBe(200)

    const database = createE2EDatabaseClient()
    try {
      expect(
        await database.channelConnection.findFirst({
          select: { platform: true, secretReference: true },
          where: { externalAccountId: integrationId, organizationId },
        })
      ).toEqual({ platform: 'instagram', secretReference: e2eSecretReference })
      expect(await database.socialOAuthStart.findUnique({ where: { state } })).toBeNull()
    } finally {
      await database.$disconnect()
    }

    const callsBeforeReplay = backend.calls.length
    const replay = await page.context().request.post(callbackURL, {
      form: { choice: choice as string },
      headers: { origin: new URL(getE2EUrl('/')).origin },
    })
    expect(replay.status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    const database = createE2EDatabaseClient()
    try {
      await database.socialOAuthStart.deleteMany({ where: { state } })
    } finally {
      await database.$disconnect()
    }
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

test('Instagram Login registers its destination after a one-use callback', async ({
  identity,
  page,
}) => {
  let organizationId: string | null = null
  const state = 'oauth-state-for-instagram-login'
  const integrationId = 'go-instagram-login-test-integration'
  const backend = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/social/instagram-standalone') {
      return { body: { url: `https://www.instagram.com/oauth/authorize?state=${state}` } }
    }
    if (request.url === '/integrations/social-connect/instagram-standalone') {
      return { body: { id: integrationId, pages: [] } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return { body: [{ id: integrationId, identifier: 'instagram-standalone', disabled: false }] }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)
  try {
    await createPublishingWorkspace(identity, page)
    organizationId = await bindTestGoOrganization(page)
    await enablePublishingTwoFactor(page, identity.password)

    const start = await page
      .context()
      .request.get(getE2EUrl('/integrations/social/instagram-standalone/start'), {
        maxRedirects: 0,
      })
    expect(start.status(), `${await start.text()} ${backend.calls.map((call) => call.url)}`).toBe(
      303
    )
    expect(start.headers().location).toBe(
      `https://www.instagram.com/oauth/authorize?state=${state}`
    )

    const callbackURL = getE2EUrl(
      `/integrations/social/instagram-standalone?code=test-code&state=${state}`
    )
    const callback = await page.context().request.get(callbackURL)
    expect(callback.status()).toBe(200)
    const database = createE2EDatabaseClient()
    try {
      expect(
        await database.channelConnection.findFirst({
          select: { platform: true, secretReference: true },
          where: { externalAccountId: integrationId, organizationId },
        })
      ).toEqual({ platform: 'instagram-standalone', secretReference: e2eSecretReference })
      expect(await database.socialOAuthStart.findUnique({ where: { state } })).toBeNull()
    } finally {
      await database.$disconnect()
    }
    const callsBeforeReplay = backend.calls.length
    expect((await page.context().request.get(callbackURL)).status()).toBe(403)
    expect(backend.calls).toHaveLength(callsBeforeReplay)
  } finally {
    const database = createE2EDatabaseClient()
    try {
      await database.socialOAuthStart.deleteMany({ where: { state } })
    } finally {
      await database.$disconnect()
    }
    await unbindTestGoOrganization(organizationId)
    await backend.close()
  }
})

if (process.env.E2E_SOCIAL_GATE_BOOTSTRAP) {
  test('the real Go worker handles private media, retries, cancellation, and expired credentials', async ({
    identity,
    page,
  }) => {
    test.setTimeout(10 * 60_000)
    const bootstrap = z
      .object({
        apiKey: z.string().min(1),
        destinationId: z.string().min(1),
        expiredDestinationId: z.string().min(1),
        goOrganizationId: z.string().min(1),
      })
      .parse(JSON.parse(await readFile(process.env.E2E_SOCIAL_GATE_BOOTSTRAP!, 'utf8')))
    const fakeURL = process.env.E2E_SOCIAL_GATE_FAKE_URL ?? 'http://127.0.0.1:5680'
    const fakeState = async () =>
      z
        .object({
          posts: z.array(
            z.object({
              caption: z.string(),
              id: z.string(),
              media: z.array(
                z.object({
                  bytes: z.number(),
                  expires: z.string(),
                  sha256: z.string(),
                  signedAt: z.string(),
                })
              ),
            })
          ),
          requests: z.number(),
        })
        .parse(await (await fetch(`${fakeURL}/state`)).json())
    const reset = async (mode: 'normal' | 'throttle-once' | 'server-error-once') => {
      const response = await fetch(`${fakeURL}/control`, {
        body: JSON.stringify({ mode }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      expect(response.status).toBe(200)
    }
    await reset('normal')
    await createPublishingWorkspace(identity, page)
    await enablePublishingTwoFactor(page, identity.password)
    const organizationId = await getActiveOrganizationId(page)
    const database = createE2EDatabaseClient()
    try {
      const dispatch = async () => {
        const response = await requestJson(
          page,
          '/api/internal/scheduled-posts/dispatch',
          {},
          'POST',
          getMaintenanceHeaders()
        )
        expect(response.status).toBe(200)
      }
      const awaitStatus = async (id: string, status: string) => {
        await expect
          .poll(
            async () => {
              await dispatch()
              return (await database.scheduledPost.findUnique({ where: { id } }))?.status
            },
            { timeout: 120_000 }
          )
          .toBe(status)
      }
      await database.postizTenantBinding.create({
        data: {
          goOrganizationId: bootstrap.goOrganizationId,
          organizationId,
          secretReference: 'POSTIZ_API_KEY_SOCIAL_GATE',
        },
      })
      const variantId = await createApprovedVariant(page)
      const connection = await trpcMutation(page, 'channelConnection.create', {
        externalAccountId: bootstrap.destinationId,
        platform: 'e2e',
        secretReference: 'POSTIZ_API_KEY_SOCIAL_GATE',
      })
      expect(connection.status, JSON.stringify(connection.body)).toBe(200)
      const connectionId = connectionSchema.parse(connection.body).connection.id
      const futureTime = new Date(Date.now() + 25 * 60 * 60_000)
      const first = await createScheduledPost(
        page,
        connectionId,
        'social-gate-success',
        variantId,
        futureTime
      )
      expect(first.response.status).toBe(200)
      expect(first.scheduledPost.status).toBe('SCHEDULED')
      const duplicate = await createScheduledPost(
        page,
        connectionId,
        'social-gate-success',
        variantId
      )
      expect(duplicate.scheduledPost.id).toBe(first.scheduledPost.id)
      expect((await fakeState()).posts).toHaveLength(0)

      await makeScheduledPostDue(first.scheduledPost.id)
      const publicationStart = Date.now()
      await dispatch()
      await dispatch()
      await expect.poll(async () => (await fakeState()).posts.length, { timeout: 120_000 }).toBe(1)
      await awaitStatus(first.scheduledPost.id, 'PUBLISHED')
      await dispatch()

      const remote = await fakeState()
      expect(remote.requests).toBe(1)
      expect(remote.posts).toHaveLength(1)
      expect(remote.posts[0]).toMatchObject({
        caption: 'The launch is ready.',
        media: [
          {
            bytes: png.length,
            expires: '86400',
            sha256: createHash('sha256').update(png).digest('hex'),
          },
        ],
      })
      expect(remote.posts[0]?.media[0]?.signedAt).toMatch(/^\d{8}T\d{6}Z$/)
      const signedAt = remote.posts[0]?.media[0]?.signedAt
      const signedAtMilliseconds = Date.parse(
        `${signedAt?.slice(0, 4)}-${signedAt?.slice(4, 6)}-${signedAt?.slice(6, 8)}T${signedAt?.slice(9, 11)}:${signedAt?.slice(11, 13)}:${signedAt?.slice(13, 15)}Z`
      )
      expect(signedAtMilliseconds).toBeGreaterThanOrEqual(publicationStart - 120_000)
      expect(signedAtMilliseconds).toBeLessThanOrEqual(Date.now() + 120_000)
      const published = await database.scheduledPost.findUnique({
        include: { attempts: true },
        where: { id: first.scheduledPost.id },
      })
      expect(published?.attempts).toHaveLength(1)
      expect(published?.attempts[0]).toMatchObject({ outcome: 'SUCCEEDED' })
      const goPostId = z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .parse(published?.attempts[0]?.providerPostId)
      const goReceipt = await fetch(`http://127.0.0.1:3110/public/v1/posts/${goPostId}/status`, {
        headers: { Authorization: bootstrap.apiKey },
      })
      expect(goReceipt.status).toBe(200)
      expect(await goReceipt.json()).toMatchObject({
        releaseId: remote.posts[0]?.id,
        state: 'PUBLISHED',
      })
      // The Go database keeps the stable private object path, never the expiring signature.
      const sql = `SELECT "image" FROM "Post" WHERE id = '${goPostId}'`
      const storedImage = execFileSync(
        'docker',
        [
          'compose',
          '--env-file',
          '.local/dev.env',
          '--file',
          'compose.social-gate.yaml',
          '--project-name',
          'screenshot-studio-social-gate',
          'exec',
          '-T',
          'postiz-go-db',
          'psql',
          '-U',
          'postiz_go',
          '-d',
          'postiz_go',
          '-Atc',
          sql,
        ],
        { encoding: 'utf8' }
      )
      expect(storedImage).toContain('rustfs:9000')
      expect(storedImage).not.toContain('X-Amz-Signature')
      expect(storedImage).not.toContain('X-Amz-Expires')
      const storedMedia = z
        .array(z.object({ path: z.string().url() }))
        .parse(JSON.parse(storedImage))
      expect(storedMedia).toHaveLength(1)
      const unsignedURL = new URL(storedMedia[0].path)
      unsignedURL.hostname = '127.0.0.1'
      unsignedURL.port = '9003'
      expect((await fetch(unsignedURL)).status).toBe(403)

      const cancelled = await createScheduledPost(
        page,
        connectionId,
        'social-gate-cancelled',
        variantId
      )
      expect(cancelled.response.status).toBe(200)
      expect(
        await trpcMutation(page, 'scheduledPost.cancel', {
          scheduledPostId: cancelled.scheduledPost.id,
        })
      ).toMatchObject({ body: { scheduledPost: { status: 'CANCELLED' } }, status: 200 })
      await makeScheduledPostDue(cancelled.scheduledPost.id)
      await dispatch()
      expect((await fakeState()).requests).toBe(1)

      for (const mode of ['throttle-once', 'server-error-once'] as const) {
        await reset(mode)
        const retry = await createScheduledPost(
          page,
          connectionId,
          `social-gate-${mode}`,
          variantId
        )
        expect(retry.response.status).toBe(200)
        await makeScheduledPostDue(retry.scheduledPost.id)
        await dispatch()
        await expect
          .poll(async () => (await fakeState()).posts.length, { timeout: 120_000 })
          .toBe(1)
        await awaitStatus(retry.scheduledPost.id, 'PUBLISHED')
        const retryState = await fakeState()
        expect(retryState.requests).toBe(2)
        expect(retryState.posts).toHaveLength(1)
        const retryResult = await database.scheduledPost.findUnique({
          include: { attempts: true },
          where: { id: retry.scheduledPost.id },
        })
        expect(retryResult?.attempts).toHaveLength(1)
        expect(retryResult?.attempts[0]?.outcome).toBe('SUCCEEDED')
      }

      await reset('normal')
      const expiredConnection = await trpcMutation(page, 'channelConnection.create', {
        externalAccountId: bootstrap.expiredDestinationId,
        platform: 'e2e',
        secretReference: 'POSTIZ_API_KEY_SOCIAL_GATE',
      })
      expect(expiredConnection.status, JSON.stringify(expiredConnection.body)).toBe(200)
      const expiredId = connectionSchema.parse(expiredConnection.body).connection.id
      const expired = await createScheduledPost(page, expiredId, 'social-gate-expired', variantId)
      expect(expired.response.status).toBe(200)
      await makeScheduledPostDue(expired.scheduledPost.id)
      await awaitStatus(expired.scheduledPost.id, 'FAILED')
      expect((await fakeState()).posts).toHaveLength(0)
      const expiredResult = await database.scheduledPost.findUnique({
        include: { attempts: true },
        where: { id: expired.scheduledPost.id },
      })
      expect(expiredResult?.attempts.some((attempt) => attempt.outcome === 'FAILED')).toBe(true)
    } finally {
      await database.postizTenantBinding.deleteMany({ where: { organizationId } })
      await database.$disconnect()
    }
  })
}
