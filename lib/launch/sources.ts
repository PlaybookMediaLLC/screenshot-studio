import {
  clampText,
  defuseMarkup,
  detectInjection,
  fenceSource,
  htmlToText,
  stripInvisible,
} from './sanitize'
import { allowedTestHosts, type FetchedText, safeFetchText } from './safe-fetch'
import type { SpecSource } from './spec-schema'

/**
 * Collect what a release says about itself, for the spec drafter.
 *
 * The brief (fields a workspace member typed, plus answered open questions) is
 * trusted. Each source link and the product URL is fetched safely, reduced to
 * visible text, checked for prompt injection, and fenced as untrusted data
 * with an id (S1…) the spec's citations refer to. A release an integration
 * created (a webhook or an API key) has a brief nobody on the team wrote: it
 * is fenced and checked like a source, and listed with the sources so the
 * reviewer sees its flags.
 */

const MAX_SOURCES = 8
const PROMPT_CHARS_PER_SOURCE = 8_000
const EXCERPT_CHARS = 1_500
const MIN_USEFUL_CHARS = 40

export type ReleaseBrief = {
  answers: Array<{ answer: string; question: string }>
  audience: string | null
  benefitStatement: string
  description: string | null
  /** Who wrote the release fields; an integration's are untrusted. Defaults to member. */
  origin?: 'integration' | 'member'
  productName: string | null
  productUrl: string | null
  sourceUrls: string[]
  title: string
}

export type CollectedSources = {
  /** The trusted brief block for the prompt. */
  brief: string
  /** Fenced untrusted source blocks for the prompt. */
  fenced: string
  knownIds: Set<string>
  /** Snapshot stored with the spec, shown when a reviewer opens a citation. */
  sources: SpecSource[]
}

export type TextFetcher = (url: string, headers?: Record<string, string>) => Promise<FetchedText>

const defaultFetcher: TextFetcher = (url, headers) =>
  safeFetchText(url, { allowedPrivateHosts: allowedTestHosts(), headers })

function sourceKind(url: string, productUrl: string | null): SpecSource['kind'] {
  if (productUrl && url === productUrl) return 'product_page'
  const lower = url.toLowerCase()
  if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(lower)) return 'pull_request'
  if (/\/releases?(\/|$)|\/tag\/|\/blog\/|announcing|introducing/.test(lower)) return 'release'
  if (/changelog|release-notes|whats-new|what-s-new|updates/.test(lower)) return 'changelog'
  if (/(^https?:\/\/docs\.)|\/docs?(\/|$)|\/guide|\/help\//.test(lower)) return 'docs'
  return 'page'
}

/** GitHub pages are heavy; their API returns the title and body directly. */
function githubApi(url: string): string | null {
  const match = url.match(
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues|releases\/tag)\/([^/?#]+)/
  )
  if (!match) return null
  const [, owner, repo, type, id] = match
  if (type === 'releases/tag')
    return `https://api.github.com/repos/${owner}/${repo}/releases/tags/${id}`
  return `https://api.github.com/repos/${owner}/${repo}/${type === 'pull' ? 'pulls' : 'issues'}/${id}`
}

type ReadSource = {
  flags: string[]
  sections: SpecSource['sections']
  status: SpecSource['status']
  statusReason: string
  text: string
  title: string
}

async function readSource(url: string, fetcher: TextFetcher): Promise<ReadSource> {
  const api = githubApi(url)
  const fetched = await fetcher(
    api ?? url,
    api ? { accept: 'application/vnd.github+json' } : undefined
  )
  if (!fetched.ok) {
    return {
      flags: [],
      sections: [],
      status: fetched.status,
      statusReason: fetched.reason,
      text: '',
      title: '',
    }
  }
  let title = ''
  let text = ''
  let hidden = ''
  let sections: SpecSource['sections'] = []
  if (api) {
    try {
      const data = JSON.parse(fetched.body) as {
        body?: string | null
        name?: string
        title?: string
      }
      title = stripInvisible(data.title ?? data.name ?? '')
      text = stripInvisible(`${title}\n\n${data.body ?? ''}`)
    } catch {
      return {
        flags: [],
        sections: [],
        status: 'failed',
        statusReason: 'GitHub returned an unreadable response.',
        text: '',
        title: '',
      }
    }
  } else if (fetched.contentType.includes('html')) {
    const page = htmlToText(fetched.body)
    title = page.title
    text = page.text
    hidden = page.hidden
    sections = page.sections
  } else {
    text = stripInvisible(fetched.body)
  }
  const flags = detectInjection(text).map((flag) => `${flag.reason}: “${flag.snippet}”`)
  for (const flag of detectInjection(hidden)) {
    flags.push(`hidden text in the page ${flag.reason}: “${flag.snippet}”`)
  }
  const status = text.trim().length < MIN_USEFUL_CHARS ? 'empty' : 'ok'
  return {
    flags,
    sections,
    status,
    statusReason:
      status === 'empty'
        ? 'The page had almost no readable text.'
        : fetched.truncated
          ? 'Long page; read the first part.'
          : '',
    text,
    title: title || url,
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index]!)
      }
    })
  )
  return results
}

