import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'
import { createRelease, listReleases } from '@/lib/tenant/releases'
import { releaseCreateSchema, releaseListQuerySchema } from '@/lib/tenant/schemas'

function getIdempotencyKey(request: NextRequest): string {
  return request.headers.get('idempotency-key')?.slice(0, 128) || randomUUID()
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = releaseListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'artifact:read',
      permission: 'artifact:read',
    })
    const releases = await listReleases(context.organizationId, input.limit)
    return NextResponse.json({ releases })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = releaseCreateSchema.parse(await request.json())
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'release:create',
      permission: 'release:create',
    })
    const result = await createRelease(context, {
      ...input,
      idempotencyKey: getIdempotencyKey(request),
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
