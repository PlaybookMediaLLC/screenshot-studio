import 'server-only'

import type { TenantAccessRequirement } from '@/lib/api/access-requirements'
import {
  requireActiveOrganizationPermission,
  requireSessionAccess,
  requireSensitiveActiveOrganizationPermission,
  type OrganizationAccess,
  type TenantContext,
} from '@/lib/auth/access'
import type { Permission } from '@/lib/auth/permissions'
import { requireTenantAccess } from '@/lib/tenant/access'
import { publicProcedure } from './init'

export { publicProcedure }

/** A signed-in user action that does not require an active workspace. */
export const sessionProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const access = await requireSessionAccess(ctx.headers)
  return next({ ctx: { ...ctx, sessionAccess: access } })
})

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
    const access: OrganizationAccess = await requireSensitiveActiveOrganizationPermission(
      ctx.headers,
      permission
    )
    return next({ ctx: { ...ctx, access } })
  })
}

/**
 * Session member with the named permission, or an organization API key with
 * the named product scope. Mirrors requireTenantAccess on the REST surface.
 */
export function tenantProcedure(requirement: TenantAccessRequirement) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const tenant: TenantContext = await requireTenantAccess(ctx.headers, requirement)
    return next({ ctx: { ...ctx, tenant } })
  })
}
