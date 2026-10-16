import 'server-only'

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appOrigin } from '@/lib/sharing/page'
import type { ProviderSlug } from './schema'

/**
 * OAuth state for a connection in progress: a random value in a short-lived,
 * HTTP-only cookie scoped to the integration routes, checked on the way back
 * along with the workspace that started it.
 */

const COOKIE_PREFIX = 'shots_oauth_'
const STATE_TTL_SECONDS = 600

/** Where the provider sends the user back. Register this URL with each provider app. */
export function redirectUri(slug: ProviderSlug): string {
  return new URL(`/api/integrations/${slug}/callback`, appOrigin()).toString()
}

/** A new state and the cookie that remembers it for `organizationId`. */
export function startState(
  slug: ProviderSlug,
  organizationId: string
): { cookie: string; state: string } {
  const state = randomBytes(24).toString('base64url')
  const secure = appOrigin().startsWith('https://') ? '; Secure' : ''
  return {
    cookie: `${COOKIE_PREFIX}${slug}=${state}.${organizationId}; Path=/api/integrations/${slug}; Max-Age=${STATE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
    state,
  }
}

/** A cookie that clears the state once it has been used. */
export function clearState(slug: ProviderSlug): string {
  return `${COOKIE_PREFIX}${slug}=; Path=/api/integrations/${slug}; Max-Age=0; HttpOnly; SameSite=Lax`
}

/** True when the returned state matches the cookie and the workspace that started the connection. */
export function checkState(
  cookies: string | null,
  slug: ProviderSlug,
  state: string | undefined,
  organizationId: string
): boolean {
  const value = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_PREFIX}${slug}=`))
    ?.slice(`${COOKIE_PREFIX}${slug}=`.length)
  if (!value || !state) return false
  const [stored, organization] = value.split('.')
  if (!stored || organization !== organizationId || stored.length !== state.length) return false
  return timingSafeEqual(Buffer.from(stored), Buffer.from(state))
}
