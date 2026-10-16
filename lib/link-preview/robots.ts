import {
  type LinkPreviewCrawlerAccess,
  linkPreviewCrawlerSchema,
} from '@/lib/api/contracts/link-preview'
import { CRAWLERS } from '@/lib/link-preview/crawlers'

/**
 * robots.txt, read the way RFC 9309 describes: a crawler uses the groups that
 * name it (or `*` when none do), the longest matching rule wins, and `allow`
 * wins a tie. `*` matches any run of characters and a trailing `$` anchors.
 */

type RobotsRule = { allow: boolean; path: string }
type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

/** The user-agent groups of a robots.txt file, in order. */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | undefined
  let collectingAgents = false
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.replace(/#.*$/, '').match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i)
    if (!match) continue
    const field = match[1]!.toLowerCase()
    const value = match[2]!
    if (field === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      collectingAgents = true
    } else if (field === 'allow' || field === 'disallow') {
      collectingAgents = false
      // An empty disallow allows everything, which is the default anyway.
      if (current && value) current.rules.push({ allow: field === 'allow', path: value })
    }
  }
  return groups
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
}

/** Whether `token` may crawl `path`, with the rule that decided. */
export function robotsAllows(
  groups: RobotsGroup[],
  token: string,
  path: string
): { allowed: boolean; rule?: string } {
  const name = token.toLowerCase()
  const named = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && name.startsWith(agent))
  )
  const applicable = named.length ? named : groups.filter((group) => group.agents.includes('*'))
  let best: RobotsRule | undefined
  for (const rule of applicable.flatMap((group) => group.rules)) {
    if (!matches(rule.path, path)) continue
    const longer = !best || rule.path.length > best.path.length
    const tieGoesToAllow = best && rule.path.length === best.path.length && rule.allow
    if (longer || tieGoesToAllow) best = rule
  }
  if (!best) return { allowed: true }
  return { allowed: best.allow, rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` }
}

/** Each platform crawler's access to `pageUrl` under `robotsText`. */
export function crawlerAccess(robotsText: string, pageUrl: string): LinkPreviewCrawlerAccess[] {
  const groups = parseRobots(robotsText)
  const { pathname, search } = new URL(pageUrl)
  return linkPreviewCrawlerSchema.options.map((crawler) => ({
    crawler,
    ...robotsAllows(groups, CRAWLERS[crawler].token, `${pathname}${search}`),
  }))
}
