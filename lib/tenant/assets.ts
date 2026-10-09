import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import { requireWorkspaceFeature, requireWorkspaceQuotaCapacity } from '@/lib/tenant/entitlements'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import {
  assertTenantObjectExists,
  buildTenantObjectKey,
  createTenantDownloadUrl,
  createTenantUploadUrl,
  writeTenantObject,
} from '@/lib/storage/client'
import type { AssetClassification } from './object-key'
import type { AssetUploadInput } from './schemas'

const signedUrlSeconds = 120

export type AssetDeletionResult = 'deleted' | 'in-use' | 'not-found' | 'not-ready'

export async function signAssetUpload(context: TenantContext, input: AssetUploadInput) {
  const storage = await prisma.asset.aggregate({
    _sum: { bytes: true },
    where: { organizationId: context.organizationId, status: { not: 'DELETED' } },
  })
  await requireWorkspaceQuotaCapacity(
    context.organizationId,
    'storage:bytes',
    storage._sum.bytes ?? 0,
    input.bytes
  )
  const assetId = randomUUID()
  const signedUpload = await createTenantUploadUrl({
    ...input,
    assetId,
    organizationId: context.organizationId,
    revision: 1,
  })
  const asset = await prisma.$transaction(async (transaction) => {
    const createdAsset = await transaction.asset.create({
      data: {
        bytes: input.bytes,
        id: assetId,
        mediaType: input.contentType,
        objectKey: signedUpload.objectKey,
        organizationId: context.organizationId,
        sha256: input.sha256,
      },
      select: { id: true, objectKey: true, status: true },
    })
    await appendAuditLog(transaction, {
      action: 'product.asset_upload_signed',
      actor: getAuditActor(context.principal),
      entityId: createdAsset.id,
      entityType: 'asset',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return createdAsset
  })
  return { asset, uploadUrl: signedUpload.uploadUrl }
}

async function findTenantAsset(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  assetId: string
) {
  return transaction.asset.findFirst({ where: { id: assetId, organizationId } })
}

async function claimAssetUpload(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  assetId: string,
  sha256: string | undefined
): Promise<boolean> {
  const updated = await transaction.asset.updateMany({
    data: { sha256, status: 'UPLOADED' },
    where: { id: assetId, organizationId: context.organizationId, status: 'PENDING' },
  })
  return updated.count === 1
}

async function enqueueAssetUpload(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  assetId: string
): Promise<void> {
  const idempotencyKey = `asset.uploaded:${assetId}`
  await transaction.outboxEvent.upsert({
    create: {
      aggregateId: assetId,
      aggregateType: 'asset',
      idempotencyKey,
      organizationId,
      payload: { assetId },
      type: 'asset.uploaded',
    },
    update: {},
    where: { organizationId_idempotencyKey: { idempotencyKey, organizationId } },
  })
}

async function auditAssetUpload(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  assetId: string
): Promise<void> {
  await appendAuditLog(transaction, {
    action: 'product.asset_uploaded',
    actor: getAuditActor(context.principal),
    entityId: assetId,
    entityType: 'asset',
    organizationId: context.organizationId,
    requestId: context.requestId,
  })
}

async function enqueueAssetDeletion(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  assetId: string
): Promise<void> {
  const idempotencyKey = `asset.deleted:${assetId}`
  await transaction.outboxEvent.upsert({
    create: {
      aggregateId: assetId,
      aggregateType: 'asset',
      idempotencyKey,
      organizationId,
      payload: { assetId },
      type: 'asset.deleted',
    },
    update: {},
    where: { organizationId_idempotencyKey: { idempotencyKey, organizationId } },
  })
}

async function completeAssetInTransaction(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  assetId: string,
  sha256?: string
) {
  const asset = await findTenantAsset(transaction, context.organizationId, assetId)
  if (!asset || asset.status === 'UPLOADED') {
    return asset
  }
  if (
    !(await claimAssetUpload(transaction, context, asset.id, sha256 ?? asset.sha256 ?? undefined))
  ) {
    return findTenantAsset(transaction, context.organizationId, asset.id)
  }

  const completedAsset = await findTenantAsset(transaction, context.organizationId, asset.id)
  if (!completedAsset) {
    throw new Error('The completed asset could not be loaded.')
  }

  await enqueueAssetUpload(transaction, context.organizationId, asset.id)
  await auditAssetUpload(transaction, context, asset.id)
  return completedAsset
}

export async function completeAssetUpload(
  context: TenantContext,
  assetId: string,
  sha256?: string
) {
  const asset = await prisma.asset.findFirst({
    select: { id: true, objectKey: true, status: true },
    where: { id: assetId, organizationId: context.organizationId },
  })
  if (!asset || asset.status === 'UPLOADED') {
    return asset
  }

  await assertTenantObjectExists({
    objectKey: asset.objectKey,
    organizationId: context.organizationId,
  })
  return prisma.$transaction((transaction) =>
    completeAssetInTransaction(transaction, context, assetId, sha256)
  )
}

export async function signAssetDownload(
  context: TenantContext,
  assetId: string
): Promise<string | null> {
  const asset = await prisma.asset.findFirst({
    select: { objectKey: true },
    where: { id: assetId, organizationId: context.organizationId, status: 'UPLOADED' },
  })
  if (!asset) {
    return null
  }

  return createTenantDownloadUrl({
    expiresIn: signedUrlSeconds,
    objectKey: asset.objectKey,
    organizationId: context.organizationId,
  })
}

/**
 * List a tenant's assets, newest first.
 *
 * Only uploaded assets are returned. A pending row exists from the moment
 * an upload is signed, so including them would show entries whose bytes
 * may never arrive, and whose download URL would fail.
 *
 * Pagination is by cursor rather than offset, because assets are ordered
 * by creation and new ones arrive at the front. An offset would shift
 * under the reader and silently repeat or skip rows.
 */
export async function listAssets(
  organizationId: string,
  options: { cursor?: string; take: number }
) {
  const assets = await prisma.asset.findMany({
    // The tiebreak on id keeps the order total, so a cursor cannot stall
    // on rows sharing a timestamp.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      bytes: true,
      createdAt: true,
      height: true,
      id: true,
      mediaType: true,
      width: true,
    },
    // Read one beyond the page to learn whether another page exists
    // without issuing a second count query.
    take: options.take + 1,
    where: { organizationId, status: 'UPLOADED' },
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })

  const hasMore = assets.length > options.take
  const page = hasMore ? assets.slice(0, options.take) : assets

  return { assets: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null }
}

export async function deleteAsset(
  context: TenantContext,
  assetId: string
): Promise<AssetDeletionResult> {
  // Resolve ownership before the plan gate. A workspace that cannot see the
  // asset must get 'not-found', never an entitlement error, because a 403
  // would confirm that an asset with this id exists in another workspace.
  const owned = await prisma.asset.findFirst({
    select: { id: true },
    where: { id: assetId, organizationId: context.organizationId, status: { not: 'DELETED' } },
  })
  if (!owned) return 'not-found'
  await requireWorkspaceFeature(context.organizationId, 'asset:delete')

  return prisma.$transaction(async (transaction) => {
    const asset = await transaction.asset.findFirst({
      select: { id: true, status: true },
      where: { id: assetId, organizationId: context.organizationId },
    })
    if (!asset || asset.status === 'DELETED') return 'not-found'
    if (asset.status !== 'UPLOADED') return 'not-ready'

    const variantCount = await transaction.creativeVariant.count({
      where: { organizationId: context.organizationId, sourceAssetId: asset.id },
    })
    if (variantCount > 0) return 'in-use'

    await transaction.asset.update({
      data: { status: 'DELETED' },
      where: { id: asset.id },
    })
    await transaction.outboxEvent.deleteMany({
      where: { aggregateId: asset.id, aggregateType: 'asset', deliveredAt: null },
    })
    await enqueueAssetDeletion(transaction, context.organizationId, asset.id)
    await appendAuditLog(transaction, {
      action: 'product.asset_deletion_requested',
      actor: getAuditActor(context.principal),
      entityId: asset.id,
      entityType: 'asset',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return 'deleted'
  })
}

/**
 * Store an image generated on the server (capture or composite) as an
 * UPLOADED tenant asset. Mirrors a completed browser upload: storage quota,
 * the asset.uploaded outbox event, and an audit entry all still apply.
 */
export async function storeGeneratedAsset(
  context: TenantContext,
  input: {
    body: Uint8Array
    classification: AssetClassification
    contentType: 'image/jpeg' | 'image/png' | 'image/webp'
    fileName: string
    height: number
    parentAssetId?: string
    width: number
  }
) {
  const storage = await prisma.asset.aggregate({
    _sum: { bytes: true },
    where: { organizationId: context.organizationId, status: { not: 'DELETED' } },
  })
  await requireWorkspaceQuotaCapacity(
    context.organizationId,
    'storage:bytes',
    storage._sum.bytes ?? 0,
    input.body.byteLength
  )
  const assetId = randomUUID()
  const objectKey = buildTenantObjectKey({
    assetId,
    classification: input.classification,
    fileName: input.fileName,
    organizationId: context.organizationId,
    revision: 1,
  })
  await writeTenantObject({
    body: input.body,
    contentType: input.contentType,
    objectKey,
    organizationId: context.organizationId,
  })
  return prisma.$transaction(async (transaction) => {
    const asset = await transaction.asset.create({
      data: {
        bytes: input.body.byteLength,
        height: input.height,
        id: assetId,
        mediaType: input.contentType,
        objectKey,
        organizationId: context.organizationId,
        parentAssetId: input.parentAssetId ?? null,
        sha256: createHash('sha256').update(input.body).digest('hex'),
        status: 'UPLOADED',
        width: input.width,
      },
      select: { id: true, mediaType: true, objectKey: true },
    })
    await enqueueAssetUpload(transaction, context.organizationId, asset.id)
    await appendAuditLog(transaction, {
      action: 'product.asset_generated',
      actor: getAuditActor(context.principal),
      entityId: asset.id,
      entityType: 'asset',
      metadata: {
        classification: input.classification,
        parentAssetId: input.parentAssetId ?? null,
      },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return asset
  })
}
