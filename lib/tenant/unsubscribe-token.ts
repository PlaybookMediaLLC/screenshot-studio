import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed unsubscribe tokens.
 *
 * The unsubscribe endpoint is public and unauthenticated, because a
 * recipient must be able to use it without an account. Without a
 * signature the address in the URL could be edited to unsubscribe an
 * arbitrary person, so the token binds the organization and the address
 * together and is verified before any state changes.
 *
 * This module deliberately avoids `server-only` and any config import:
 * it is pure crypto over its inputs, which keeps it testable and usable
 * from route handlers without dragging server-only modules along.
 */

export interface UnsubscribeClaim {
  email: string
  organizationId: string
}

function getSigningSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required to sign unsubscribe links.')
  }
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url')
}

function encodeClaim(claim: UnsubscribeClaim): string {
  return `${claim.organizationId}:${claim.email}`
}

export function createUnsubscribeToken(claim: UnsubscribeClaim): string {
  const payload = encodeClaim(claim)
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
}

export function verifyUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }

  const [encoded, signature] = parts
  if (!encoded || !signature) {
    return null
  }

  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString()
  } catch {
    return null
  }

  const provided = Buffer.from(signature)
  const computed = Buffer.from(sign(payload))

  // Constant-time comparison so the endpoint does not leak whether a
  // guessed signature prefix was correct.
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return null
  }

  // Split on the first separator: the organization ID never contains a
  // colon, but an email address legally may.
  const separator = payload.indexOf(':')
  if (separator < 1 || separator === payload.length - 1) {
    return null
  }

  return {
    email: payload.slice(separator + 1),
    organizationId: payload.slice(0, separator),
  }
}
