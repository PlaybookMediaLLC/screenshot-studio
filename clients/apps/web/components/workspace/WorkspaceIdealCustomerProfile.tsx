'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { useUnsavedSettings } from '@/components/settings/useUnsavedSettings'
import { Group, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { StoredIdealCustomerProfile } from '@/lib/tenant/ideal-customer-profile'
import {
  type IdealCustomerProfileFieldName,
  idealCustomerProfileFieldSchema,
  type IdealCustomerProfileUpsertInput,
  idealCustomerProfileUpsertSchema,
} from '@/lib/tenant/ideal-customer-profile-schema'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'
import { Provenance } from './WorkspaceProductProfile'
import { Label } from '@/components/ui/label'

type FormValues = Record<IdealCustomerProfileFieldName, string>

const FIELDS: Array<{ description: string; field: IdealCustomerProfileFieldName; label: string }> =
  [
    {
      description: 'One per line: role, seniority, team size. Only the role is required.',
      field: 'personas',
      label: 'Who buys it',
    },
    { description: 'One per line, in the customer’s words.', field: 'pains', label: 'Pains' },
    { description: 'One per line.', field: 'jobs', label: 'Jobs they hire it for' },
    { description: 'One per line.', field: 'buyingTriggers', label: 'What makes them look' },
    { description: 'One per line.', field: 'objections', label: 'Why they hesitate' },
    {
      description: 'Where they read and post. One per line.',
      field: 'channels',
      label: 'Channels',
    },
  ]

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

function toForm(profile: StoredIdealCustomerProfile | null): FormValues {
  return {
    buyingTriggers: profile?.buyingTriggers.join('\n') ?? '',
    channels: profile?.channels.join('\n') ?? '',
    jobs: profile?.jobs.join('\n') ?? '',
    objections: profile?.objections.join('\n') ?? '',
    pains: profile?.pains.join('\n') ?? '',
    personas:
      profile?.personas
        .map((persona) =>
          [persona.role, persona.seniority, persona.teamSize].filter(Boolean).join(', ')
        )
        .join('\n') ?? '',
  }
}

/** The fields the form changed, and only those: the backend locks every field a person sends. */
function changedFields(
  values: FormValues,
  profile: StoredIdealCustomerProfile | null
): IdealCustomerProfileUpsertInput {
  const before = toForm(profile)
  const changes: Record<string, unknown> = {}
  for (const field of idealCustomerProfileFieldSchema.options) {
    if (lines(values[field]).join('\n') === lines(before[field]).join('\n')) continue
    changes[field] =
      field === 'personas'
        ? lines(values.personas).map((line) => {
            const [role = '', seniority, teamSize] = line.split(',').map((part) => part.trim())
            return { role, seniority: seniority || undefined, teamSize: teamSize || undefined }
          })
        : lines(values[field])
  }
  return changes as IdealCustomerProfileUpsertInput
}

/**
 * The ideal customer profile form, shared by settings and onboarding. Each
 * field says where its value came from; saving locks the fields a person
 * changed, and "Let Shots update this" unlocks one again.
 */
export function IdealCustomerProfileForm({
  canManage,
  onSaved,
  profile: initialProfile,
  submitLabel,
  settings = false,
}: {
  canManage: boolean
  onSaved: (profile: StoredIdealCustomerProfile) => void | Promise<void>
  profile: StoredIdealCustomerProfile | null
  submitLabel: string
  settings?: boolean
}) {
  const trpcClient = useTRPCClient()
  const [profile, setProfile] = useState(initialProfile)
  const [values, setValues] = useState(() => toForm(initialProfile))
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedValues, setSavedValues] = useState(() => toForm(initialProfile))
  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues)
  useUnsavedSettings(settings && dirty)

  async function save(
    input: IdealCustomerProfileUpsertInput
  ): Promise<StoredIdealCustomerProfile | null> {
    const parsed = idealCustomerProfileUpsertSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const label = FIELDS.find((spec) => spec.field === issue?.path[0])?.label ?? 'the form'
      setError(`Check ${label}: ${issue?.message ?? 'it is not valid'}.`)
      return null
    }
    const result = await trpcClient.idealCustomerProfile.upsert.mutate(parsed.data)
    setProfile(result.idealCustomerProfile)
    return result.idealCustomerProfile
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const changes = changedFields(values, profile)
      const saved = Object.keys(changes).length > 0 || !profile ? await save(changes) : profile
      if (saved) {
        setSavedValues(values)
        await onSaved(saved)
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function unlock(field: IdealCustomerProfileFieldName): Promise<void> {
    setError(null)
    try {
      await save({ unlockFields: [field] })
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <fieldset className="flex min-w-0 flex-col gap-4" disabled={!canManage || isSaving}>
        <Group>
          {FIELDS.map((spec) => {
            const id = `icp-${spec.field}`
            return (
              <Row
                description={
                  <span className="flex flex-col gap-0.5">
                    <span>{spec.description}</span>
                    <Provenance
                      canManage={canManage}
                      entry={profile?.provenance[spec.field]}
                      onUnlock={() => void unlock(spec.field)}
                    />
                  </span>
                }
                key={spec.field}
                label={<Label htmlFor={id}>{spec.label}</Label>}
                layout="stacked"
              >
                <Textarea
                  className="min-h-20 rounded-lg"
                  id={id}
                  maxLength={4_000}
                  name={spec.field}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [spec.field]: event.target.value }))
                  }
                  value={values[spec.field]}
                />
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
          settings ? (
            <SettingsSaveBar
              dirty={dirty}
              busy={isSaving}
              label={submitLabel}
              onDiscard={() => {
                setValues(savedValues)
                setError(null)
              }}
            />
          ) : (
            <div className="flex justify-end">
              <Button className="rounded-lg" type="submit">
                {isSaving ? 'Saving…' : submitLabel}
              </Button>
            </div>
          )
        ) : null}
      </fieldset>
    </form>
  )
}

/** The ideal customer section of the Product settings: who the product is sold to. */
export function WorkspaceIdealCustomerProfile({ canManage }: { canManage: boolean }) {
  const trpcClient = useTRPCClient()
  // undefined until loaded; null when the workspace has no ICP yet.
  const [profile, setProfile] = useState<StoredIdealCustomerProfile | null>()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    trpcClient.idealCustomerProfile.get
      .query()
      .then((result) => setProfile(result.idealCustomerProfile))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [trpcClient])

  return (
    <Section
      description="Who you sell to. Campaigns pick their angles and channels from this. Fields you edit stay as you wrote them."
      title="Ideal customer"
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {profile === undefined ? (
        error ? null : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )
      ) : (
        <IdealCustomerProfileForm
          canManage={canManage}
          onSaved={() => setMessage('Ideal customer saved.')}
          profile={profile}
          settings
          submitLabel="Save ideal customer"
        />
      )}
      {message ? (
        <p className="text-sm text-foreground/65" role="status">
          {message}
        </p>
      ) : null}
    </Section>
  )
}
