import 'server-only'

import {
  AuthorizationError,
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
  type OrganizationAccess,
} from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import {
  beginBackendSocialOAuth,
  completeBackendSocialOAuth,
  PublishingBackendError,
  rememberBackendInstagramIntegration,
  verifyBackendSocialOAuth,
} from './publishing-backend'
import type { SocialOAuthProvider } from './postiz-oauth-callback'

export class SocialOAuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 503
  ) {
    super(message)
  }
}

export async function startSocialOAuth(
  headers: Headers,
  provider: SocialOAuthProvider
): Promise<string> {
  const active = await requireActiveOrganizationPermission(headers, 'publish:manage')
  const access = await requireSensitiveOrganizationPermission(
    headers,
    active.organizationId,
    'publish:manage'
  )
  return beginBackendSocialOAuth(access, provider)
}

async function getMatchingStart(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  integrationId?: string
): Promise<OrganizationAccess> {
  const access = await requireActiveOrganizationPermission(headers, 'publish:manage')
  await verifyBackendSocialOAuth(access, provider, state, integrationId)
  return access
}

export async function exchangeSocialOAuthCallback(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  code: string
) {
  const access = await getMatchingStart(headers, provider, state)
  return backendSDK(access).exchangeSocialOAuth(provider, state, code)
}

export async function selectInstagramOAuthPage(
  headers: Headers,
  input: { state: string; integrationId: string; accountId: string; pageId: string }
): Promise<void> {
  const access = await getMatchingStart(headers, 'instagram', input.state, input.integrationId)
  await backendSDK(access).selectInstagramOAuthPage(input)
}

export async function rememberInstagramIntegration(
  headers: Headers,
  state: string,
  integrationId: string
): Promise<void> {
  const access = await getMatchingStart(headers, 'instagram', state)
  await rememberBackendInstagramIntegration(access, state, integrationId)
}

export async function registerSocialOAuthDestination(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  integrationId: string
): Promise<void> {
  const access = await getMatchingStart(
    headers,
    provider,
    state,
    provider === 'instagram' ? integrationId : undefined
  )
  await completeBackendSocialOAuth(access, provider, state, integrationId)
}

export function socialOAuthErrorResponse(error: unknown): Response {
  if (error instanceof SocialOAuthError)
    return new Response(error.message, { status: error.status })
  if (error instanceof AuthorizationError)
    return new Response(error.message, { status: error.status })
  if (error instanceof PublishingBackendError) {
    return new Response(error.message, { status: error.status })
  }
  return new Response('Social connection failed. Please start again.', { status: 502 })
}
