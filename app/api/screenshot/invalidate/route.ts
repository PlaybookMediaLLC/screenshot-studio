import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api/errors'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { cacheInvalidationSchema } from '@/lib/api/schemas'
import { invalidateCache, invalidateCacheBatch } from '@/lib/screenshot-cache'

// Keep maintenance authentication and cache invalidation in one auditable boundary.
// eslint-disable-next-line max-lines-per-function
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!hasMaintenanceAccess(request)) {
      return apiError(
        401,
        'unauthorized',
        'Unauthorized',
        'Send the server-only maintenance secret in the maintenance request header.'
      )
    }

    const body = await parseJson(request, cacheInvalidationSchema)
    const { url, urls } = body

    if (url) {
      await invalidateCache(url)
      return NextResponse.json({
        success: true,
        message: `Cache invalidated for ${url}`,
      })
    }

    if (urls) {
      await invalidateCacheBatch(urls)
      return NextResponse.json({
        success: true,
        message: `Cache invalidated for ${urls.length} URL(s)`,
        count: urls.length,
      })
    }

    return apiError(
      400,
      'invalid_request',
      'Invalid invalidation request',
      'Send either one absolute http or https "url", or a non-empty "urls" array.'
    )
  } catch (error) {
    console.error('Error invalidating cache:', error)
    if (isInvalidRequest(error)) {
      return apiError(
        400,
        'invalid_request',
        'Invalid invalidation request',
        'Send either one absolute http or https "url", or a non-empty "urls" array, but not both.'
      )
    }

    return apiError(
      500,
      'internal_error',
      'Failed to invalidate cache',
      'Retry the request. Check the server logs for the underlying storage error.'
    )
  }
}

export async function GET(): Promise<NextResponse> {
  return methodNotAllowed(['POST'])
}
