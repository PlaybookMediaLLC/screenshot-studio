import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import {
  createScheduledPost,
  getScheduledPostIdempotencyKey,
  listScheduledPosts,
} from '@/lib/tenant/scheduled-posts'
import { scheduledPostCreateSchema, scheduledPostListQuerySchema } from '@/lib/tenant/schemas'

async function getPublishingContext(request: NextRequest) {
  const access = await requireActiveOrganizationPermission(request.headers, 'publish:manage')
  return requireSensitiveOrganizationPermission(
    request.headers,
    access.organizationId,
    'publish:manage'
  )
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = scheduledPostListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    )
    const context = await requireActiveOrganizationPermission(request.headers, 'publish:manage')
    return NextResponse.json({
      scheduledPosts: await listScheduledPosts(context.organizationId, input.limit),
    })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = scheduledPostCreateSchema.parse(await request.json())
    const context = await getPublishingContext(request)
    const result = await createScheduledPost(context, {
      ...input,
      idempotencyKey: getScheduledPostIdempotencyKey(request.headers.get('idempotency-key')),
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
