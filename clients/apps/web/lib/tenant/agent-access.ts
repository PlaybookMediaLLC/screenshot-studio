import 'server-only'

import { z } from 'zod'
import type { OrganizationAccess } from '@/lib/auth/access'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'
import { backendSDK } from '@/lib/backend/sdk'

/**
 * Agent consent (RFC 026). An MCP client's OAuth authorization request lands
 * on /oauth/authorize; a signed-in owner or admin approves it, and the Go
 * backend issues the single-use code the client trades for a scoped key.
 */

/** The OAuth authorization request, as the client sends it in the query. */
export const agentAuthorizationQuerySchema = z.object({
  client_id: z.string().min(1).max(200),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  redirect_uri: z.string().max(2000).default(''),
  resource: z.string().max(2000).optional(),
  response_type: z.literal('code'),
  scope: z.string().max(1000).optional(),
  state: z.string().max(2000).optional(),
})

/** The consent form: the request, carried in hidden fields, plus the member's choices. */
export const agentConsentFormSchema = agentAuthorizationQuerySchema.extend({
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
  scopes: z.array(z.enum(apiKeyScopes)).max(apiKeyScopes.length),
})

/** The scopes the client asked for that are API key scopes. */
export function requestedScopes(scope: string | undefined) {
  return apiKeyScopes.filter((known) => scope?.split(/\s+/).includes(known))
}

function backendRequest(
  query: z.infer<typeof agentAuthorizationQuerySchema>,
  scopes: string[] = [],
  expiresInDays?: number
) {
  return {
    clientId: query.client_id,
    codeChallenge: query.code_challenge || undefined,
    codeChallengeMethod: query.code_challenge_method || undefined,
    expiresInDays,
    redirectUri: query.redirect_uri,
    resource: query.resource || undefined,
    scopes,
  }
}

/** Validates the request before consent; the backend refuses unknown clients and redirects. */
export async function previewAgentAuthorization(
  access: OrganizationAccess,
  query: z.infer<typeof agentAuthorizationQuerySchema>
) {
  return backendSDK(access).previewAgentAuthorization(backendRequest(query))
}

/** Records the approval and returns the code with the redirect it goes to. */
export async function approveAgentAuthorization(
  access: OrganizationAccess,
  form: z.infer<typeof agentConsentFormSchema>
) {
  return backendSDK(access).approveAgentAuthorization(
    backendRequest(form, form.scopes, form.expiresInDays)
  )
}

/** `redirectUri` with OAuth response parameters added. */
export function oauthRedirect(redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}
