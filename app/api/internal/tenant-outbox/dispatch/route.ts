import { NextRequest, NextResponse } from 'next/server'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { emptyRequestSchema } from '@/lib/api/schemas'
import { dispatchPendingTenantOutboxEvents } from '@/lib/tenant/outbox'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!hasMaintenanceAccess(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await parseJson(request, emptyRequestSchema)
    const dispatched = await dispatchPendingTenantOutboxEvents()
    return NextResponse.json({ dispatched })
  } catch (error) {
    if (isInvalidRequest(error)) {
      return NextResponse.json({ error: 'Invalid dispatch request.' }, { status: 400 })
    }

    return getRouteErrorResponse(error)
  }
}
