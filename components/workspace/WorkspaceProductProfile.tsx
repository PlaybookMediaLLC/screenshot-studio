'use client'

import { Lock } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Group, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { StoredProductProfile } from '@/lib/tenant/product-profile'
import {
  type ProductProfileFieldName,
  productProfileFieldSchema,
  type ProductProfileUpsertInput,
  productProfileUpsertSchema,
} from '@/lib/tenant/product-profile-schema'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

type FormValues = Record<ProductProfileFieldName, string>

type FieldSpec = {
  description?: string
  field: ProductProfileFieldName
  kind: 'input' | 'textarea'
  label: string
  maxLength: number
  placeholder?: string
  required?: boolean
}

const FIELDS: FieldSpec[] = [
  { field: 'name', kind: 'input', label: 'Product name', maxLength: 160, required: true },
  {
    field: 'url',
    kind: 'input',
    label: 'Product URL',
    maxLength: 2_000,
    placeholder: 'https://acme.com',
    required: true,
  },
  { field: 'summary', kind: 'textarea', label: 'What it is', maxLength: 2_000 },
  { field: 'problem', kind: 'textarea', label: 'The problem it solves', maxLength: 2_000 },
  { field: 'audience', kind: 'textarea', label: 'Who it is for', maxLength: 1_000 },
  {
    description: 'One per line.',
    field: 'capabilities',
    kind: 'textarea',
    label: 'Capabilities',
    maxLength: 9_000,
  },
  {
    description: 'Numbers, customers, or quotes you can stand behind. One per line.',
    field: 'proofPoints',
    kind: 'textarea',
    label: 'Proof points',
    maxLength: 15_000,
  },
  { field: 'pricingNote', kind: 'input', label: 'Pricing', maxLength: 500 },
  {
    description: 'Comma-separated.',
    field: 'competitors',
    kind: 'input',
    label: 'Alternatives',
    maxLength: 2_000,
  },
]

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
const commas = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

function toForm(profile: StoredProductProfile | null, url = ''): FormValues {
  return {
    audience: profile?.audience ?? '',
    capabilities: profile?.capabilities.join('\n') ?? '',
    competitors: profile?.competitors.join(', ') ?? '',
    name: profile?.name ?? '',
    pricingNote: profile?.pricingNote ?? '',
    problem: profile?.problem ?? '',
    proofPoints: profile?.proofPoints.map((point) => point.claim).join('\n') ?? '',
    summary: profile?.summary ?? '',
    url: profile?.url ?? url,
  }
}

/**
 * The fields the form changed, and only those: the backend locks every field
 * a person sends, so an untouched field must stay out of the change. Proof
 * points keep the page they came from while their text is unchanged.
 */
function changedFields(
  values: FormValues,
  profile: StoredProductProfile | null
): ProductProfileUpsertInput {
  const next = {
    audience: values.audience.trim(),
    capabilities: lines(values.capabilities),
    competitors: commas(values.competitors),
    name: values.name.trim(),
    pricingNote: values.pricingNote.trim(),
    problem: values.problem.trim(),
    proofPoints: lines(values.proofPoints).map((claim) => ({
      claim,
      sourceUrl: profile?.proofPoints.find((point) => point.claim === claim)?.sourceUrl,
    })),
    summary: values.summary.trim(),
    url: values.url.trim(),
  }
  // Compared as the form shows them, so extra whitespace is not a change.
  const before = toForm(profile)
  const after = profile ? toForm({ ...profile, ...next }) : null
  const changes: Record<string, unknown> = {}
  for (const field of productProfileFieldSchema.options) {
    const empty = Array.isArray(next[field]) ? next[field].length === 0 : !next[field]
    if (after ? after[field] !== before[field] : !empty) changes[field] = next[field]
  }
  return changes as ProductProfileUpsertInput
}

