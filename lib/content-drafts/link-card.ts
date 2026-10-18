import 'server-only'

import { safeFetchText } from '@/lib/launch/safe-fetch'
import { parseLinkPreview } from '@/lib/link-preview/metadata'

/**
 * The card a channel shows for a link in a post (RFC 037): its Open Graph
 * title, description, image and site. One page fetch through the same SSRF
 * guards as the link preview tool; no robots, sitemap or image checks.
 */
export async function readLinkCard(url: string) {
  const page = await safeFetchText(url, { maxBytes: 1_000_000 })
  if (!page.ok) return null
  const parsed = parseLinkPreview(page.body, page.url ?? url)
  return {
    description: parsed.ogDescription || parsed.description || null,
    image: parsed.ogImage || parsed.twitterImage || null,
    siteName: parsed.ogSiteName || null,
    title: parsed.ogTitle || parsed.title || null,
    url: page.url ?? url,
  }
}
