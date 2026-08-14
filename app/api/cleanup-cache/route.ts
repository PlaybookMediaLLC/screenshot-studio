import { NextRequest, NextResponse } from 'next/server'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { emptyRequestSchema } from '@/lib/api/schemas'
import { clearOldCache } from '@/lib/screenshot-cache'

export const maxDuration = 60

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!hasMaintenanceAccess(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await parseJson(request, emptyRequestSchema)
    await clearOldCache()
    return NextResponse.json({
      success: true,
      message: 'Cache cleanup completed',
    })
  } catch (error) {
    console.error('Cache cleanup error:', error)
    if (isInvalidRequest(error)) {
      return NextResponse.json({ error: 'Invalid cleanup request' }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Cache cleanup failed' },
      { status: 500 }
    )
  }
}
