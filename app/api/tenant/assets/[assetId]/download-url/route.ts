import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'
import { signAssetDownload } from '@/lib/tenant/assets'
import { assetDownloadQuerySchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ assetId: string }> }

export async function GET(request: NextRequest, routeContext: RouteContext): Promise<NextResponse> {
  try {
    const { assetId } = await routeContext.params
    const input = assetDownloadQuerySchema.parse({ assetId })
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'artifact:read',
      permission: 'artifact:read',
    })
    const downloadUrl = await signAssetDownload(context, input.assetId)
    if (!downloadUrl) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })
    }

    return NextResponse.json({ downloadUrl })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
