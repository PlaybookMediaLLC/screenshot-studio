import 'server-only'

const INVALID_PATH_SEGMENT = /[^a-zA-Z0-9._-]/

export interface TenantUploadRequest {
  assetId: string
  contentType: string
  fileName: string
  tenantId: string
}

export interface TenantUploadUrl {
  objectKey: string
  uploadUrl: string
}

interface StorageSignedUploadResponse {
  url: string
}

function getRequiredEnvironment(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required for tenant storage.`)
  }

  return value
}

function getSafeSegment(value: string): string {
  if (!value || value === '.' || value === '..' || INVALID_PATH_SEGMENT.test(value)) {
    throw new Error('Storage path segments contain unsafe characters.')
  }

  return value
}

function getObjectKey(input: TenantUploadRequest): string {
  return [
    'tenants',
    getSafeSegment(input.tenantId),
    'assets',
    getSafeSegment(input.assetId),
    getSafeSegment(input.fileName),
  ].join('/')
}

function getRequestUrl(path: string): string {
  const storageUrl = getRequiredEnvironment('STORAGE_API_URL')
  return new URL(path, storageUrl).toString()
}

export async function createTenantUploadUrl(input: TenantUploadRequest): Promise<TenantUploadUrl> {
  const storageKey = getRequiredEnvironment('STORAGE_SERVICE_KEY')
  const bucket = getRequiredEnvironment('STORAGE_BUCKET')
  const objectKey = getObjectKey(input)
  const response = await fetch(getRequestUrl(`/object/upload/sign/${bucket}/${objectKey}`), {
    body: JSON.stringify({ contentType: input.contentType }),
    headers: {
      apikey: storageKey,
      authorization: `Bearer ${storageKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Storage signed-upload request failed: ${response.status}`)
  }

  const payload = (await response.json()) as StorageSignedUploadResponse
  return {
    objectKey,
    uploadUrl: getRequestUrl(payload.url),
  }
}
