import 'server-only'

import {
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
  type OrganizationAccess,
  type TenantContext,
} from '@/lib/auth/access'
import type { ApiKeyScope } from '@/lib/auth/api-key-scopes'
import type { Permission } from '@/lib/auth/permissions'
import { requireTenantAccess } from '@/lib/tenant/access'
import { publicProcedure } from './init'

export { publicProcedure }

/**
 * Signed-in member of the active organization with the named role permission.
 * Mirrors requireActiveOrganizationPermission on the REST surface.
 */
export function organizationProcedure(permission: Permission) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const access: OrganizationAccess = await requireActiveOrganizationPermission(
      ctx.headers,
      permission
    )
    return next({ ctx: { ...ctx, access } })
  })
}

/**
 * Same as organizationProcedure, but also requires a fresh two-factor
 * session. Used for publishing credentials and scheduling actions.
 */
export function sensitiveOrganizationProcedure(permission: Permission) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const active = await requireActiveOrganizationPermission(ctx.headers, permission)
    const access: OrganizationAccess = await requireSensitiveOrganizationPermission(
      ctx.headers,
      active.organizationId,
      permission
    )
    return next({ ctx: { ...ctx, access } })
  })
}

/**
 * Session member with the named permission, or an organization API key with
 * the named product scope. Mirrors requireTenantAccess on the REST surface.
 */
export function tenantProcedure(requirement: { apiKeyScope: ApiKeyScope; permission: Permission }) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const tenant: TenantContext = await requireTenantAccess(ctx.headers, requirement)
    return next({ ctx: { ...ctx, tenant } })
  })
}
