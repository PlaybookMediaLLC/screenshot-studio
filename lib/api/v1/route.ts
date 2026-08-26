import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import type { ApiKeyScope } from '@/lib/auth/api-key-scopes'
import type { Permission } from '@/lib/auth/permissions'
import type { WorkspaceFeature, WorkspaceQuota } from '@/lib/billing/plans'
import type { TenantContext } from '@/lib/auth/access'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'

export type RestRouteContext<Params extends Record<string, string> = Record<string, string>> = {
  params: Promise<Params>
}

type TenantAccessRequirement = {
  apiKeyScope: ApiKeyScope
  feature?: WorkspaceFeature
  permission: Permission
  quota?: WorkspaceQuota
}

type TenantJsonRouteDefinition<Input, Output, Params extends Record<string, string>> = {
  access: TenantAccessRequirement
  schema: ZodType<Input>
  input: (request: NextRequest, context: RestRouteContext<Params>) => unknown | Promise<unknown>
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
      const untrustedInput = await definition.input(request, routeContext)
      const input = await definition.schema.parseAsync(untrustedInput)
      const output = await definition.execute(tenant, input, request)
      return definition.respond?.(output) ?? NextResponse.json(output)
    } catch (error) {
      return getRouteErrorResponse(error)
    }
  }
}
