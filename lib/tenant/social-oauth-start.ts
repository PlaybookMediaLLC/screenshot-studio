import 'server-only'

import {
  AuthorizationError,
  requireSessionAccess,
  requireSensitiveActiveOrganizationPermission,
} from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import { beginBackendSocialOAuth, PublishingBackendError } from './publishing-backend'
import type { SocialOAuthStartOptions } from 'screenshot-studio-backend-sdk'
import type { SocialOAuthProvider } from './social-oauth-callback'

export class SocialOAuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 503
  ) {
    super(message)
  }
}

/**
 * Begins a provider connection. With a social set, the backend binds the set
 * to the grant (RFC 043), so the account joins that set whatever is selected
 * when the provider sends the person back.
 */
export async function startSocialOAuth(
  headers: Headers,
  provider: SocialOAuthProvider,
  socialSetId?: string,
  options: SocialOAuthStartOptions = {}
): Promise<string> {
  const access = await requireSensitiveActiveOrganizationPermission(headers, 'publish:manage')
  return beginBackendSocialOAuth(access, provider, socialSetId, options)
}

async function getMatchingStart(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  integrationId?: string
) {
  const session = await requireSessionAccess(headers)
  const context = await backendSDK({ ...session, organizationId: '' }).resolveSocialOAuthContext(
    provider,
    state
  )
  const backend = backendSDK({ ...session, organizationId: context.organizationId })
  await backend.verifySocialOAuth(provider, state, integrationId)
  return backend
}

/** Return navigation belongs to the authorization attempt, never a shared tab cookie. */
export async function socialOAuthReturnPath(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string
): Promise<string> {
  const session = await requireSessionAccess(headers)
  const context = await backendSDK({ ...session, organizationId: '' }).resolveSocialOAuthContext(
    provider,
    state
  )
  return context.returnPath
}

export async function exchangeSocialOAuthCallback(
  headers: Headers,
  provider: SocialOAuthProvider,
  state: string,
  code: string
) {
  const access = await getMatchingStart(headers, provider, state)
  return access.exchangeSocialOAuth(provider, state, code)
}

export async function selectInstagramOAuthPage(
  headers: Headers,
  input: { state: string; integrationId: string; accountId: string; pageId: string }
): Promise<void> {
  const access = await getMatchingStart(headers, 'instagram', input.state, input.integrationId)
  await access.selectInstagramOAuthPage(input)
}

export async function rememberInstagramIntegration(
  headers: Headers,
  state: string,
  integrationId: string
): Promise<void> {
  const access = await getMatchingStart(headers, 'instagram', state)
  await access.rememberInstagramIntegration(state, integrationId)
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
  await access.completeSocialOAuth(provider, state, integrationId)
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
