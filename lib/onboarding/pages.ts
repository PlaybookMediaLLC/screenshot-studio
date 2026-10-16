import { parseRobots, robotsAllows } from '@/lib/link-preview/robots'

/**
 * Which pages of a product's site to read when onboarding
 * (docs/rfcs/012-product-intelligence.md, page discovery): same-origin pages
 * scored by path, robots.txt honored, the homepage excluded (it is always
 * read). Pure, so it is testable.
 */

/** The robots.txt token the link preview user agent identifies as. */
const ROBOTS_TOKEN = 'ScreenshotStudioLinkPreview'

const PATH_SCORES: Array<[RegExp, number]> = [
  [/^\/(legal|privacy|terms|cookies?)(\/|$)/, 0],
  [/^\/(pricing|plans)$/, 100],
  [/^\/(features?|product|solutions)(\/|$)/, 90],
  [/^\/(docs|documentation)$/, 70],
  [/^\/(changelog|releases|whats-new)$/, 70],
  [/^\/(about|customers|case-studies)(\/|$)/, 50],
  [/^\/blog\//, 20],
]
/** Any other page: worth reading only when nothing better exists. */
const OTHER_PAGE_SCORE = 5

/** How useful a page path is for describing the product; 0 means never read it. */
export function scorePagePath(pathname: string): number {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  if (path === '/') return 0
  return PATH_SCORES.find(([pattern]) => pattern.test(path))?.[1] ?? OTHER_PAGE_SCORE
}

function normalized(url: string): string | null {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * The best `limit` pages to read: on the homepage's origin, allowed by
 * robots.txt, scored above 0, highest score first and shallower paths first
 * on a tie. Query strings and fragments are dropped and duplicates removed.
 */
export function pickTopPages(
  homepageUrl: string,
  candidates: readonly string[],
  options: { limit: number; robotsTxt?: string }
): string[] {
  const home = normalized(homepageUrl)
  if (!home) return []
  const { origin } = new URL(home)
  const robots = parseRobots(options.robotsTxt ?? '')
  const seen = new Set<string>([home])
  const scored: Array<{ depth: number; score: number; url: string }> = []
  for (const candidate of candidates) {
    const url = normalized(candidate)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const { origin: pageOrigin, pathname } = new URL(url)
    if (pageOrigin !== origin) continue
    const score = scorePagePath(pathname)
    if (score === 0 || !robotsAllows(robots, ROBOTS_TOKEN, pathname).allowed) continue
    scored.push({ depth: pathname.split('/').length, score, url })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.depth - b.depth)
    .slice(0, options.limit)
    .map((page) => page.url)
}
