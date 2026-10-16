import { z } from 'zod'
import { detectInjection, stripInvisible } from '@/lib/launch/sanitize'
import type {
  ProductProfileFieldName,
  ProductProfileValues,
} from '@/lib/tenant/product-profile-schema'

/**
 * What the model submits when it reads a product's site: each value cites
 * the source it came from ("brief" for the founder's own sentence, or a
 * fenced source id such as "S1"), so the profile can say where every field
 * came from. Empty text means the sources do not say. Pure, so it is testable.
 */

const sourceIdSchema = z
  .string()
  .trim()
  .regex(/^(brief|S\d{1,2})$/, 'Cite "brief" or a source id such as S1.')

const cited = (max: number) =>
  z.object({ source: sourceIdSchema, text: z.string().trim().max(max) })

/** The submitProductProfile tool's input. */
export const productProfileDraftSchema = z.object({
  audience: cited(1_000),
  capabilities: z.array(cited(300)).max(12),
  competitors: z.array(cited(100)).max(10),
  name: cited(160),
  pricingNote: cited(500),
  problem: cited(2_000),
  proofPoints: z.array(cited(500)).max(10),
  summary: cited(2_000),
})

/** One of {@link productProfileDraftSchema}. */
export type ProductProfileDraft = z.infer<typeof productProfileDraftSchema>

/** A source the model was given, as the draft checks see it. */
export type DraftSource = { flagged: boolean; id: string; status: string; url: string }

type CitedText = { source: string; text: string }

function entries(draft: ProductProfileDraft): Array<[string, CitedText]> {
  return [
    ['name', draft.name],
    ['summary', draft.summary],
    ['problem', draft.problem],
    ['audience', draft.audience],
    ['pricingNote', draft.pricingNote],
    ...draft.capabilities.map((item, index): [string, CitedText] => [
      `capabilities.${index}`,
      item,
    ]),
    ...draft.proofPoints.map((item, index): [string, CitedText] => [`proofPoints.${index}`, item]),
    ...draft.competitors.map((item, index): [string, CitedText] => [`competitors.${index}`, item]),
  ]
}

/**
 * Problems to fix before a draft is accepted: a value citing a source that
 * was not readable, citing a flagged source, or repeating instruction-like
 * text, and a missing name.
 */
export function draftIssues(
  draft: ProductProfileDraft,
  sources: readonly DraftSource[],
  hasBrief: boolean
): string[] {
  const issues: string[] = []
  if (!draft.name.text) issues.push('name is required.')
  for (const [path, value] of entries(draft)) {
    if (!value.text) continue
    if (value.source === 'brief') {
      if (!hasBrief) issues.push(`${path} cites brief, but there is no brief.`)
    } else {
      const source = sources.find((entry) => entry.id === value.source)
      if (!source || source.status !== 'ok') {
        issues.push(`${path} cites ${value.source}, which is not a readable source.`)
      } else if (source.flagged) {
        issues.push(`${path} cites ${value.source}, which is flagged; use an unflagged source.`)
      }
    }
    if (detectInjection(value.text).length > 0) {
      issues.push(`${path} repeats instruction-like text from a source; leave it out.`)
    }
  }
  return issues
}

/**
 * The automated profile change for a draft: only fields with a value, each
 * with the page it came from. A list field records its first item's page.
 */
export function draftToUpsert(
  draft: ProductProfileDraft,
  sources: readonly DraftSource[],
  url: string
): Partial<ProductProfileValues> & {
  sourceUrls: Partial<Record<ProductProfileFieldName, string>>
} {
  const sourceUrl = (value: CitedText) =>
    sources.find((source) => source.id === value.source)?.url || undefined
  const clean = (value: CitedText) => stripInvisible(value.text).trim()
  const list = (values: CitedText[]) => values.map(clean).filter(Boolean)
  const upsert: Partial<ProductProfileValues> = { url }
  const sourceUrls: Partial<Record<ProductProfileFieldName, string>> = {}
  const set = (field: ProductProfileFieldName, value: CitedText | undefined, text: unknown) => {
    if (!value || (Array.isArray(text) ? text.length === 0 : !text)) return
    Object.assign(upsert, { [field]: text })
    const from = sourceUrl(value)
    if (from) sourceUrls[field] = from
  }
  set('name', draft.name, clean(draft.name))
  set('summary', draft.summary, clean(draft.summary))
  set('problem', draft.problem, clean(draft.problem))
  set('audience', draft.audience, clean(draft.audience))
  set('pricingNote', draft.pricingNote, clean(draft.pricingNote))
  set('capabilities', draft.capabilities[0], list(draft.capabilities))
  set('competitors', draft.competitors[0], list(draft.competitors))
  set(
    'proofPoints',
    draft.proofPoints[0],
    draft.proofPoints
      .map((point) => ({ claim: clean(point), sourceUrl: sourceUrl(point) }))
      .filter((point) => point.claim)
  )
  return { ...upsert, sourceUrls }
}
