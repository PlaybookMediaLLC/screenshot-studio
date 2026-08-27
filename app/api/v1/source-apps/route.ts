import { NextResponse } from 'next/server'
import { createTenantJsonRoute } from '@/lib/api/v1/route'
import { createSourceApp } from '@/lib/tenant/configuration'
import { sourceAppCreateSchema } from '@/lib/tenant/schemas'

export const POST = createTenantJsonRoute({
  access: { apiKeyScope: 'source:write', permission: 'brand:manage' },
  schema: sourceAppCreateSchema,
  input: (request) => request.json(),
  execute: (tenant, input) => createSourceApp(tenant, input),
  respond: (sourceApp) => NextResponse.json({ sourceApp }, { status: 201 }),
})
