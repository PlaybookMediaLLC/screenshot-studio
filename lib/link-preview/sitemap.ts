import { decodeEntities } from '@/lib/launch/sanitize'

/**
 * Sitemaps, read as the protocol defines them: a `<urlset>` of page `<loc>`s,
 * or a `<sitemapindex>` of child sitemap `<loc>`s. Pure, so it is testable.
 */

/** The `<loc>` entries of a sitemap, and whether it is an index of other sitemaps. */
export function parseSitemap(xml: string): { index: boolean; locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)]
    .map(([, loc]) => decodeEntities(loc!).trim())
    .filter((loc) => /^https?:\/\//i.test(loc))
  return { index: /<sitemapindex[\s>]/i.test(xml), locs: [...new Set(locs)] }
}

/** The `Sitemap:` URLs a robots.txt file lists. */
export function robotsSitemaps(robotsText: string): string[] {
  return [...robotsText.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)]
    .map(([, url]) => url!)
    .filter((url) => /^https?:\/\//i.test(url))
}

/** Prefer a reachable robots.txt declaration, falling back to the conventional location. */
export async function discoverSitemap(
  robotsText: string,
  origin: string,
  probe: (url: string) => Promise<boolean>
): Promise<string | undefined> {
  const declared = [...new Set(robotsSitemaps(robotsText))].slice(0, 5)
  const found = await Promise.all(declared.map(async (url) => (await probe(url)) ? url : undefined))
  const first = found.find(Boolean)
  if (first) return first
  const fallback = new URL('/sitemap.xml', origin).toString()
  return await probe(fallback) ? fallback : undefined
}
