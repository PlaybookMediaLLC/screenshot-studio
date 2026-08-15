import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { AuthorizationError } from '@/lib/auth/access'
import { assertTenantObjectKey } from '@/lib/tenant/object-key'
import { requireTenantAccess } from '@/lib/tenant/access'

const safePathSegment = /^[a-zA-Z0-9._-]+$/

type RouteContext = { params: Promise<{ path: string[] }> }
type StorageOperation = 'download' | 'upload'

class InvalidStorageProxyRequestError extends Error {}

function getStorageOperation(path: string[]): { objectKey: string; operation: StorageOperation } {
  if (path.some((segment) => !safePathSegment.test(segment))) {
    throw new InvalidStorageProxyRequestError('Invalid storage path.')
  }

  const isUpload = path.slice(0, 3).join('/') === 'object/upload/sign'
  const isDownload = path.slice(0, 2).join('/') === 'object/sign'
  const keyStart = isUpload ? 4 : 3
  if ((!isUpload && !isDownload) || path.length <= keyStart) {
    throw new InvalidStorageProxyRequestError('Invalid storage operation.')
  }

  return { objectKey: path.slice(keyStart).join('/'), operation: isUpload ? 'upload' : 'download' }
}

async function authorizeStorageRequest(
  request: NextRequest,
  operation: StorageOperation,
  objectKey: string
) {
  const context = await requireTenantAccess(request.headers, {
    apiKeyScope: operation === 'upload' ? 'upload:sign' : 'artifact:read',
    permission: operation === 'upload' ? 'artifact:edit' : 'artifact:read',
  })
  try {
    assertTenantObjectKey(context.organizationId, objectKey)
  } catch {
    throw new AuthorizationError('The object is outside the active organization.', 403)
  }
}

function getStorageUrl(request: NextRequest, path: string[]): URL {
  const storageUrl = process.env.STORAGE_API_URL
  if (!storageUrl) {
    throw new Error('STORAGE_API_URL is required for tenant storage.')
  }

  const url = new URL(`/${path.join('/')}`, storageUrl)
  url.search = request.nextUrl.search
  return url
}

async function proxyStorageRequest(
  request: NextRequest,
  routeContext: RouteContext,
  method: 'GET' | 'PUT'
): Promise<NextResponse> {
  try {
    const { path } = await routeContext.params
    const target = getStorageOperation(path)
    await authorizeStorageRequest(request, target.operation, target.objectKey)
    const options =
      method === 'PUT'
        ? {
            body: request.body,
            duplex: 'half' as const,
            headers: { 'content-type': request.headers.get('content-type') ?? '' },
            method,
          }
        : { method }
    const response = await fetch(getStorageUrl(request, path), options)
    const headers = new Headers(response.headers)
    if (method === 'GET') headers.set('cache-control', 'no-store')
    return new NextResponse(response.body, { headers, status: response.status })
  } catch (error) {
    if (error instanceof InvalidStorageProxyRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return getRouteErrorResponse(error)
  }
}

export async function GET(request: NextRequest, routeContext: RouteContext): Promise<NextResponse> {
  return proxyStorageRequest(request, routeContext, 'GET')
}

export async function PUT(request: NextRequest, routeContext: RouteContext): Promise<NextResponse> {
  return proxyStorageRequest(request, routeContext, 'PUT')
}
