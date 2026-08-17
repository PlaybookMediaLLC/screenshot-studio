import { NextRequest, NextResponse } from 'next/server'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { emptyRequestSchema } from '@/lib/api/schemas'
import { replayDeadLetteredOutboxEvent } from '@/lib/tenant/outbox'

type RouteContext = { params: Promise<{ eventId: string }> }

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    if (!hasMaintenanceAccess(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await parseJson(request, emptyRequestSchema)
    const { eventId } = await routeContext.params
    if (!(await replayDeadLetteredOutboxEvent(eventId))) {
      return NextResponse.json(
        { error: 'Dead-lettered outbox event was not found.' },
        { status: 404 }
      )
    }
    return NextResponse.json({ replayed: true })
  } catch (error) {
    if (isInvalidRequest(error)) {
      return NextResponse.json({ error: 'Invalid replay request.' }, { status: 400 })
    }
    return getRouteErrorResponse(error)
  }
}
