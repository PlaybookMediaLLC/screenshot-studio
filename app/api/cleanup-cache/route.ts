import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api/errors'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { emptyRequestSchema } from '@/lib/api/schemas'
import { clearOldCache } from '@/lib/screenshot-cache'

export const maxDuration = 60

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

    await parseJson(request, emptyRequestSchema)
    await clearOldCache()
    return NextResponse.json({
      success: true,
      message: 'Cache cleanup completed',
    })
  } catch (error) {
    console.error('Cache cleanup error:', error)
    if (isInvalidRequest(error)) {
      return apiError(
        400,
        'invalid_request',
        'Invalid cleanup request',
        'Send an empty JSON object as the request body.'
      )
    }

    return apiError(
      500,
      'internal_error',
      'Cache cleanup failed',
      'Retry the request. Check the server logs for the underlying storage error.'
    )
  }
}

export async function GET(): Promise<NextResponse> {
  return methodNotAllowed(['POST'])
}
