/**
 * Rate limit policies, kept free of any Redis import.
 *
 * `lib/rate-limit.ts` pulls in the Redis client, which is `server-only`.
 * Declaring the policies here lets route handlers, tests, and any future
 * edge-side logic reference the limits without dragging a server-only
 * transitive dependency along with them.
 */

export interface RateLimitPolicy {
  /** Namespace so different policies never share a counter for the same client. */
  name: string
  maxRequests: number
  windowMs: number
}

/**
 * Screenshot capture is expensive but user-driven, so the window stays
 * generous enough for normal editing sessions.
 */
export const SCREENSHOT_RATE_LIMIT: RateLimitPolicy = {
  maxRequests: 20,
  name: 'screenshot',
  windowMs: 60_000,
}

/**
 * Credential endpoints are the credential-stuffing surface. Ten attempts per
 * minute is far above what a human sign-in needs and far below what an
 * automated attack requires to be useful.
 */
export const AUTH_RATE_LIMIT: RateLimitPolicy = {
  maxRequests: 10,
  name: 'auth',
  windowMs: 60_000,
}
