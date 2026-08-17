import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'
import { createSourceApp } from '@/lib/tenant/configuration'
import { sourceAppCreateSchema } from '@/lib/tenant/schemas'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireTenantAccess(request.headers, {
      apiKeyScope: 'source:write',
      permission: 'brand:manage',
    })
    const input = sourceAppCreateSchema.parse(await request.json())
    const sourceApp = await createSourceApp(context, input)
    return NextResponse.json({ sourceApp }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
