import 'server-only'

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isWorkspaceOperational } from '@/lib/workspace/access'
import { assertAuthEnvironment } from './environment'
import {
  hasPermission,
  normalizeOrganizationRole,
  type OrganizationRole,
  type Permission,
} from './permissions'
import { type Principal, type SessionPrincipal, type SupportPrincipal } from './principal'
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

export function getRequestId(headers: Headers): string {
  return headers.get('x-request-id') ?? randomUUID()
}

export async function resolveActiveOrganizationId(
  session: AuthSession,
  userId: string
): Promise<string | null> {
  if (session.activeOrganizationId) return session.activeOrganizationId

  const membership = await prisma.member.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
    where: { userId },
  })
  if (!membership) return null

  await prisma.session.update({
    data: { activeOrganizationId: membership.organizationId },
    where: { id: session.id },
  })
  return membership.organizationId
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

async function requireActiveSessionOrganization(headers: Headers): Promise<OrganizationAccess> {
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session) {
    throw new AuthorizationError('Authentication is required.', 401)
  }
  const activeOrganizationId = await resolveActiveOrganizationId(session.session, session.user.id)
  if (!activeOrganizationId) {
    throw new AuthorizationError('An active organization is required.', 403)
  }

  const member = await prisma.member.findUnique({
    where: {
      organizationId_userId: {
        organizationId: activeOrganizationId,
        userId: session.user.id,
      },
    },
  })
  if (!member) {
    throw new AuthorizationError('You do not belong to the active organization.', 403)
  }

  if (!(await isWorkspaceOperational(member.organizationId))) {
    throw new AuthorizationError('This workspace is unavailable.', 403)
  }

  return {
    organizationId: member.organizationId,
    principal: {
      display: session.user.email,
      kind: 'session',
      sessionId: session.session.id,
      userId: session.user.id,
    },
    requestId: getRequestId(headers),
    role: normalizeOrganizationRole(member.role),
  }
}

export async function requireActiveOrganizationPermission(
  headers: Headers,
  permission: Permission
): Promise<OrganizationAccess> {
  const access = await requireActiveSessionOrganization(headers)
  if (!hasPermission(access.role, permission)) {
    throw new AuthorizationError('You do not have permission for this organization.', 403)
  }

  return access
}

export async function requireOrganizationPermission(
  headers: Headers,
  organizationId: string,
  permission: Permission
): Promise<OrganizationAccess> {
  const access = await requireActiveOrganizationPermission(headers, permission)
  if (access.organizationId !== organizationId) {
    throw new AuthorizationError('The requested organization is not active.', 403)
  }

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

  const grant = await prisma.supportAccessGrant.findFirst({
    where: {
      expiresAt: { gt: new Date() },
      organizationId,
      revokedAt: null,
      scope,
      userId: principal.userId,
    },
  })
  if (!grant) {
    throw new AuthorizationError('An active support grant is required.', 403)
  }

  const supportPrincipal: SupportPrincipal = {
    grantId: grant.id,
    kind: 'support',
    organizationId,
    userId: principal.userId,
  }
  return { organizationId, principal: supportPrincipal, requestId: getRequestId(headers) }
}

export async function requireSensitiveOrganizationPermission(
  headers: Headers,
  organizationId: string,
  permission: Permission
): Promise<OrganizationAccess> {
  const access = await requireOrganizationPermission(headers, organizationId, permission)
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session || Date.now() - session.session.createdAt.getTime() > freshSessionAgeMilliseconds) {
    throw new AuthorizationError('A fresh sign-in is required.', 401)
  }
  if (!session.user.twoFactorEnabled) {
    throw new AuthorizationError('Two-factor authentication is required.', 403)
  }

  return access
}

export async function requireEnterpriseFeature(
  organizationId: string,
  feature: 'scimEnabled' | 'ssoEnabled'
): Promise<void> {
  const settings = await prisma.organizationEnterpriseSettings.findUnique({
    where: { organizationId },
  })
  if (!settings?.[feature]) {
    throw new AuthorizationError('This organization does not have this enterprise feature.', 403)
  }
}
