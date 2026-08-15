import 'server-only'

import { randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import {
  assertTenantObjectExists,
  createTenantDownloadUrl,
  createTenantUploadUrl,
} from '@/lib/storage/client'
import type { AssetUploadInput } from './schemas'

const signedUrlSeconds = 120

export type AssetDeletionResult = 'deleted' | 'in-use' | 'not-found' | 'not-ready'

export async function signAssetUpload(context: TenantContext, input: AssetUploadInput) {
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

export async function deleteAsset(
  context: TenantContext,
  assetId: string
): Promise<AssetDeletionResult> {
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
