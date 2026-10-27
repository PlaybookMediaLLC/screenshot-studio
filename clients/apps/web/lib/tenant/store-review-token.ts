import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Store screenshot review links.
 *
 * A link names one review in one workspace and carries the review's share
 * token id. The HMAC stops anyone from editing the review or workspace in
 * a link; the backend still checks the token id and revocation on every
 * read and comment, so revoking a review kills every copy of its link.
 * Pure crypto over its inputs, like the unsubscribe token.
 */

/** What a review link grants: read and comment on one review. */
export type StoreReviewClaim = { reviewId: string; organizationId: string; shareTokenId: string }

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET
  if (!value) throw new Error('BETTER_AUTH_SECRET is required to sign review links.')
  return value
}

/** Not `.`: the proxy skips paths with dots, so `/review/<token>` would never reach the page. */
const SEPARATOR = '~'

function sign(payload: string): string {
  return createHmac('sha256', `store-review:${secret()}`).update(payload).digest('base64url')
}

/** Create a review link token. */
export function createStoreReviewToken(claim: StoreReviewClaim): string {
  const payload = Buffer.from(
    JSON.stringify([claim.reviewId, claim.organizationId, claim.shareTokenId])
  ).toString('base64url')
  return `${payload}${SEPARATOR}${sign(payload)}`
}

/** Verify a review link token. Null for anything forged or malformed. */
export function verifyStoreReviewToken(token: string | undefined): StoreReviewClaim | null {
  const [payload, signature, extra] = token?.split(SEPARATOR) ?? []
  if (!payload || !signature || extra !== undefined || token!.length > 600) return null
  const expected = Buffer.from(sign(payload))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      !parsed.every((value) => typeof value === 'string' && value.length > 0 && value.length < 200)
    ) {
      return null
    }
    const [reviewId, organizationId, shareTokenId] = parsed as [string, string, string]
    return { reviewId, organizationId, shareTokenId }
  } catch {
    return null
  }
}
