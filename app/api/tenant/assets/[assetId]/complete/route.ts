import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'
import { completeAssetUpload } from '@/lib/tenant/assets'
import { assetCompleteSchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ assetId: string }> }

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { assetId } = await routeContext.params
    const input = assetCompleteSchema.parse({ ...(await request.json()), assetId })
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'asset:write',
      permission: 'artifact:edit',
    })
    const asset = await completeAssetUpload(context, input.assetId, input.sha256)
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })
    }

    return NextResponse.json({ asset })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
