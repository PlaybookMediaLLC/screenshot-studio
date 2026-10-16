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
