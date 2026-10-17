import 'server-only'

import {
  type OrganizationAccessOptions,
  organizationAccessOptionsSchema,
  organizationScopeSchema,
  requestedOrganizationSchema,
  type TenantAccessRequirement,
} from '@/lib/api/access-requirements'
import { hasMaintenanceAccess } from '@/lib/api/maintenance-auth'
import type { Authenticate, RawRequest } from '@/lib/api/route'
import {
  AuthorizationError,
  type OrganizationAccess,
  requireActiveOrganizationPermission,
  requireOrganizationPermission,
  requireSensitiveActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
  requireSessionAccess,
  type SessionAccess,
  type TenantContext,
} from '@/lib/auth/access'
import type { Permission } from '@/lib/auth/permissions'
import { requireTenantAccess } from '@/lib/tenant/access'
import { requireWorkspaceFeature } from '@/lib/tenant/entitlements'

/**
 * Authenticators for `route()`. Each resolves the caller or throws an
 * `AuthorizationError`, and runs before any input is validated.
 */

/**
 * No caller identity. A route that authenticates with a signed token or an
 * HMAC signature uses its own authenticator instead.
 */
export const publicAccess: Authenticate<null> = async () => null

/** The shared maintenance secret, for operator-only endpoints. */
export const maintenanceAccess: Authenticate<null> = async ({ request }) => {
  if (!hasMaintenanceAccess(request)) {
    throw new AuthorizationError('Maintenance access is required.', 401)
  }
  return null
}

/** Any signed-in user, with or without an active organization. */
export const sessionAccess: Authenticate<SessionAccess> = async ({ request }) =>
  requireSessionAccess(request.headers)

/** The `organizationId` from the path, then the query, then the body. */
function getRequestedOrganizationId({ body, params, query }: RawRequest): string {
  for (const source of [params, query]) {
    const parsed = requestedOrganizationSchema.safeParse(source)
    if (parsed.success) return parsed.data.organizationId
  }
  return requestedOrganizationSchema.parse(body).organizationId
}

/** A signed-in organization member whose role grants `permission`. */
export function organizationAccess(
  permission: Permission,
  options: OrganizationAccessOptions = {}
): Authenticate<OrganizationAccess> {
  const { scope, sensitive } = organizationAccessOptionsSchema.parse(options)
  if (scope === organizationScopeSchema.enum.active) {
    const requireActive = sensitive
      ? requireSensitiveActiveOrganizationPermission
      : requireActiveOrganizationPermission
    return async ({ request }) => requireActive(request.headers, permission)
  }
  const requireRequested = sensitive
    ? requireSensitiveOrganizationPermission
    : requireOrganizationPermission
  return async ({ raw, request }) =>
    requireRequested(request.headers, getRequestedOrganizationId(await raw()), permission)
}

/**
 * A session member with `requirement.permission`, or an organization API key
 * with `requirement.apiKeyScope`, then the optional plan feature and quota.
 */
export function tenantAccess(requirement: TenantAccessRequirement): Authenticate<TenantContext> {
  return async ({ request }) => requireTenantAccess(request.headers, requirement)
}

/**
 * A signed-in member of the active workspace with `permission`, on a paid
 * plan. API keys are refused: store publishing and its credentials are
 * human actions. `sensitive` also requires a fresh second factor.
 */
export function paidSessionAccess(
  permission: Permission,
  options: { sensitive?: boolean } = {}
): Authenticate<OrganizationAccess> {
  return async ({ request }) => {
    const access = options.sensitive
      ? await requireSensitiveActiveOrganizationPermission(request.headers, permission)
      : await requireActiveOrganizationPermission(request.headers, permission)
    await requireWorkspaceFeature(access, 'workspace:use')
    return access
  }
}
