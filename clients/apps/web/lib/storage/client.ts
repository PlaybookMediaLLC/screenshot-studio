import 'server-only'

import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'

export class TenantStorageUnavailableError extends Error {
  constructor() {
    super('Tenant storage is unavailable.')
    this.name = 'TenantStorageUnavailableError'
  }
}

export class TenantStorageObjectMissingError extends Error {
  constructor() {
    super('The asset was not found in storage.')
    this.name = 'TenantStorageObjectMissingError'
  }
}

export async function createTenantDownloadUrl(input: {
  assetId: string
  tenant: TenantContext
}): Promise<string> {
  try {
    return (await backendSDK(input.tenant).signAssetDownload(input.assetId)).downloadUrl
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 404) {
      throw new TenantStorageObjectMissingError()
    }
    if (error instanceof BackendSDKError && error.status === 503) {
      throw new TenantStorageUnavailableError()
    }
    throw error
  }
}

export async function readTenantObject(input: {
  assetId: string
  tenant: TenantContext
}): Promise<Uint8Array> {
  try {
    return await backendSDK(input.tenant).readAsset(input.assetId)
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 404) {
      throw new TenantStorageObjectMissingError()
    }
    if (error instanceof BackendSDKError && error.status === 503) {
      throw new TenantStorageUnavailableError()
    }
    throw error
  }
}
