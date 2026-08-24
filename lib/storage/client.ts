import 'server-only'

import {
  assertTenantObjectKey,
  buildTenantObjectKey,
  type AssetClassification,
} from '@/lib/tenant/object-key'

export { buildTenantObjectKey } from '@/lib/tenant/object-key'

export type TenantUploadRequest = {
  assetId: string
  classification: AssetClassification
  contentType: string
  fileName: string
  organizationId: string
  revision: number
}

export type TenantUploadUrl = {
  objectKey: string
  uploadUrl: string
}

export class TenantStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantStorageUnavailableError'
  }
}

export class TenantStorageObjectMissingError extends Error {
  constructor() {
    super('The signed upload was not found in storage.')
    this.name = 'TenantStorageObjectMissingError'
  }
}

type StorageSignedDownloadResponse = {
  signedURL: string
}

type StorageSignedUploadResponse = {
  url: string
}

function getRequiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    // Unconfigured storage is a deployment gap, not a bad request, so it
    // surfaces as a dependency being unavailable rather than an
    // unexplained server fault. Callers already map this to 503.
    throw new TenantStorageUnavailableError(`${name} is required for tenant storage.`)
  }

  return value
}

function getRequestUrl(path: string): string {
  return new URL(path, getRequiredEnvironment('STORAGE_API_URL')).toString()
}

function getStorageHeaders(): HeadersInit {
  const storageKey = getRequiredEnvironment('STORAGE_SERVICE_KEY')
  return {
    apikey: storageKey,
    authorization: `Bearer ${storageKey}`,
    'content-type': 'application/json',
  }
}

function getStorageProxyUrl(path: string): string | null {
  const proxyRoot = process.env.STORAGE_PROXY_URL
  if (!proxyRoot) {
    return null
  }

  const signedUrl = new URL(path, 'http://storage.internal')
  const proxyUrl = new URL(proxyRoot)
  proxyUrl.pathname = `${proxyUrl.pathname.replace(/\/$/, '')}${signedUrl.pathname}`
  proxyUrl.search = signedUrl.search
  return proxyUrl.toString()
}

function getStorageObjectUrl(path: string): string {
  const proxyUrl = getStorageProxyUrl(path)
  if (proxyUrl) {
    return proxyUrl
  }

  return new URL(
    path,
    process.env.STORAGE_HOST_URL ?? getRequiredEnvironment('STORAGE_API_URL')
  ).toString()
}

async function fetchStorage(url: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      throw new TenantStorageUnavailableError(`Storage request failed: ${response.status}`)
    }
    return response
  } catch (error) {
    if (error instanceof TenantStorageUnavailableError) {
      throw error
    }
    throw new TenantStorageUnavailableError('Storage is unavailable.')
  }
}

export async function assertTenantObjectExists(input: {
  objectKey: string
  organizationId: string
}): Promise<void> {
  const bucket = getRequiredEnvironment('STORAGE_BUCKET')
  assertTenantObjectKey(input.organizationId, input.objectKey)
  try {
    const response = await fetch(getRequestUrl(`/object/${bucket}/${input.objectKey}`), {
      headers: { ...getStorageHeaders(), range: 'bytes=0-0' },
      signal: AbortSignal.timeout(5_000),
    })
    const body = await response.text()
    if (response.status === 404 || body.includes('"error":"not_found"')) {
      throw new TenantStorageObjectMissingError()
    }
    if (!response.ok) {
      throw new TenantStorageUnavailableError(`Storage request failed: ${response.status}`)
    }
  } catch (error) {
    if (
      error instanceof TenantStorageObjectMissingError ||
      error instanceof TenantStorageUnavailableError
    ) {
      throw error
    }
    throw new TenantStorageUnavailableError('Storage is unavailable.')
  }
}

export async function createTenantUploadUrl(input: TenantUploadRequest): Promise<TenantUploadUrl> {
  const bucket = getRequiredEnvironment('STORAGE_BUCKET')
  const objectKey = buildTenantObjectKey(input)
  const response = await fetchStorage(getRequestUrl(`/object/upload/sign/${bucket}/${objectKey}`), {
    body: JSON.stringify({ contentType: input.contentType }),
    headers: getStorageHeaders(),
    method: 'POST',
  })

  const payload = (await response.json()) as StorageSignedUploadResponse
  return { objectKey, uploadUrl: getStorageObjectUrl(payload.url) }
}

export async function createTenantDownloadUrl(input: {
  expiresIn: number
  objectKey: string
  organizationId: string
}): Promise<string> {
  const bucket = getRequiredEnvironment('STORAGE_BUCKET')
  assertTenantObjectKey(input.organizationId, input.objectKey)
  const response = await fetchStorage(getRequestUrl(`/object/sign/${bucket}/${input.objectKey}`), {
    body: JSON.stringify({ expiresIn: input.expiresIn }),
    headers: getStorageHeaders(),
    method: 'POST',
  })

  const payload = (await response.json()) as StorageSignedDownloadResponse
  return getStorageObjectUrl(payload.signedURL)
}

export async function deleteTenantObject(input: {
  objectKey: string
  organizationId: string
}): Promise<void> {
  const bucket = getRequiredEnvironment('STORAGE_BUCKET')
  assertTenantObjectKey(input.organizationId, input.objectKey)
  try {
    const response = await fetch(getRequestUrl(`/object/${bucket}/${input.objectKey}`), {
      headers: getStorageHeaders(),
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 404) {
      throw new TenantStorageUnavailableError(`Storage request failed: ${response.status}`)
    }
  } catch (error) {
    if (error instanceof TenantStorageUnavailableError) {
      throw error
    }
    throw new TenantStorageUnavailableError('Storage is unavailable.')
  }
}

export async function readTenantObject(input: {
  objectKey: string
  organizationId: string
}): Promise<Uint8Array> {
  const bucket = getRequiredEnvironment('STORAGE_BUCKET')
  assertTenantObjectKey(input.organizationId, input.objectKey)
  const response = await fetchStorage(getRequestUrl(`/object/${bucket}/${input.objectKey}`), {
    headers: getStorageHeaders(),
    signal: AbortSignal.timeout(10_000),
  })
  return new Uint8Array(await response.arrayBuffer())
}
