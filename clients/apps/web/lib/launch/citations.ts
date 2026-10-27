import type { ReleaseSpecContent, SpecSectionKey } from './spec-schema'

/**
 * Citation checks for a drafted spec.
 *
 * The model must cite "brief" or a source it was given. A citation to a source
 * that does not exist is how an invented fact gets dressed up as a sourced one,
 * so these checks run on every draft before it is saved: during generation the
 * problems go back to the model to fix, and as a last resort `enforceCitations`
 * drops bad citations and turns claims left with none into open questions.
 */

type Cited = { sources: string[] }

function isCited(value: unknown): value is Cited {
  return Boolean(value) && Array.isArray((value as Cited).sources)
}

/** Every unknown citation in a spec, as "section: S7" style messages for the model. */
export function findCitationIssues(
  spec: ReleaseSpecContent,
  knownSourceIds: ReadonlySet<string>
): string[] {
  const issues: string[] = []
  const check = (section: string, item: Cited, label: string) => {
    for (const ref of item.sources) {
      if (ref !== 'brief' && !knownSourceIds.has(ref)) {
        issues.push(
          `${section}: "${label.slice(0, 60)}" cites ${ref}, which is not a source. Cite brief or one of: ${[...knownSourceIds].join(', ') || 'brief only'}.`
        )
      }
    }
  }
  check('summary', spec.summary, spec.summary.text)
  const lists: Array<[SpecSectionKey, Array<Cited & Record<string, unknown>>]> = [
    ['problem', spec.problem],
    ['audience', spec.audience],
    ['whatChanged', spec.whatChanged],
    ['capabilities', spec.capabilities],
    ['beforeAfter', spec.beforeAfter],
    ['proofPoints', spec.proofPoints],
    ['limitations', spec.limitations],
    ['faqs', spec.faqs],
  ]
  for (const [section, items] of lists) {
    for (const item of items) check(section, item, describe(item))
  }
  for (const pillar of spec.messaging.pillars) check('messaging', pillar, pillar.title)
  if (spec.messaging.positioning.statement) {
    check('messaging', spec.messaging.positioning, spec.messaging.positioning.statement)
  }
  return issues
}

function describe(item: Record<string, unknown>): string {
  const value = item.text ?? item.name ?? item.segment ?? item.before ?? item.question ?? ''
  return String(value)
}

export type EnforcedSpec = { moved: number; spec: ReleaseSpecContent }

/**
 * Remove citations to unknown sources. A claim left with no valid citation is
 * not kept as a fact: it becomes an open question for the reviewer.
 */
export function enforceCitations(
  spec: ReleaseSpecContent,
  knownSourceIds: ReadonlySet<string>
): EnforcedSpec {
  let moved = 0
  const openQuestions = [...spec.openQuestions]
  const valid = (refs: string[]) => refs.filter((ref) => ref === 'brief' || knownSourceIds.has(ref))
  const keep = <T extends Cited & Record<string, unknown>>(section: SpecSectionKey, items: T[]) =>
    items.flatMap((item) => {
      const sources = valid(item.sources)
      if (sources.length > 0) return [{ ...item, sources }]
      moved += 1
      openQuestions.push({
        answer: '',
        question: `Can you confirm: ${describe(item).slice(0, 240)}?`,
        reason: 'The draft stated this without a source it was given.',
        section,
      })
      return []
    })

  const summarySources = valid(spec.summary.sources)
  const next: ReleaseSpecContent = {
    ...spec,
    audience: keep('audience', spec.audience),
    beforeAfter: keep('beforeAfter', spec.beforeAfter),
    capabilities: keep('capabilities', spec.capabilities),
    faqs: keep('faqs', spec.faqs),
    limitations: keep('limitations', spec.limitations),
    messaging: {
      ...spec.messaging,
      pillars: keep('messaging', spec.messaging.pillars),
      positioning: {
        ...spec.messaging.positioning,
        sources: valid(spec.messaging.positioning.sources),
      },
    },
    problem: keep('problem', spec.problem),
    proofPoints: keep('proofPoints', spec.proofPoints),
    // The summary always exists; without a valid source it rests on the brief
    // and the reviewer is asked to confirm it.
    summary: { ...spec.summary, sources: summarySources.length > 0 ? summarySources : ['brief'] },
    whatChanged: keep('whatChanged', spec.whatChanged),
  }
  if (summarySources.length === 0) {
    moved += 1
    openQuestions.push({
      answer: '',
      question: 'Is the summary accurate as written?',
      reason: 'The draft summary cited a source it was not given.',
      section: 'summary',
    })
  }
  next.openQuestions = openQuestions.slice(0, 15)
  return { moved, spec: next }
}

/** Which source ids a spec actually cites, for showing unused sources. */
export function citedSourceIds(spec: ReleaseSpecContent): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      if (isCited(value)) value.sources.forEach((ref) => ids.add(ref))
      Object.values(value).forEach(walk)
    }
  }
  walk(spec)
  return ids
}
