import {
  type CampaignPlanContent,
  PLAN_PHASE_LABELS,
  type ReleaseSpecContent,
  type SpecSectionKey,
} from '@/lib/launch/spec-schema'
import {
  formatPillars,
  formatPositioning,
  formatSection,
  TEXT_SECTIONS,
  type TextSection,
} from '@/lib/launch/spec-text'

/**
 * Turn revision targets into comparable text, so any proposal can be shown
 * as word diffs: spec sections in their editing format, posts field by field,
 * design text layers, and plans as readable lines.
 */

export type TextField = { after: string; before: string; label: string }

export function specSectionFields(
  section: SpecSectionKey,
  before: unknown,
  after: unknown
): TextField[] {
  const as = (value: unknown) => ({ [section]: value }) as unknown as ReleaseSpecContent
  if ((TEXT_SECTIONS as readonly string[]).includes(section)) {
    return [
      {
        after: formatSection(as(after), section as TextSection),
        before: formatSection(as(before), section as TextSection),
        label: 'Section',
      },
    ]
  }
  if (section === 'messaging') {
    const b = as(before)
    const a = as(after)
    return [
      { after: formatPillars(a), before: formatPillars(b), label: 'Pillars' },
      { after: formatPositioning(a), before: formatPositioning(b), label: 'Positioning' },
      {
        after: a.messaging.ctas.join('\n'),
        before: b.messaging.ctas.join('\n'),
        label: 'Calls to action',
      },
    ]
  }
  const questions = (value: unknown) =>
    (value as ReleaseSpecContent['openQuestions'])
      .map((question) => `${question.question}${question.answer ? ` → ${question.answer}` : ''}`)
      .join('\n')
  return [{ after: questions(after), before: questions(before), label: 'Open questions' }]
}

type PostFields = { callToAction?: string; copy?: string; title?: string }

export function postFields(before: unknown, after: unknown): TextField[] {
  const b = (before ?? {}) as PostFields
  const a = (after ?? {}) as PostFields
  const fields: TextField[] = []
  if (b.title || a.title)
    fields.push({ after: a.title ?? '', before: b.title ?? '', label: 'Title' })
  fields.push({ after: a.copy ?? '', before: b.copy ?? '', label: 'Copy' })
  if (b.callToAction || a.callToAction) {
    fields.push({
      after: a.callToAction ?? '',
      before: b.callToAction ?? '',
      label: 'Call to action',
    })
  }
  return fields
}

type DesignSide = { background?: { value?: string } | null; texts?: string[] }

export function designFields(before: unknown, after: unknown): TextField[] {
  const b = (before ?? {}) as DesignSide
  const a = (after ?? {}) as DesignSide
  const count = Math.max(b.texts?.length ?? 0, a.texts?.length ?? 0)
  const fields: TextField[] = Array.from({ length: count }, (_, index) => ({
    after: a.texts?.[index] ?? '',
    before: b.texts?.[index] ?? '',
    label: count > 1 ? `Text ${index + 1}` : 'Text',
  }))
  const beforeBackground = b.background?.value ?? ''
  const afterBackground = a.background?.value ?? ''
  if (beforeBackground !== afterBackground) {
    fields.push({ after: afterBackground, before: beforeBackground, label: 'Background' })
  }
  return fields
}

export function planLines(plan: CampaignPlanContent): string {
  return [
    plan.summary,
    '',
    ...plan.channels.map(
      (channel) => `Channel ${channel.channel}: ${channel.role} (${channel.cadence})`
    ),
    ...plan.angles.map((angle) => `${angle.key} ${angle.title}: ${angle.hook}`),
    ...plan.assets.map(
      (asset) =>
        `${asset.key} ${asset.kind} ${asset.format} ×${asset.variants}: “${asset.headline}”, ${asset.captureHint.focus}`
    ),
    ...plan.timeline.map(
      (item) =>
        `Day ${item.day} ${PLAN_PHASE_LABELS[item.phase]} · ${item.channel} · ${item.angleKey}${item.assetKeys.length ? ` · ${item.assetKeys.join(', ')}` : ''}${item.note ? ` · ${item.note}` : ''}`
    ),
  ].join('\n')
}

export function planFields(before: unknown, after: unknown): TextField[] {
  return [
    {
      after: planLines(after as CampaignPlanContent),
      before: planLines(before as CampaignPlanContent),
      label: 'Plan',
    },
  ]
}

export function changeFields(change: {
  after: unknown
  before: unknown
  targetKey?: string | null
  targetType: string
}): TextField[] {
  if (change.targetType === 'post') return postFields(change.before, change.after)
  if (change.targetType === 'design') return designFields(change.before, change.after)
  if (change.targetType === 'plan') return planFields(change.before, change.after)
  return specSectionFields(change.targetKey as SpecSectionKey, change.before, change.after)
}
