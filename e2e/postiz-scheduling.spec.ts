import { createHash } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import {
  enableTwoFactor,
  getActiveOrganizationId,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { requestJson, uploadSignedAsset } from './framework/browser'
import { configureE2EFlow, test } from './framework/flow'
import { startHttpMockServer, type HttpMockRequest } from './framework/http-server'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabaseClient } from './framework/services'

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
  const kitResponse = await requestJson(page, '/api/tenant/brand-kits', {
    definition: { accent: '#7047eb' },
    name: 'Launch brand',
    publish: true,
  })
  expect(kitResponse.status).toBe(201)
  const brandKit = brandKitSchema.parse(kitResponse.body).brandKit
  const releaseResponse = await requestJson(page, '/api/tenant/releases', {
    benefitStatement: 'Ship the launch update.',
    title: 'Launch update',
  })
  expect(releaseResponse.status).toBe(201)
  const releaseId = releaseSchema.parse(releaseResponse.body).release.id
  const templateResponse = await requestJson(page, '/api/tenant/creative-templates', {
    definition: { layout: 'social' },
    name: `Launch template ${releaseId}`,
  })
  expect(templateResponse.status).toBe(201)
  const template = creativeTemplateSchema.parse(templateResponse.body).template
  const variantResponse = await requestJson(page, '/api/tenant/creative-variants', {
    aspectRatio: '1:1',
    brandKitId: brandKit.id,
    releaseId,
    sourceAssetId: assetId,
    templateId: template.id,
  })
  expect(variantResponse.status, JSON.stringify(variantResponse.body)).toBe(201)
  const variant = creativeVariantSchema.parse(variantResponse.body).variant
  const approvalResponse = await requestJson(
    page,
    `/api/tenant/creative-variants/${variant.id}/approval`,
    { status: 'APPROVED' },
    'POST'
  )
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
  variantId: string
) {
  const response = await requestJson(
    page,
    '/api/tenant/scheduled-posts',
    {
      caption: 'The launch is ready.',
      channelConnectionId,
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
      variantId,
    },
    'POST',
    { 'idempotency-key': idempotencyKey }
  )
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
  const provider = await startHttpMockServer((request) => {
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
        : { body: { id: `post-${postAttempts}` }, status: 201 }
    }
    return { body: { error: 'Not found.' }, status: 404 }
  }, 5679)

  try {
    await signUpAndCreateWorkspace(identity, page)
    await enableTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const connectionResponse = await requestJson(page, '/api/tenant/channel-connections', {
      externalAccountId: 'postiz-x-integration',
      platform: 'x',
      providerSettings: { who_can_reply_post: 'everyone' },
    })
    expect(connectionResponse.status).toBe(201)
    const connectionId = connectionSchema.parse(connectionResponse.body).connection.id

    const first = await createScheduledPost(page, connectionId, 'postiz-launch', variantId)
    expect(first.response.status).toBe(201)
    const duplicate = await createScheduledPost(page, connectionId, 'postiz-launch', variantId)
    expect(duplicate.response.status).toBe(200)
    expect(duplicate.scheduledPost.id).toBe(first.scheduledPost.id)
    await makeScheduledPostDue(first.scheduledPost.id)

    const firstDispatch = await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(firstDispatch).toMatchObject({ body: { dispatched: 1 }, status: 200 })
    const secondDispatch = await requestJson(
      page,
      '/api/internal/scheduled-posts/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(secondDispatch).toMatchObject({ body: { dispatched: 1 }, status: 200 })

    const database = createE2EDatabaseClient()
    try {
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
    expect(cancelled.response.status).toBe(201)
    const cancelResponse = await requestJson(
      page,
      `/api/tenant/scheduled-posts/${cancelled.scheduledPost.id}/cancel`,
      {}
    )
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
  } finally {
    await provider.close()
  }
})

test('a queued post is cancelled when its approval or destination is revoked before dispatch', async ({
  identity,
  page,
}) => {
  const provider = await startHttpMockServer(
    (request) => ({
      body: { id: request.url === '/api/public/v1/upload' ? 'media' : 'post' },
      status: 201,
    }),
    5679
  )

  try {
    await signUpAndCreateWorkspace(identity, page)
    await enableTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await requestJson(page, '/api/tenant/channel-connections', {
          externalAccountId: 'revocation-integration',
          platform: 'x',
          providerSettings: {},
        })
      ).body
    ).connection
    const connectionRevoked = await createScheduledPost(
      page,
      connection.id,
      'postiz-connection-revoked',
      variantId
    )
    expect(connectionRevoked.response.status).toBe(201)
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
      expect(approvalRevoked.response.status).toBe(201)
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
  }
})

test('a worker recovers an unclaimed post and does not retry uncertain delivery', async ({
  identity,
  page,
}) => {
  const provider = await startHttpMockServer(
    (request) =>
      request.url === '/api/public/v1/upload'
        ? { body: { id: 'media', path: 'https://postiz.test/media.png' }, status: 201 }
        : { body: { id: 'published-post' }, status: 201 },
    5679
  )

  try {
    await signUpAndCreateWorkspace(identity, page)
    const organizationId = await getActiveOrganizationId(page)
    await enableTwoFactor(page, identity.password)
    const variantId = await createApprovedVariant(page)
    const connection = connectionSchema.parse(
      (
        await requestJson(page, '/api/tenant/channel-connections', {
          externalAccountId: 'recovery-integration',
          platform: 'x',
          providerSettings: {},
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
        '/api/public/v1/upload',
        '/api/public/v1/posts',
      ])

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
  }
})