function releaseText(brief: ReleaseBrief): string {
  return stripInvisible(
    [brief.title, brief.benefitStatement, brief.description, brief.audience]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join('\n\n')
  )
}

function briefFlags(brief: ReleaseBrief): string[] {
  if (brief.origin !== 'integration') return []
  return detectInjection(releaseText(brief)).map((flag) => `${flag.reason}: “${flag.snippet}”`)
}

export function formatBrief(brief: ReleaseBrief): string {
  const integration = brief.origin === 'integration'
  const clean = (value: string) =>
    defuseMarkup((integration ? stripInvisible(value) : value).trim())
  const field = (label: string, value: string | null) =>
    value && value.trim() ? `${label}: ${clean(value)}` : null
  const answered = brief.answers.filter((entry) => entry.answer.trim())
  return [
    integration
      ? `<brief id="brief" trust="untrusted" origin="integration" flagged="${briefFlags(brief).length > 0}">\nSent by an integration (a webhook or an API key), not written by the team.`
      : '<brief id="brief" trust="trusted">',
    field('Release title', brief.title),
    field('Why it matters', brief.benefitStatement),
    field('Description', brief.description),
    field('Audience', brief.audience),
    field(
      'Product',
      brief.productName && brief.productUrl
        ? `${brief.productName} (${brief.productUrl})`
        : brief.productName
    ),
    answered.length
      ? `Answers from the team:\n${answered.map((entry) => `- Q: ${defuseMarkup(entry.question)}\n  A: ${defuseMarkup(entry.answer)}`).join('\n')}`
      : null,
    '</brief>',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function collectReleaseSources(
  brief: ReleaseBrief,
  fetcher: TextFetcher = defaultFetcher,
  now: () => Date = () => new Date()
): Promise<CollectedSources> {
  const urls: string[] = []
  for (const url of [...brief.sourceUrls, brief.productUrl]) {
    if (url && !urls.includes(url) && urls.length < MAX_SOURCES) urls.push(url)
  }
  const read = await mapLimit(urls, 4, (url) => readSource(url, fetcher))
  const fetchedAt = now().toISOString()
  const sources: SpecSource[] = urls.map((url, index) => {
    const result = read[index]!
    return {
      excerpt: clampText(result.text, EXCERPT_CHARS),
      fetchedAt,
      flagged: result.flags.length > 0,
      flags: result.flags,
      id: `S${index + 1}`,
      kind: sourceKind(url, brief.productUrl),
      sections: result.sections,
      status: result.status,
      statusReason: result.statusReason,
      title: result.title || url,
      url,
    }
  })
  const flags = briefFlags(brief)
  const briefSource: SpecSource | null =
    brief.origin === 'integration'
      ? {
          excerpt: clampText(releaseText(brief), EXCERPT_CHARS),
          fetchedAt,
          flagged: flags.length > 0,
          flags,
          id: 'brief',
          kind: 'release',
          sections: [],
          status: 'ok',
          statusReason: '',
          title: 'Release brief from an integration',
          url: '',
        }
      : null
  const fenced = sources
    .map((source, index) =>
      source.status === 'ok'
        ? fenceSource({
            flagged: source.flagged,
            id: source.id,
            kind: source.kind,
            text: clampText(read[index]!.text, PROMPT_CHARS_PER_SOURCE),
            title: source.title,
            url: source.url,
          })
        : `<source id="${source.id}" status="${source.status}">Not readable: ${defuseMarkup(source.statusReason)} Do not cite it.</source>`
    )
    .join('\n\n')
  return {
    brief: formatBrief(brief),
    fenced,
    knownIds: new Set(
      sources.filter((source) => source.status === 'ok').map((source) => source.id)
    ),
    // The brief is always citable; listed here only so its flags reach the reviewer.
    sources: briefSource ? [briefSource, ...sources] : sources,
  }
}
