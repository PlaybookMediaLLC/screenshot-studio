import { NextRequest, NextResponse } from 'next/server'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { cacheInvalidationSchema } from '@/lib/api/schemas'
import { invalidateCache, invalidateCacheBatch } from '@/lib/screenshot-cache'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!hasMaintenanceAccess(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Error invalidating cache:', error)
    if (isInvalidRequest(error)) {
      return NextResponse.json({ error: 'Invalid invalidation request' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to invalidate cache' }, { status: 500 })
  }
}
