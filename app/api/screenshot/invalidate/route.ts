import { NextRequest, NextResponse } from 'next/server'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { cacheInvalidationSchema } from '@/lib/api/schemas'
import { apiError, methodNotAllowed } from '@/lib/api/errors'
import { invalidateCache, invalidateCacheBatch } from '@/lib/screenshot-cache'

// Keep maintenance authentication and invalidation in one linear handler so a
// future edit cannot accidentally move cache mutation ahead of authorization.
// eslint-disable-next-line max-lines-per-function
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!hasMaintenanceAccess(request)) {
      return apiError(
        401,
        'unauthorized',
        'Unauthorized',
        'This maintenance endpoint requires authorized maintenance access.'
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
      'Invalid request',
      'Provide either one absolute URL or a non-empty array of absolute URLs.'
    )
  } catch (error) {
    console.error('Error invalidating cache:', error)
    if (isInvalidRequest(error)) {
      return apiError(
        400,
        'invalid_request',
        'Invalid invalidation request',
        'Provide either one absolute http or https URL or a non-empty array of them.'
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

export async function GET() {
  return methodNotAllowed(['POST'])
}
