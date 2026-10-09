import {
  type LaunchChannel,
  type LaunchPost,
  type ReleaseSpecContent,
  resolveClaimRef,
} from './spec-schema'

/**
 * Deterministic checks on generated copy, run before anything is saved. The
 * model gets the problems back and fixes them in the same run; anything still
 * failing is never stored.
 */

/** Words that make launch copy read as hype. Brand-prohibited terms are added per workspace. */
export const HYPE_TERMS = [
  'revolutionary',
  'game-changing',
  'game changer',
  'seamless',
  'seamlessly',
  'unleash',
  'supercharge',
  'cutting-edge',
  'next-level',
  'groundbreaking',
  'best-in-class',
  'world-class',
  'synergy',
  'paradigm',
  'disruptive',
] as const

type ChannelRule = {
  /** Copy plus call to action, as it will be posted. */
  bodyMax: number
  hashtagMax: number
  /** Whether the channel needs a title (subject, tagline, heading). */
  title: { max: number; required: boolean }
}

export const CHANNEL_RULES: Record<LaunchChannel, ChannelRule> = {
  changelog: { bodyMax: 4_000, hashtagMax: 0, title: { max: 100, required: true } },
  email: { bodyMax: 5_000, hashtagMax: 0, title: { max: 90, required: true } },
  instagram: { bodyMax: 2_200, hashtagMax: 5, title: { max: 0, required: false } },
  linkedin: { bodyMax: 3_000, hashtagMax: 3, title: { max: 0, required: false } },
  product_hunt: { bodyMax: 260, hashtagMax: 0, title: { max: 60, required: true } },
  x: { bodyMax: 280, hashtagMax: 2, title: { max: 0, required: false } },
}

export type GuardContext = {
  /** Hosts copy may link to: the product and the release's sources. */
  allowedHosts: ReadonlySet<string>
  prohibitedTerms: readonly string[]
  spec: ReleaseSpecContent
}

const URL_PATTERN =
  /\bhttps?:\/\/[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+(?:com|io|dev|app|co|ai|net|org|so)\b(?:\/[^\s<>()"']*)?/gi
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

export function hostOf(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function findTerm(text: string, term: string): boolean {
  const escaped = term
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.length > 0 && new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)
}

/** Every problem with one post, phrased as an instruction the model can act on. */
export function checkLaunchPost(post: LaunchPost, context: GuardContext): string[] {
  const issues: string[] = []
  const rule = CHANNEL_RULES[post.channel]
  const body = [post.copy, post.callToAction].filter(Boolean).join(' ')
  const label = `${post.channel} post (${post.angleKey})`

  if (body.length > rule.bodyMax) {
    issues.push(
      `${label}: ${body.length} characters with the call to action; the limit is ${rule.bodyMax}.`
    )
  }
  if (rule.title.required && !post.title) issues.push(`${label}: needs a title.`)
  if (!rule.title.required && post.title)
    issues.push(`${label}: leave the title empty for this channel.`)
  if (post.title.length > rule.title.max && rule.title.required) {
    issues.push(
      `${label}: title is ${post.title.length} characters; the limit is ${rule.title.max}.`
    )
  }
  const hashtags = body.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0
  if (hashtags > rule.hashtagMax) {
    issues.push(`${label}: ${hashtags} hashtags; use at most ${rule.hashtagMax}.`)
  }

  const words = `${post.title} ${body}`
  for (const term of [...HYPE_TERMS, ...context.prohibitedTerms]) {
    if (findTerm(words, term)) issues.push(`${label}: remove "${term}".`)
  }
  if (EMAIL_PATTERN.test(words)) issues.push(`${label}: do not include email addresses.`)
  for (const link of words.match(URL_PATTERN) ?? []) {
    const host = hostOf(link)
    if (
      !host ||
      ![...context.allowedHosts].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    ) {
      issues.push(`${label}: link ${link} is not the product or one of the release's sources.`)
    }
  }
  for (const claim of post.claims) {
    if (!resolveClaimRef(context.spec, claim.ref)) {
      issues.push(`${label}: claim ref ${claim.ref} is not in the spec.`)
    }
  }
  return issues
}

/** Hosts the copy may link to, from the product URL and the release's sources. */
export function allowedHostsFrom(urls: ReadonlyArray<string | null | undefined>): Set<string> {
  const hosts = new Set<string>()
  for (const url of urls) {
    const host = url ? hostOf(url) : null
    if (host) hosts.add(host)
  }
  return hosts
}
