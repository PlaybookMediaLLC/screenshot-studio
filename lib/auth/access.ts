import 'server-only'

import { randomUUID } from 'node:crypto'
import { getRequestId } from '@/lib/api/request-context'
import { backendSDK } from '@/lib/backend/sdk'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { assertAuthEnvironment } from './environment'
import {
  hasPermission,
  normalizeOrganizationRole,
  type OrganizationRole,
  type Permission,
} from './permissions'
import { type Principal, type SessionPrincipal } from './principal'
import { auth } from './server'

const freshSessionAgeMilliseconds = 15 * 60 * 1000

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export type OrganizationAccess = {
  organizationId: string
  principal: SessionPrincipal
  requestId: string
  role: OrganizationRole
}

export type TenantContext = {
  organizationId: string
  principal: Principal
  requestId: string
}

export type SessionAccess = {
  principal: SessionPrincipal
  requestId: string
}

type AuthSession = {
  activeOrganizationId?: string | null
  id: string
}

export { getRequestId }

export async function resolveActiveOrganizationId(
  session: AuthSession,
  userId: string
): Promise<string | null> {
  // The backend falls back to the user's first membership and records it as
  // the session's active workspace.
  const access = await backendSDK({
    organizationId: session.activeOrganizationId ?? '',
    principal: { display: '', kind: 'session', sessionId: session.id, userId },
    requestId: randomUUID(),
  })
    .getActiveAccess()
    .catch((error: unknown) => {
      // A user without any membership has no active workspace yet.
      if (error instanceof BackendSDKError && error.status === 403) return null
      throw error
    })
  return access?.organizationId ?? null
}

async function getSessionPrincipal(headers: Headers): Promise<SessionPrincipal | null> {
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session) {
    return null
  }

  return {
    display: session.user.email,
    kind: 'session',
    sessionId: session.session.id,
    userId: session.user.id,
  }
}

async function getApiKeyPrincipal(headers: Headers): Promise<Principal | null> {
  const key = headers.get('x-api-key')
  if (!key) {
    return null
  }

  const result = await auth.api.verifyApiKey({ body: { key } })
  if (!result.valid || !result.key) {
    return null
  }

  return {
    display: result.key.name ?? result.key.start ?? 'Organization API key',
    keyId: result.key.id,
    kind: 'organization_api_key',
    organizationId: result.key.referenceId,
  }
}

async function getBackendActiveOrganization(
  session: { session: AuthSession; user: { email: string; id: string } },
  requestId: string
): Promise<OrganizationAccess> {
  const principal: SessionPrincipal = {
    display: session.user.email,
    kind: 'session',
    sessionId: session.session.id,
    userId: session.user.id,
  }
  const access = await backendSDK({
    organizationId: session.session.activeOrganizationId ?? '',
    principal,
    requestId,
  }).getActiveAccess()
  return {
    organizationId: access.organizationId,
    principal,
    requestId,
    role: normalizeOrganizationRole(access.role),
  }
}

async function getBackendSupportContext(
  principal: SessionPrincipal,
  organizationId: string,
  scope: string,
  requestId: string
): Promise<TenantContext> {
  const grant = await backendSDK({ organizationId, principal, requestId }).verifySupportGrant(
    organizationId,
    scope
  )
  return {
    organizationId,
    principal: {
      grantId: grant.grantId,
      kind: 'support',
      organizationId,
      userId: principal.userId,
    },
    requestId,
  }
}

export async function getRequestPrincipal(headers: Headers): Promise<Principal | null> {
  assertAuthEnvironment()
  return (await getApiKeyPrincipal(headers)) ?? getSessionPrincipal(headers)
}

export async function requireSessionAccess(headers: Headers): Promise<SessionAccess> {
  const principal = await getSessionPrincipal(headers)
  if (!principal) {
    throw new AuthorizationError('Authentication is required.', 401)
  }
  return { principal, requestId: getRequestId(headers) }
}

type AuthSessionResult = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

async function requireAuthSession(headers: Headers): Promise<AuthSessionResult> {
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session) {
    throw new AuthorizationError('Authentication is required.', 401)
  }
  return session
}

async function authorizeActiveOrganization(
  headers: Headers,
  session: AuthSessionResult,
  permission: Permission
): Promise<OrganizationAccess> {
  // The backend rechecks membership, role, and workspace deletion state.
  const access = await getBackendActiveOrganization(session, getRequestId(headers))
  if (!hasPermission(access.role, permission)) {
    throw new AuthorizationError('You do not have permission for this organization.', 403)
  }
  return access
}

function assertActiveOrganization(access: OrganizationAccess, organizationId: string): void {
  if (access.organizationId !== organizationId) {
    throw new AuthorizationError('The requested organization is not active.', 403)
  }
}

export async function requireActiveOrganizationPermission(
  headers: Headers,
  permission: Permission
): Promise<OrganizationAccess> {
  return authorizeActiveOrganization(headers, await requireAuthSession(headers), permission)
}

export async function requireOrganizationPermission(
  headers: Headers,
  organizationId: string,
  permission: Permission
): Promise<OrganizationAccess> {
  const access = await requireActiveOrganizationPermission(headers, permission)
  assertActiveOrganization(access, organizationId)
  return access
}

export async function requireSupportTenantContext(
  headers: Headers,
  organizationId: string,
  scope: string
): Promise<TenantContext> {
  const principal = await getSessionPrincipal(headers)
  if (!principal) {
    throw new AuthorizationError('Authentication is required.', 401)
  }

  return getBackendSupportContext(principal, organizationId, scope, getRequestId(headers))
}

function assertFreshTwoFactorSession(session: AuthSessionResult): void {
  if (Date.now() - session.session.createdAt.getTime() > freshSessionAgeMilliseconds) {
    throw new AuthorizationError('A fresh sign-in is required.', 401)
  }
  if (!session.user.twoFactorEnabled) {
    throw new AuthorizationError('Two-factor authentication is required.', 403)
  }
}

/**
 * Same as {@link requireActiveOrganizationPermission}, and the session must
 * be under 15 minutes old with two-factor authentication enabled. Reads the
 * session once.
 */
export async function requireSensitiveActiveOrganizationPermission(
  headers: Headers,
  permission: Permission
): Promise<OrganizationAccess> {
  const session = await requireAuthSession(headers)
  const access = await authorizeActiveOrganization(headers, session, permission)
  assertFreshTwoFactorSession(session)
  return access
}

export async function requireSensitiveOrganizationPermission(
  headers: Headers,
  organizationId: string,
  permission: Permission
): Promise<OrganizationAccess> {
  const session = await requireAuthSession(headers)
  const access = await authorizeActiveOrganization(headers, session, permission)
  assertActiveOrganization(access, organizationId)
  assertFreshTwoFactorSession(session)
  return access
}

export async function requireEnterpriseFeature(
  access: OrganizationAccess,
  feature: 'scimEnabled' | 'ssoEnabled'
): Promise<void> {
  try {
    await backendSDK(access).requireEnterpriseFeature(feature)
  } catch (error) {
    // Callers have already passed the sensitive-permission check, so a denial
    // here is the workspace's enterprise settings.
    if (error instanceof BackendSDKError && error.status === 403) {
      throw new AuthorizationError('This organization does not have this enterprise feature.', 403)
    }
    throw error
  }
}
