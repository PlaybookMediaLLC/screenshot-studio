import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'
import { deleteAsset } from '@/lib/tenant/assets'
import { assetDownloadQuerySchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ assetId: string }> }

export async function DELETE(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { assetId } = await routeContext.params
    const input = assetDownloadQuerySchema.parse({ assetId })
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'asset:write',
      feature: 'asset:delete',
      permission: 'artifact:edit',
    })
    const result = await deleteAsset(context, input.assetId)
    if (result === 'not-found') {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })
    }
    if (result === 'in-use') {
      return NextResponse.json({ error: 'Asset is in use by a creative variant.' }, { status: 409 })
    }
    if (result === 'not-ready') {
      return NextResponse.json({ error: 'Only uploaded assets can be deleted.' }, { status: 409 })
    }

    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