/** Where a profile field's value came from, with an unlock action on a locked field. */
export function Provenance({
  canManage,
  entry,
  onUnlock,
}: {
  canManage: boolean
  entry: StoredProductProfile['provenance'][ProductProfileFieldName]
  onUnlock: () => void
}): ReactNode {
  if (!entry) return null
  if (entry.editedByUser) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Lock aria-hidden className="size-3" />
        Edited by you
        {canManage ? (
          <button
            className="text-neutral-300 underline underline-offset-2 hover:text-white"
            onClick={onUnlock}
            type="button"
          >
            Let Shots update this
          </button>
        ) : null}
      </span>
    )
  }
  if (!entry.url) return 'From your site'
  return (
    <span>
      From your site:{' '}
      <a
        className="text-neutral-300 underline underline-offset-2 hover:text-white"
        href={entry.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {entry.url.replace(/^https?:\/\//, '')}
      </a>
    </span>
  )
}

/**
 * The product profile form, shared by settings and onboarding. Each field
 * says where its value came from; saving locks the fields a person changed,
 * and "Let Shots update this" unlocks one so a later read of the site can
 * change it again. Without a saved profile it creates one.
 */
export function ProductProfileForm({
  busy = false,
  canManage,
  initialUrl,
  onSaved,
  profile: initialProfile,
  submitLabel,
}: {
  /** Disables the form while the caller works with the saved profile. */
  busy?: boolean
  canManage: boolean
  /** The URL to start a new profile with. */
  initialUrl?: string
  onSaved: (profile: StoredProductProfile) => void | Promise<void>
  profile: StoredProductProfile | null
  submitLabel: string
}) {
  const trpcClient = useTRPCClient()
  const [profile, setProfile] = useState(initialProfile)
  const [values, setValues] = useState(() => toForm(initialProfile, initialUrl))
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function save(input: ProductProfileUpsertInput): Promise<StoredProductProfile | null> {
    const parsed = productProfileUpsertSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const label = FIELDS.find((spec) => spec.field === issue?.path[0])?.label ?? 'the form'
      setError(`Check ${label}: ${issue?.message ?? 'it is not valid'}.`)
      return null
    }
    const result = await trpcClient.productProfile.upsert.mutate(parsed.data)
    setProfile(result.productProfile)
    return result.productProfile
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const changes = changedFields(values, profile)
      const saved = Object.keys(changes).length > 0 || !profile ? await save(changes) : profile
      if (saved) await onSaved(saved)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function unlock(field: ProductProfileFieldName): Promise<void> {
    setError(null)
    try {
      await save({ unlockFields: [field] })
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <fieldset className="flex min-w-0 flex-col gap-4" disabled={!canManage || busy || isSaving}>
        <Group>
          {FIELDS.map((spec) => {
            const id = `product-${spec.field}`
            const props = {
              id,
              maxLength: spec.maxLength,
              name: spec.field,
              onChange: (event: { target: { value: string } }) =>
                setValues((current) => ({ ...current, [spec.field]: event.target.value })),
              placeholder: spec.placeholder,
              required: spec.required,
              value: values[spec.field],
            }
            const provenance = (
              <Provenance
                canManage={canManage}
                entry={profile?.provenance[spec.field]}
                onUnlock={() => void unlock(spec.field)}
              />
            )
            return (
              <Row
                description={
                  spec.description || provenance ? (
                    <span className="flex flex-col gap-0.5">
                      {spec.description ? <span>{spec.description}</span> : null}
                      {provenance}
                    </span>
                  ) : undefined
                }
                key={spec.field}
                label={<label htmlFor={id}>{spec.label}</label>}
                layout="stacked"
              >
                {spec.kind === 'input' ? (
                  <Input
                    className="h-10 rounded-lg"
                    type={spec.field === 'url' ? 'url' : 'text'}
                    {...props}
                  />
                ) : (
                  <Textarea className="min-h-20 rounded-lg" {...props} />
                )}
              </Row>
            )
          })}
        </Group>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {canManage ? (
          <div className="flex justify-end">
            <Button className="rounded-lg" type="submit">
              {isSaving ? 'Saving…' : submitLabel}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  )
}

/** The Product settings section: what Shots knows about the product it markets. */
export function WorkspaceProductProfile({ canManage }: { canManage: boolean }) {
  const trpcClient = useTRPCClient()
  // undefined until loaded; null when the workspace has no product profile yet.
  const [profile, setProfile] = useState<StoredProductProfile | null>()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    trpcClient.productProfile.get
      .query()
      .then((result) => setProfile(result.productProfile))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [trpcClient])

  return (
    <Section
      description="The AI plans and writes every campaign from this. Fields you edit stay as you wrote them."
      title="Product profile"
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {profile === undefined ? (
        error ? null : (
          <p className="text-sm text-neutral-500">Loading…</p>
        )
      ) : (
        <ProductProfileForm
          canManage={canManage}
          onSaved={() => setMessage('Product profile saved.')}
          profile={profile}
          submitLabel="Save product profile"
        />
      )}
      {message ? (
        <p className="text-sm text-neutral-400" role="status">
          {message}
        </p>
      ) : null}
    </Section>
  )
}
