import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const MAINTENANCE_SECRET_HEADER = 'x-screenshot-studio-maintenance-secret'

export function hasMaintenanceAccess(request: NextRequest): boolean {
  const expected = process.env.CLEANUP_SECRET
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
