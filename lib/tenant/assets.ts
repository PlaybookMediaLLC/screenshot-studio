import 'server-only'

import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import type { TenantContext } from '@/lib/auth/access'
import type { AssetClassification } from './object-key'
import type { AssetUploadInput } from './schemas'

export type AssetDeletionResult = 'deleted' | 'in-use' | 'not-found' | 'not-ready'

/**
 * The backend checks the storage quota, records a PENDING asset row, and signs
 * a short-lived upload URL for its private object key.
 */
export async function signAssetUpload(context: TenantContext, input: AssetUploadInput) {
  return backendSDK(context).signAssetUpload(input)
}

export async function completeAssetUpload(
  context: TenantContext,
  assetId: string,
  sha256?: string
) {
  const result = await orNull(backendSDK(context).completeAssetUpload(assetId, sha256))
  return result?.asset ?? null
}

export async function signAssetDownload(
  context: TenantContext,
  assetId: string
): Promise<string | null> {
  return (await orNull(backendSDK(context).signAssetDownload(assetId)))?.downloadUrl ?? null
}

export async function listAssets(
  context: TenantContext,
  options: {
    search?: string
    classification?: string
    cursor?: string
    take: number
    type?: 'all' | 'image' | 'video'
    sort?: 'newest' | 'oldest'
  }
) {
  const page = await backendSDK(context).listAssets({
    cursor: options.cursor,
    search: options.search,
    classification: options.classification,
    limit: options.take,
    type: options.type,
    sort: options.sort,
  })
  return {
    assets: page.assets.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })),
    nextCursor: page.nextCursor,
  }
}

/**
 * The backend resolves ownership before the asset:delete plan gate, so a
 * workspace that cannot see the asset gets 'not-found', never an entitlement
 * error that would confirm the id exists in another workspace.
 */
export async function deleteAsset(
  context: TenantContext,
  assetId: string
): Promise<AssetDeletionResult> {
  try {
    await backendSDK(context).deleteAsset(assetId)
    return 'deleted'
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 404) return 'not-found'
    if (error instanceof BackendSDKError && error.status === 409) {
      return error.message.includes('in use') ? 'in-use' : 'not-ready'
    }
    throw error
  }
}

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
  return backendSDK(context).storeGeneratedAsset(input)
}

/** Describe an image (RFC 025); null when it is not this workspace's. */
export async function setAssetAltText(context: TenantContext, assetId: string, altText: string) {
  return orNull(backendSDK(context).setAssetAltText(assetId, altText))
}
