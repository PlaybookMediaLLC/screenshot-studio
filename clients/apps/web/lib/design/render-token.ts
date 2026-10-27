import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getAuthSecret } from '@/lib/auth/environment'

/**
 * Short-lived capability for the headless renderer to open one design.
 *
 * The render page has no user session: the server-side renderer opens it.
 * The token names one design and one workspace and expires in minutes, so a
 * leaked render URL cannot be replayed against other designs or later.
 */

const RENDER_TOKEN_TTL_MS = 5 * 60_000

function sign(payload: string): string {
  return createHmac('sha256', `design-render:${getAuthSecret()}`)
    .update(payload)
    .digest('base64url')
}

export function createRenderToken(designId: string, organizationId: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ designId, exp: now + RENDER_TOKEN_TTL_MS, organizationId })
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyRenderToken(
  token: string | undefined,
  designId: string,
  now = Date.now()
): { organizationId: string } | null {
  const [payload, signature] = token?.split('.') ?? []
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      designId?: unknown
      exp?: unknown
      organizationId?: unknown
    }
    if (
      claims.designId !== designId ||
      typeof claims.exp !== 'number' ||
      claims.exp < now ||
      typeof claims.organizationId !== 'string'
    ) {
      return null
    }
    return { organizationId: claims.organizationId }
  } catch {
    return null
  }
}
