import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { ApiKeyScope } from '@/lib/auth/api-key-scopes'
import type { Permission } from '@/lib/auth/permissions'
import type { TenantContext } from '@/lib/auth/access'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'

export type RestRouteContext<Params extends Record<string, string> = Record<string, string>> = {
  params: Promise<Params>
}

type TenantAccessRequirement = {
  apiKeyScope: ApiKeyScope
  permission: Permission
}

type TenantJsonRouteDefinition<Input, Output, Params extends Record<string, string>> = {
  access: TenantAccessRequirement
  parse: (request: NextRequest, context: RestRouteContext<Params>) => Input | Promise<Input>
  execute: (tenant: TenantContext, input: Input, request: NextRequest) => Output | Promise<Output>
  respond?: (output: Output) => NextResponse
}

export function createTenantJsonRoute<
  Input,
  Output,
  Params extends Record<string, string> = Record<string, string>,
>(definition: TenantJsonRouteDefinition<Input, Output, Params>) {
  return async function tenantJsonRoute(
    request: NextRequest,
    routeContext: RestRouteContext<Params>
  ): Promise<NextResponse> {
    try {
      const tenant = await requireTenantAccess(request.headers, definition.access)
      const input = await definition.parse(request, routeContext)
      const output = await definition.execute(tenant, input, request)
      return definition.respond?.(output) ?? NextResponse.json(output)
    } catch (error) {
      return getRouteErrorResponse(error)
    }
  }
}
