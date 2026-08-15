import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'
import { signAssetUpload } from '@/lib/tenant/assets'
import { assetUploadSchema } from '@/lib/tenant/schemas'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = assetUploadSchema.parse(await request.json())
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'upload:sign',
      permission: 'artifact:edit',
    })
    return NextResponse.json(await signAssetUpload(context, input), { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
