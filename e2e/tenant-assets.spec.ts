import { createHash } from 'node:crypto'
import { type Browser, expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { signUpAndCreateWorkspace } from './framework/auth'
import {
  browserRequest,
  downloadSignedAsset,
  requestJson,
  uploadSignedAsset,
} from './framework/browser'
import { configureE2EFlow, test, type E2EIdentity } from './framework/flow'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabaseClient, grantWorkspacePlan } from './framework/services'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL6fQAAAABJRU5ErkJggg==',
  'base64'
)
const signedAssetSchema = z.object({
  asset: z.object({ id: z.string().uuid(), status: z.string() }),
  uploadUrl: z.string().url(),
})
const completedAssetSchema = z.object({
  asset: z.object({ id: z.string().uuid(), status: z.string() }),
})
const downloadSchema = z.object({ downloadUrl: z.string().url() })
type AssetRequest = {
  bytes: number
  classification: 'input'
  contentType: 'image/png'
  fileName: string
  sha256: string
}
type CrossTenantInput = {
  browser: Browser
  downloadUrl: string
  identity: E2EIdentity
  request: AssetRequest
  signed: z.infer<typeof signedAssetSchema>
}

function getSignedUrlLifetime(url: string): number {
  const token = new URL(url).searchParams.get('token')
  if (!token) {
    throw new Error('The signed URL did not contain a token.')
  }

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
    exp: number
    iat: number
  }
  return payload.exp - payload.iat
}

async function signAsset(page: Page, request: AssetRequest) {
  return signedAssetSchema.parse(
    (await requestJson(page, '/api/tenant/assets/upload-url', request)).body
  )
}

async function assertCrossTenantIsolation({
  browser,
  downloadUrl,
  identity,
  request,
  signed,
}: CrossTenantInput): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await signUpAndCreateWorkspace(
      {
        ...identity,
        email: `other-${identity.email}`,
        workspaceName: `Other ${identity.workspaceName}`,
      },
      page
    )
    const [download, completion, deletion, upload, read, invalid, oversized, unsafe] =
      await Promise.all([
        browserRequest(page, `/api/tenant/assets/${signed.asset.id}/download-url`),
        requestJson(page, `/api/tenant/assets/${signed.asset.id}/complete`, {}),
        requestJson(page, `/api/tenant/assets/${signed.asset.id}`, {}, 'DELETE'),
        uploadSignedAsset(page, signed.uploadUrl, [...png], request.contentType),
        downloadSignedAsset(page, downloadUrl),
        requestJson(page, '/api/tenant/assets/upload-url', {
          ...request,
          contentType: 'text/plain',
        }),
        requestJson(page, '/api/tenant/assets/upload-url', {
          ...request,
          bytes: 50 * 1024 * 1024 + 1,
        }),
        requestJson(page, '/api/tenant/assets/upload-url', {
          ...request,
          fileName: '../unsafe.png',
        }),
      ])
    expect(download.status).toBe(404)
    expect(completion.status).toBe(404)
    expect(deletion.status).toBe(404)
    expect(upload).toBe(403)
    expect(read.status).toBe(403)
    expect(invalid.status).toBe(400)
    expect(oversized.status).toBe(400)
    expect(unsafe.status).toBe(400)
  } finally {
    await context.close()
  }
}

async function dispatchAssetDeletion(page: Page, assetId: string): Promise<void> {
  const database = createE2EDatabaseClient()
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (
          await requestJson(
            page,
            '/api/internal/tenant-outbox/dispatch',
            {},
            'POST',
            getMaintenanceHeaders()
          )
        ).status
      ).toBe(200)
      const event = await database.outboxEvent.findFirst({
        select: { deliveredAt: true },
        where: { aggregateId: assetId, type: 'asset.deleted' },
      })
      if (event?.deliveredAt) return
    }
  } finally {
    await database.$disconnect()
  }
  throw new Error('The asset deletion event was not dispatched.')
}

configureE2EFlow()

