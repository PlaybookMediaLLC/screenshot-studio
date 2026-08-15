import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  getWebhookReleaseInput,
  getWebhookSource,
  ingestSourceRelease,
  verifyWebhookRequest,
} from '@/lib/tenant/webhooks'

type RouteContext = { params: Promise<{ sourceAppId: string }> }

function getEventId(request: NextRequest, provider: string): string | null {
  if (provider === 'gitlab') {
    return (
      request.headers.get('webhook-id') ??
      request.headers.get('x-gitlab-event-uuid') ??
      request.headers.get('idempotency-key')
    )
  }

  return (
    request.headers.get('x-github-delivery') ?? request.headers.get('x-screenshot-studio-event-id')
  )
}

function getSignature(request: NextRequest, provider: string): string | null {
  if (provider === 'gitlab') {
    return request.headers.get('webhook-signature')
  }

  return (
    request.headers.get('x-hub-signature-256') ??
    request.headers.get('x-screenshot-studio-signature')
  )
}

function getEventName(request: NextRequest, provider: string): string | null {
  return provider === 'gitlab'
    ? request.headers.get('x-gitlab-event')
    : request.headers.get('x-github-event')
}

function getTimestamp(request: NextRequest, provider: string): string | null {
  return provider === 'gitlab'
    ? request.headers.get('webhook-timestamp')
    : request.headers.get('x-screenshot-studio-timestamp')
}

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { sourceAppId } = await routeContext.params
    const source = await getWebhookSource(sourceAppId)
    const body = await request.text()
    if (!source) {
      return NextResponse.json({ error: 'Unauthorized webhook.' }, { status: 401 })
    }

    const eventId = getEventId(request, source.provider)
    const isValid =
      eventId &&
      verifyWebhookRequest({
        body,
        eventId,
        signature: getSignature(request, source.provider),
        source,
        timestamp: getTimestamp(request, source.provider),
      })
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized webhook.' }, { status: 401 })
    }

    const release = getWebhookReleaseInput(
      source.provider,
      getEventName(request, source.provider),
      body
    )
    const result = await ingestSourceRelease({ eventId, release, source })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
