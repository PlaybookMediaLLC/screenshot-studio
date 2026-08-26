import { NextResponse } from 'next/server'
import { createTenantJsonRoute } from '@/lib/api/v1/route'
import { createSourceApp } from '@/lib/tenant/configuration'
import { sourceAppCreateSchema } from '@/lib/tenant/schemas'

export const POST = createTenantJsonRoute({
  access: { apiKeyScope: 'source:write', permission: 'brand:manage' },
  parse: async (request) => sourceAppCreateSchema.parse(await request.json()),
  execute: (tenant, input) => createSourceApp(tenant, input),
  respond: (sourceApp) => NextResponse.json({ sourceApp }, { status: 201 }),
})
