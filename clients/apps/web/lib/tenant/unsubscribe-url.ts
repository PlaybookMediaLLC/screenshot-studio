import 'server-only'

import { getAuthBaseUrl } from '@/lib/auth/environment'
import { createUnsubscribeToken, type UnsubscribeClaim } from './unsubscribe-token'

/**
 * Absolute unsubscribe URL for a recipient.
 *
 * Separate from token signing because this reads deployment
 * configuration, which is server-only, while the token logic is pure and
 * must stay importable from tests and route handlers.
 */
export function getUnsubscribeUrl(claim: UnsubscribeClaim): string {
  const url = new URL('/api/unsubscribe', getAuthBaseUrl())
  url.searchParams.set('token', createUnsubscribeToken(claim))
  return url.toString()
}
