/**
 * Parse a Figma file link (`/file/`, `/design/`, or `/proto/` URLs) into
 * its file key and optional node id. Returns null for anything else.
 */
export function parseFigmaFileUrl(value: string): { fileKey: string; nodeId: string | null } | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !/(^|\.)figma\.com$/.test(url.hostname)) return null
  const match = /^\/(?:file|design|proto)\/([A-Za-z0-9]{10,64})(?:\/|$)/.exec(url.pathname)
  if (!match) return null
  const node = url.searchParams.get('node-id')
  return { fileKey: match[1], nodeId: node ? node.replace('-', ':') : null }
}
