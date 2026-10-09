'use client'

import { PencilEdit02Icon } from 'hugeicons-react'
import { ArrowRight } from 'lucide-react'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { RevisePanel } from '@/components/launch/RevisePanel'
import { Group, Section } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import {
  type ReleaseSpecContent,
  SPEC_SECTION_LABELS,
  type SpecSectionKey,
  specSectionSchemas,
} from '@/lib/launch/spec-schema'
import {
  formatPillars,
  formatPositioning,
  formatSection,
  parsePillars,
  parsePlainList,
  parsePositioning,
  parseSection,
  type TextSection,
} from '@/lib/launch/spec-text'
import { Citations, type SourceIndex } from './citations'

export type EditableSection = Exclude<SpecSectionKey, 'openQuestions'>

function Item({ children }: { children: ReactNode }) {
  return <div className="px-5 py-4">{children}</div>
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-md bg-white/[0.04] px-2 py-1 text-xs text-neutral-300 ring-1 ring-white/[0.08] ring-inset">
      {children}
    </span>
  )
}

const claimText = 'text-sm leading-6 text-neutral-200'
const detailText = 'mt-1 text-sm leading-6 text-neutral-400'

/** A section's content as readable rows, each claim followed by its citations. */
function SectionBody({
  content,
  index,
  section,
}: {
  content: ReleaseSpecContent
  index: SourceIndex
  section: EditableSection
}) {
  const cite = (refs: string[]) =>
    refs.length > 0 ? <Citations index={index} refs={refs} /> : null
  const empty = (
    <Item>
      <p className="text-sm text-neutral-500">Nothing here yet.</p>
    </Item>
  )
  switch (section) {
    case 'summary':
      return (
        <Item>
          <p className={claimText}>
            {content.summary.text}
            {cite(content.summary.sources)}
          </p>
        </Item>
      )
    case 'problem':
    case 'whatChanged':
    case 'proofPoints':
    case 'limitations':
      if (content[section].length === 0) return empty
      return content[section].map((claim, position) => (
        <Item key={position}>
          <p className={claimText}>
            {claim.text}
            {cite(claim.sources)}
          </p>
        </Item>
      ))
    case 'audience':
      if (content.audience.length === 0) return empty
      return content.audience.map((item, position) => (
        <Item key={position}>
          <h3 className="text-sm font-medium text-white">{item.segment}</h3>
          <p className={detailText}>
            {item.need}
            {cite(item.sources)}
          </p>
        </Item>
      ))
    case 'capabilities':
      if (content.capabilities.length === 0) return empty
      return content.capabilities.map((item, position) => (
        <Item key={position}>
          <h3 className="text-sm font-medium text-white">{item.name}</h3>
          <p className={detailText}>
            {item.description}
            {cite(item.sources)}
          </p>
        </Item>
      ))
    case 'beforeAfter':
      if (content.beforeAfter.length === 0) return empty
      return content.beforeAfter.map((item, position) => (
        <Item key={position}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4">
            <div>
              <p className="text-xs text-neutral-600">Before</p>
              <p className={detailText}>{item.before}</p>
            </div>
            <ArrowRight
              aria-hidden
              className="hidden text-neutral-600 sm:mt-7 sm:block"
              size={16}
            />
            <div>
              <p className="text-xs text-neutral-600">After</p>
              <p className="mt-1 text-sm leading-6 text-neutral-200">
                {item.after}
                {cite(item.sources)}
              </p>
            </div>
          </div>
        </Item>
      ))
    case 'faqs':
      if (content.faqs.length === 0) return empty
      return content.faqs.map((item, position) => (
        <Item key={position}>
          <h3 className="text-sm font-medium text-white">{item.question}</h3>
          <p className={detailText}>
            {item.answer}
            {cite(item.sources)}
          </p>
        </Item>
      ))
    case 'messaging': {
      const { ctas, pillars, positioning } = content.messaging
      return (
        <>
          {pillars.map((pillar, position) => (
            <Item key={position}>
              <p className="text-xs text-neutral-500">Pillar {position + 1}</p>
              <h3 className="mt-1 text-sm font-medium text-white">{pillar.title}</h3>
              <p className={detailText}>
                {pillar.message}
                {cite(pillar.sources)}
              </p>
            </Item>
          ))}
          <Item>
            <p className="text-xs text-neutral-500">Positioning</p>
            {positioning.statement ? (
              <p className="mt-1 text-sm leading-6 text-neutral-200">
                {positioning.statement}
                {cite(positioning.sources)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">No positioning statement yet.</p>
            )}
            {positioning.alternatives.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-neutral-500">Instead of</span>
                {positioning.alternatives.map((alternative) => (
                  <Tag key={alternative}>{alternative}</Tag>
                ))}
              </div>
            ) : null}
          </Item>
          <Item>
            <p className="text-xs text-neutral-500">Calls to action</p>
            {ctas.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {ctas.map((cta) => (
                  <li key={cta}>
                    <Tag>{cta}</Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">None yet.</p>
            )}
          </Item>
        </>
      )
    }
  }
}

const CLAIMS_HELP = 'One claim per line. End each with its sources, such as [S1, brief].'
const HELP: Record<TextSection, string> = {
  audience: 'One segment per line: segment — need [S1].',
  beforeAfter: 'One pair per line: before → after [S1].',
  capabilities: 'One per line: name — description [S1].',
  faqs: 'Q: the question, then A: the answer [S1] on the next line. Leave a blank line between FAQs.',
  limitations: CLAIMS_HELP,
  problem: CLAIMS_HELP,
  proofPoints: CLAIMS_HELP,
  summary: 'One paragraph that ends with its sources, such as [S1, brief].',
  whatChanged: CLAIMS_HELP,
}

type Field = { help: string; key: string; label: string; value: string }

/** The section in the plain-text editing format (lib/launch/spec-text.ts). */
function editorFields(section: EditableSection, content: ReleaseSpecContent): Field[] {
  if (section !== 'messaging') {
    return [
      {
        help: HELP[section],
        key: 'text',
        label: SPEC_SECTION_LABELS[section],
        value: formatSection(content, section),
      },
    ]
  }
  return [
    {
      help: 'One per line: pillar — message [S1].',
      key: 'pillars',
      label: 'Pillars',
      value: formatPillars(content),
    },
    {
      help: 'One statement that ends with its sources [S1, brief]. Leave it empty for none.',
      key: 'positioning',
      label: 'Positioning statement',
      value: formatPositioning(content),
    },
    {
      help: 'What people use instead, one per line.',
      key: 'alternatives',
      label: 'Alternatives',
      value: content.messaging.positioning.alternatives.join('\n'),
    },
    {
      help: 'One per line.',
      key: 'ctas',
      label: 'Calls to action',
      value: content.messaging.ctas.join('\n'),
    },
  ]
}

function parseFields(
  section: EditableSection,
  values: Record<string, string>
): { errors: string[] } | { value: unknown } {
  if (section !== 'messaging') {
    const result = parseSection(section, values.text ?? '')
    return result.ok ? { value: result.value } : { errors: result.errors }
  }
  const pillars = parsePillars(values.pillars ?? '')
  const positioning = parsePositioning(values.positioning ?? '')
  const alternatives = parsePlainList(values.alternatives ?? '', 6, 120)
  const ctas = parsePlainList(values.ctas ?? '', 5, 120)
  if (!pillars.ok || !positioning.ok || !alternatives.ok || !ctas.ok) {
    const prefixed = (label: string, result: { errors: string[] } | { ok: true }) =>
      'errors' in result ? result.errors.map((error) => `${label}: ${error}`) : []
    return {
      errors: [
        ...prefixed('Pillars', pillars),
        ...prefixed('Positioning', positioning),
        ...prefixed('Alternatives', alternatives),
        ...prefixed('Calls to action', ctas),
      ],
    }
  }
  const checked = specSectionSchemas.messaging.safeParse({
    ctas: ctas.value,
    pillars: pillars.value,
    positioning: { ...positioning.value, alternatives: alternatives.value },
  })
  return checked.success
    ? { value: checked.data }
    : { errors: checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
}

function SectionEditor({
  content,
  onCancel,
  onSave,
  section,
}: {
  content: ReleaseSpecContent
  onCancel: () => void
  onSave: (value: unknown) => Promise<void>
  section: EditableSection
}) {
  const id = useId()
  const fields = editorFields(section, content)
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value]))
  )
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseFields(section, values)
    if ('errors' in parsed) {
      setErrors(parsed.errors)
      return
    }
    setErrors([])
    setSaving(true)
    try {
      // On success the page refreshes and closes the editor.
      await onSave(parsed.value)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'The section could not be saved.'])
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5 rounded-2xl bg-white/[0.015] p-5 ring-1 ring-white/[0.08]"
      onSubmit={submit}
    >
      {fields.map((field) => (
        <div className="flex flex-col gap-1.5" key={field.key}>
          <label className="text-sm font-medium text-white" htmlFor={`${id}-${field.key}`}>
            {field.label}
          </label>
          <p className="text-xs text-neutral-500" id={`${id}-${field.key}-help`}>
            {field.help}
          </p>
          <textarea
            aria-describedby={`${id}-${field.key}-help${errors.length > 0 ? ` ${id}-errors` : ''}`}
            aria-invalid={errors.length > 0 || undefined}
            className="mt-1 min-h-24 w-full rounded-lg bg-white/[0.03] px-3 py-2 font-mono text-[13px] leading-6 text-neutral-100 ring-1 ring-white/[0.08] outline-none [field-sizing:content] focus:ring-white/25 aria-invalid:ring-red-500/40"
            id={`${id}-${field.key}`}
            onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            value={values[field.key] ?? ''}
          />
        </div>
      ))}
      {errors.length > 0 ? (
        <div
          className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300"
          id={`${id}-errors`}
          role="alert"
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button className="rounded-lg" onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button className="rounded-lg" disabled={saving} size="sm" type="submit">
          {saving ? 'Saving…' : 'Save section'}
        </Button>
      </div>
    </form>
  )
}

