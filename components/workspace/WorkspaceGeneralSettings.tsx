'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { z } from 'zod'
import { TimeZonePicker } from '@/components/settings/TimeZonePicker'
import { LocalePicker } from '@/components/settings/LocalePicker'
import { useUnsavedSettings } from '@/components/settings/useUnsavedSettings'
import { workspaceUpdateSchema } from '@/lib/workspace/schemas'
import { Group, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'
import { WorkspaceDeletionSettings } from './WorkspaceDeletionSettings'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const generalDraftSchema = z.object({
  aiAgentEnabled: z.boolean(),
  defaultPublishTime: z.string(),
  description: z.string(),
  locale: z.string(),
  logo: z.string(),
  name: z.string(),
  slug: z.string(),
  timeZone: z.string(),
})

type WorkspaceGeneralSettingsProps = {
  canManage: boolean
  userId: string
  canDelete: boolean
  organization: {
    id: string
    logo: string | null
    name: string
    slug: string
    workspaceSettings?: {
      aiAgentEnabled: boolean
      defaultPublishTime: string
      description: string | null
      locale: string
      timeZone: string
    } | null
  }
}

export function WorkspaceGeneralSettings({
  canDelete,
  canManage,
  organization,
  userId,
}: WorkspaceGeneralSettingsProps) {
  const trpcClient = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [saved, setSaved] = useState({
    aiAgentEnabled: organization.workspaceSettings?.aiAgentEnabled ?? true,
    defaultPublishTime: organization.workspaceSettings?.defaultPublishTime ?? '09:00',
    description: organization.workspaceSettings?.description ?? '',
    locale: organization.workspaceSettings?.locale ?? 'en',
    logo: organization.logo ?? '',
    name: organization.name,
    slug: organization.slug,
    timeZone: organization.workspaceSettings?.timeZone ?? 'UTC',
  })
  const [values, setValues] = useState(saved)
  const draftKey = `settings:general:${userId}:${organization.id}`
  const dirty = JSON.stringify(values) !== JSON.stringify(saved)
  const slugResult = workspaceUpdateSchema.shape.slug.safeParse(values.slug)
  const slugError = slugResult.success ? null : slugResult.error.issues[0]?.message
  useUnsavedSettings(dirty)

  useEffect(() => {
    // Keep invalid edits too; validation still runs before a save.
    try {
      const draft = sessionStorage.getItem(draftKey)
      if (draft) setValues(generalDraftSchema.parse(JSON.parse(draft)))
    } catch {
      // Storage may be unavailable; navigation warnings still protect edits.
    }
  }, [draftKey])

  function update(change: Partial<typeof values>) {
    const next = { ...values, ...change }
    setValues(next)
    setMessage(null)
    try {
      if (JSON.stringify(next) === JSON.stringify(saved)) sessionStorage.removeItem(draftKey)
      else sessionStorage.setItem(draftKey, JSON.stringify(next))
    } catch {
      // Storage may be unavailable; navigation warnings still protect edits.
    }
  }

  function clearDraft(submitted?: typeof values) {
    try {
      // A save may finish after the user leaves, returns, and makes newer edits.
      if (submitted && sessionStorage.getItem(draftKey) !== JSON.stringify(submitted)) return
      sessionStorage.removeItem(draftKey)
    } catch {
      // Saving and discarding must still work when storage is unavailable.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canManage || isSaving) return
    setError(null)
    setMessage(null)
    const input = workspaceUpdateSchema.safeParse({
      ...values,
      description: values.description.trim() || null,
      logo: values.logo.trim() || null,
    })
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the workspace details.')
      return
    }
    setIsSaving(true)
    try {
      await trpcClient.workspace.update.mutate(input.data)
      setSaved(values)
      clearDraft(values)
      setMessage('Workspace details updated.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  const field = 'h-10 rounded-lg md:w-72'
  const label = (htmlFor: string, text: string) => <Label htmlFor={htmlFor}>{text}</Label>

  return (
    <div className="flex flex-col gap-10">
      <form className="flex flex-col gap-10" onSubmit={handleSubmit}>
        <Group>
          <Row
            description="Shown across the app and in invitations."
            label={label('workspace-name', 'Workspace name')}
          >
            <Input
              className={field}
              value={values.name}
              onChange={(event) => update({ name: event.target.value })}
              disabled={!canManage || isSaving}
              id="workspace-name"
              name="name"
              required
            />
          </Row>
          <Row
            description="Lowercase letters, numbers, and hyphens only."
            label={label('workspace-slug', 'Workspace slug')}
          >
            <div className="grid gap-1">
              <Input
                className={field}
                value={values.slug}
                onChange={(event) => update({ slug: event.target.value })}
                disabled={!canManage || isSaving}
                aria-describedby={slugError ? 'workspace-slug-error' : undefined}
                aria-invalid={Boolean(slugError)}
                id="workspace-slug"
                name="slug"
                minLength={2}
                maxLength={100}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
              />
              {slugError ? (
                <p
                  className="text-sm text-red-700 dark:text-red-300"
                  id="workspace-slug-error"
                  role="alert"
                >
                  {slugError}
                </p>
              ) : null}
            </div>
          </Row>
          <Row description="A square image works best." label={label('workspace-logo', 'Logo URL')}>
            <Input
              className={field}
              value={values.logo}
              onChange={(event) => update({ logo: event.target.value })}
              disabled={!canManage || isSaving}
              id="workspace-logo"
              name="logo"
              placeholder="https://example.com/logo.svg"
              type="url"
            />
          </Row>
          <Row
            description="What this workspace is for, in a sentence or two."
            label={label('workspace-description', 'Description')}
            layout="stacked"
          >
            <Textarea
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm dark:bg-input/30"
              value={values.description}
              onChange={(event) => update({ description: event.target.value })}
              disabled={!canManage || isSaving}
              id="workspace-description"
              maxLength={1000}
              name="description"
            />
          </Row>
        </Group>

        <Section
          description="Used when content is scheduled without an explicit time."
          title="Publishing defaults"
        >
          <Group>
            <Row description="For dates and copy." label="Locale">
              <LocalePicker
                value={values.locale}
                onChange={(locale) => update({ locale })}
                disabled={!canManage || isSaving}
              />
            </Row>
            <Row
              description="Choose a city to use its local time, including daylight saving changes."
              label="Timezone"
            >
              <TimeZonePicker
                label="Timezone"
                value={values.timeZone}
                onChange={(timeZone) => update({ timeZone })}
                disabled={!canManage || isSaving}
              />
            </Row>
            <Row
              description="When scheduled posts go out by default."
              label={label('workspace-default-publish-time', 'Default publishing time')}
            >
              <Input
                className={field}
                value={values.defaultPublishTime}
                onChange={(event) => update({ defaultPublishTime: event.target.value })}
                disabled={!canManage || isSaving}
                id="workspace-default-publish-time"
                name="defaultPublishTime"
                required
                type="time"
              />
            </Row>
          </Group>
        </Section>

        <Section title="AI">
          <Group>
            <Row
              description="When off, no AI runs start in this workspace."
              label={label('workspace-ai-agent', 'Let AI draft campaigns')}
            >
              <Checkbox
                checked={values.aiAgentEnabled}
                onCheckedChange={(checked) => update({ aiAgentEnabled: checked === true })}
                disabled={!canManage || isSaving}
                id="workspace-ai-agent"
                name="aiAgentEnabled"
              />
            </Row>
          </Group>
        </Section>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {canManage ? (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-background p-3 shadow-sm">
            <p className="mr-auto text-sm" role="status">
              {dirty ? 'Unsaved changes' : 'All changes saved'}
            </p>
            <Button
              disabled={!dirty || isSaving}
              onClick={() => {
                setValues(saved)
                clearDraft()
                setError(null)
                setMessage(null)
              }}
              type="button"
              variant="outline"
            >
              Discard
            </Button>
            <Button
              className="rounded-lg"
              disabled={!dirty || isSaving || Boolean(slugError)}
              type="submit"
            >
              {isSaving ? 'Saving…' : 'Save workspace'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask a workspace admin to change these details.
          </p>
        )}
      </form>
      <WorkspaceDeletionSettings canDelete={canDelete} workspaceName={organization.name} />
    </div>
  )
}
