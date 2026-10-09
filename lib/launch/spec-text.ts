import {
  type ReleaseSpecContent,
  sourceRefSchema,
  specSectionSchemas,
  type SpecSectionKey,
} from './spec-schema'

/**
 * A plain-text editing format for spec sections, so a reviewer edits a
 * section as text and keeps its citations:
 *
 *   claims         Teams lose hours chasing approvals [S1, brief]
 *   audience       Agency owners — ship client reports faster [brief]
 *   capabilities   Recurring invoices — send on a schedule [S2]
 *   beforeAfter    Manual reminders → automatic retries [S1]
 *   faqs           Q: Does it work with Stripe?
 *                  A: Yes, through the existing connection. [S2]
 *   summary        One paragraph. [S1, brief]
 *
 * Every factual line ends in its citations. `parseSection` reports the line
 * of each problem so the editor can point at it.
 */

export type ParseResult<T> = { errors: string[]; ok: false } | { ok: true; value: T }

const CITATION = /\s*\[([^\]]*)\]\s*$/

function splitCitation(
  line: string,
  lineNumber: number,
  errors: string[]
): { body: string; sources: string[] } | null {
  const match = line.match(CITATION)
  if (!match) {
    errors.push(`Line ${lineNumber}: end it with its sources, such as [brief] or [S1].`)
    return null
  }
  const sources = match[1]!
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const invalid = sources.filter((value) => !sourceRefSchema.safeParse(value).success)
  if (sources.length === 0 || invalid.length > 0) {
    errors.push(
      `Line ${lineNumber}: ${invalid.length ? `"${invalid.join(', ')}" is not a source` : 'add a source'}; use brief or S1, S2…`
    )
    return null
  }
  return { body: line.slice(0, match.index).trim(), sources: [...new Set(sources)] }
}

const cite = (sources: string[]) => ` [${sources.join(', ')}]`
const lines = (value: string) =>
  value
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => entry.line.length > 0)

/** "a — b", also accepting " - " and " – " as the separator. */
function splitPair(body: string, separator: RegExp): [string, string] | null {
  const match = body.match(separator)
  if (!match || match.index === undefined) return null
  const left = body.slice(0, match.index).trim()
  const right = body.slice(match.index + match[0].length).trim()
  return left && right ? [left, right] : null
}

const DASH = /\s+[—–-]\s+/
const ARROW = /\s*(→|->)\s*/

type ClaimListKey = 'problem' | 'whatChanged' | 'proofPoints' | 'limitations'
const CLAIM_LISTS: readonly SpecSectionKey[] = [
  'problem',
  'whatChanged',
  'proofPoints',
  'limitations',
]

export type TextSection = Exclude<SpecSectionKey, 'messaging' | 'openQuestions'>
export const TEXT_SECTIONS: readonly TextSection[] = [
  'summary',
  'problem',
  'audience',
  'whatChanged',
  'capabilities',
  'beforeAfter',
  'proofPoints',
  'limitations',
  'faqs',
]

export function formatSection(spec: ReleaseSpecContent, section: TextSection): string {
  if (section === 'summary') return spec.summary.text + cite(spec.summary.sources)
  if ((CLAIM_LISTS as readonly string[]).includes(section)) {
    return spec[section as ClaimListKey].map((claim) => claim.text + cite(claim.sources)).join('\n')
  }
  if (section === 'audience') {
    return spec.audience
      .map((item) => `${item.segment} — ${item.need}${cite(item.sources)}`)
      .join('\n')
  }
  if (section === 'capabilities') {
    return spec.capabilities
      .map((item) => `${item.name} — ${item.description}${cite(item.sources)}`)
      .join('\n')
  }
  if (section === 'beforeAfter') {
    return spec.beforeAfter
      .map((item) => `${item.before} → ${item.after}${cite(item.sources)}`)
      .join('\n')
  }
  return spec.faqs
    .map((item) => `Q: ${item.question}\nA: ${item.answer}${cite(item.sources)}`)
    .join('\n\n')
}

