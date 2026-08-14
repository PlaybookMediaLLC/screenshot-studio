import 'server-only'

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
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

function getRequestId(headers: Headers): string {
  return headers.get('x-request-id') ?? randomUUID()
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

export async function requireOrganizationPermission(
  headers: Headers,
  organizationId: string,
  permission: Permission
): Promise<OrganizationAccess> {
  const principal = await getSessionPrincipal(headers)
  if (!principal) {
    throw new AuthorizationError('Authentication is required.', 401)
  }

  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId: principal.userId } },
  })
  if (!member || !hasPermission(member.role, permission)) {
    throw new AuthorizationError('You do not have permission for this organization.', 403)
  }

  return {
    organizationId,
    principal,
    requestId: getRequestId(headers),
    role: normalizeOrganizationRole(member.role),
  }
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
