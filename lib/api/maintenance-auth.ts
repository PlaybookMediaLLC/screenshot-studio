import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { getPlatformApiEnvironment } from '@/lib/api/environment'
import { platformHeaders } from '@/lib/api/request-context'

/** Header that carries the operator maintenance secret. */
export const MAINTENANCE_SECRET_HEADER = platformHeaders['x-screenshot-studio-maintenance-secret']

/** Whether the request carries the maintenance secret, compared in constant time. */
export function hasMaintenanceAccess(request: NextRequest): boolean {
  const expected = getPlatformApiEnvironment().CLEANUP_SECRET
  const provided = request.headers.get(MAINTENANCE_SECRET_HEADER)

  if (!expected || !provided) {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  )
}