export function parseSection(section: TextSection, value: string): ParseResult<unknown> {
  const errors: string[] = []
  let parsed: unknown
  if (section === 'summary') {
    const flat = value.trim().replace(/\s*\n\s*/g, ' ')
    const split = splitCitation(flat, 1, errors)
    parsed = split ? { sources: split.sources, text: split.body } : null
  } else if ((CLAIM_LISTS as readonly string[]).includes(section)) {
    parsed = lines(value).flatMap(({ line, number }) => {
      const split = splitCitation(line, number, errors)
      return split ? [{ sources: split.sources, text: split.body }] : []
    })
  } else if (section === 'audience' || section === 'capabilities' || section === 'beforeAfter') {
    const separator = section === 'beforeAfter' ? ARROW : DASH
    const hint =
      section === 'beforeAfter'
        ? 'before → after'
        : section === 'audience'
          ? 'segment — need'
          : 'name — description'
    parsed = lines(value).flatMap<unknown>(({ line, number }) => {
      const split = splitCitation(line, number, errors)
      if (!split) return []
      const pair = splitPair(split.body, separator)
      if (!pair) {
        errors.push(`Line ${number}: write it as "${hint}".`)
        return []
      }
      const [left, right] = pair
      if (section === 'audience') return [{ need: right, segment: left, sources: split.sources }]
      if (section === 'capabilities')
        return [{ description: right, name: left, sources: split.sources }]
      return [{ after: right, before: left, sources: split.sources }]
    })
  } else {
    parsed = parseFaqs(value, errors)
  }
  if (errors.length > 0) return { errors, ok: false }
  const result = specSectionSchemas[section].safeParse(parsed)
  if (!result.success) {
    return {
      errors: result.error.issues.map(
        (issue) => `${issue.path.join('.') || section}: ${issue.message}`
      ),
      ok: false,
    }
  }
  return { ok: true, value: result.data }
}

function parseFaqs(value: string, errors: string[]) {
  const blocks = value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
  return blocks.flatMap((block, index) => {
    const [first = '', ...rest] = block.split('\n').map((line) => line.trim())
    const question = first.replace(/^Q:\s*/i, '').trim()
    const answerLine = rest
      .join(' ')
      .replace(/^A:\s*/i, '')
      .trim()
    if (!/^Q:/i.test(first) || !answerLine) {
      errors.push(`FAQ ${index + 1}: write it as "Q: question" then "A: answer [source]".`)
      return []
    }
    const split = splitCitation(answerLine, index + 1, errors)
    return split ? [{ answer: split.body, question, sources: split.sources }] : []
  })
}

// Messaging has parts of different shapes, edited as separate fields.

export function formatPillars(spec: ReleaseSpecContent): string {
  return spec.messaging.pillars
    .map((pillar) => `${pillar.title} — ${pillar.message}${cite(pillar.sources)}`)
    .join('\n')
}

export function parsePillars(
  value: string
): ParseResult<ReleaseSpecContent['messaging']['pillars']> {
  const errors: string[] = []
  const pillars = lines(value).flatMap(({ line, number }) => {
    const split = splitCitation(line, number, errors)
    if (!split) return []
    const pair = splitPair(split.body, DASH)
    if (!pair) {
      errors.push(`Line ${number}: write it as "pillar — message".`)
      return []
    }
    return [{ message: pair[1], sources: split.sources, title: pair[0] }]
  })
  if (errors.length > 0) return { errors, ok: false }
  const result = specSectionSchemas.messaging.shape.pillars.safeParse(pillars)
  return result.success
    ? { ok: true, value: result.data }
    : { errors: result.error.issues.map((issue) => issue.message), ok: false }
}

export function formatPositioning(spec: ReleaseSpecContent): string {
  const { sources, statement } = spec.messaging.positioning
  return statement ? statement + (sources.length ? cite(sources) : '') : ''
}

export function parsePositioning(
  value: string
): ParseResult<{ sources: string[]; statement: string }> {
  const flat = value.trim().replace(/\s*\n\s*/g, ' ')
  if (!flat) return { ok: true, value: { sources: [], statement: '' } }
  const errors: string[] = []
  const split = splitCitation(flat, 1, errors)
  if (!split) return { errors, ok: false }
  return { ok: true, value: { sources: split.sources, statement: split.body } }
}

/** One item per line, no citations (CTAs, alternatives). */
export function parsePlainList(
  value: string,
  max: number,
  maxLength: number
): ParseResult<string[]> {
  const items = lines(value).map(({ line }) => line.replace(/^[-•]\s*/, ''))
  const errors: string[] = []
  if (items.length > max) errors.push(`Keep it to ${max} or fewer.`)
  items.forEach((item, index) => {
    if (item.length > maxLength)
      errors.push(`Line ${index + 1}: keep it under ${maxLength} characters.`)
  })
  return errors.length > 0 ? { errors, ok: false } : { ok: true, value: items }
}