test('an uploaded asset stays private to its workspace through completion and download', async ({
  browser,
  identity,
  page,
}) => {
  const organizationId = await signUpAndCreateWorkspace(identity, page)
  const sha256 = createHash('sha256').update(png).digest('hex')
  const request: AssetRequest = {
    bytes: png.byteLength,
    classification: 'input',
    contentType: 'image/png',
    fileName: 'product.png',
    sha256,
  }
  const signed = await signAsset(page, request)
  const duplicate = await signAsset(page, request)
  const interrupted = await signAsset(page, request)

  expect(duplicate.asset.id).not.toBe(signed.asset.id)
  expect(duplicate.uploadUrl).not.toBe(signed.uploadUrl)
  expect(getSignedUrlLifetime(signed.uploadUrl)).toBeLessThanOrEqual(120)
  expect(
    (
      await requestJson(page, `/api/tenant/assets/${interrupted.asset.id}/complete`, {
        sha256,
      })
    ).status
  ).toBe(400)
  expect(await uploadSignedAsset(page, signed.uploadUrl, [...png], request.contentType)).toBe(200)
  const completed = completedAssetSchema.parse(
    (await requestJson(page, `/api/tenant/assets/${signed.asset.id}/complete`, { sha256 })).body
  )
  expect(completed.asset.status).toBe('UPLOADED')

  const download = downloadSchema.parse(
    (await browserRequest(page, `/api/tenant/assets/${signed.asset.id}/download-url`)).body
  )
  await expect(downloadSignedAsset(page, download.downloadUrl)).resolves.toEqual({
    bytes: png.byteLength,
    status: 200,
  })

  await assertCrossTenantIsolation({
    browser,
    downloadUrl: download.downloadUrl,
    identity,
    request,
    signed,
  })

  // Deleting an asset is a paid capability (RFC 034: `asset:delete` needs Pro
  // or an explicit contract override), and workspaces start on `free`. Assert
  // the rejection first so the gate is covered, then grant the plan the way
  // billing would, so the rest of the deletion lifecycle can be exercised at
  // all. Ownership resolves before the plan check, so this 403 proves the
  // caller owns the asset rather than leaking that some other workspace does.
  expect(
    await requestJson(page, `/api/tenant/assets/${signed.asset.id}`, {}, 'DELETE')
  ).toMatchObject({
    body: { code: 'workspace_feature_not_entitled', feature: 'asset:delete' },
    status: 403,
  })
  await grantWorkspacePlan(organizationId, 'pro')

  expect(
    await requestJson(page, `/api/tenant/assets/${signed.asset.id}`, {}, 'DELETE')
  ).toMatchObject({ body: { accepted: true }, status: 202 })
  expect(
    (await browserRequest(page, `/api/tenant/assets/${signed.asset.id}/download-url`)).status
  ).toBe(404)
  await dispatchAssetDeletion(page, signed.asset.id)
  expect([400, 403, 404]).toContain((await downloadSignedAsset(page, download.downloadUrl)).status)

  const database = createE2EDatabaseClient()
  try {
    expect(
      await database.asset.findUniqueOrThrow({ where: { id: signed.asset.id } })
    ).toMatchObject({ status: 'DELETED' })
    expect(
      await database.outboxEvent.findFirst({
        where: { aggregateId: signed.asset.id, type: 'asset.deleted' },
      })
    ).toMatchObject({ deliveredAt: expect.any(Date) })
  } finally {
    await database.$disconnect()
  }
})

test('a signed asset download URL expires at the storage boundary', async ({ identity, page }) => {
  test.slow()
  await signUpAndCreateWorkspace(identity, page)
  const sha256 = createHash('sha256').update(png).digest('hex')
  const signed = await signAsset(page, {
    bytes: png.byteLength,
    classification: 'input',
    contentType: 'image/png',
    fileName: 'expiring-product.png',
    sha256,
  })
  expect(await uploadSignedAsset(page, signed.uploadUrl, [...png], 'image/png')).toBe(200)
  expect(
    (
      await requestJson(page, `/api/tenant/assets/${signed.asset.id}/complete`, {
        sha256,
      })
    ).status
  ).toBe(200)
  const downloadUrl = downloadSchema.parse(
    (await browserRequest(page, `/api/tenant/assets/${signed.asset.id}/download-url`)).body
  ).downloadUrl

  await page.waitForTimeout(122_000)
  expect([400, 401, 403]).toContain((await downloadSignedAsset(page, downloadUrl)).status)
})