/**
 * One spec section: readable with citations, editable as plain text on the
 * latest version, and revisable with AI.
 */
export function SpecSection({
  aiConfigured,
  campaignId,
  content,
  editable,
  editing,
  index,
  locked,
  onCancel,
  onEdit,
  onSave,
  section,
  specId,
}: {
  aiConfigured: boolean
  campaignId: string
  content: ReleaseSpecContent
  /** The latest version, and the viewer may edit. */
  editable: boolean
  editing: boolean
  index: SourceIndex
  /** Another section is being edited. */
  locked: boolean
  onCancel: () => void
  onEdit: () => void
  onSave: (value: unknown) => Promise<void>
  section: EditableSection
  specId: string
}) {
  const label = SPEC_SECTION_LABELS[section]
  return (
    <Section
      actions={
        editable && !editing ? (
          <Button
            aria-label={`Edit ${label}`}
            className="h-8 gap-1.5 rounded-lg text-xs"
            disabled={locked}
            onClick={onEdit}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PencilEdit02Icon aria-hidden size={14} />
            Edit
          </Button>
        ) : null
      }
      id={`spec-${section}`}
      title={label}
    >
      {editing ? (
        <SectionEditor content={content} onCancel={onCancel} onSave={onSave} section={section} />
      ) : (
        <Group>
          <SectionBody content={content} index={index} section={section} />
        </Group>
      )}
      {editable && !editing ? (
        <div className="-mt-1">
          <RevisePanel
            campaignId={campaignId}
            disabled={!aiConfigured}
            target={{ section, specId, type: 'spec_section' }}
          />
        </div>
      ) : null}
    </Section>
  )
}
