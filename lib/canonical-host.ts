/**
 * The platform's public host. Pages requested on a retired host move here
 * permanently; API routes are not redirected, so webhooks and API clients
 * still configured with an old host keep working.
 */
export const CANONICAL_HOST = 'shots.playbookmedia.io'

const RETIRED_HOSTS = new Set(['shots.oppulence.io'])

/** Where a page request on a retired host belongs, or null to serve it here. */
export function canonicalRedirect(url: URL, host: string | null): URL | null {
  if (!host || !RETIRED_HOSTS.has(host.toLowerCase())) return null
  const target = new URL(url)
  target.protocol = 'https:'
  target.host = CANONICAL_HOST
  return target
}
