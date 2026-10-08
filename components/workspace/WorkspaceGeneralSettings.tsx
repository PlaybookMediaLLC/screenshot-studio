'use client'

import { type FormEvent, useState } from 'react'
import { Group, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'
import { WorkspaceDeletionSettings } from './WorkspaceDeletionSettings'

type WorkspaceGeneralSettingsProps = {
  canManage: boolean
  canDelete: boolean
  organization: {
    id: string
    logo: string | null
    name: string
    slug: string
    workspaceSettings?: {
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
}: WorkspaceGeneralSettingsProps) {
  const trpcClient = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const data = Object.fromEntries(new FormData(event.currentTarget))
    setIsSaving(true)
    try {
      await trpcClient.workspace.update.mutate({
        defaultPublishTime: String(data.defaultPublishTime ?? ''),
        description: String(data.description ?? '').trim() || null,
        locale: String(data.locale ?? ''),
        logo: String(data.logo ?? '').trim() || null,
        name: String(data.name ?? ''),
        slug: String(data.slug ?? ''),
        timeZone: String(data.timeZone ?? ''),
      })
      setMessage('Workspace details updated.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  const field = 'h-10 rounded-lg md:w-72'
  const label = (htmlFor: string, text: string) => <label htmlFor={htmlFor}>{text}</label>

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
              defaultValue={organization.name}
              disabled={!canManage}
              id="workspace-name"
              name="name"
              required
            />
          </Row>
          <Row
            description="Lowercase letters, numbers, and hyphens only."
            label={label('workspace-slug', 'Workspace slug')}
          >
            <Input
              className={field}
              defaultValue={organization.slug}
              disabled={!canManage}
              id="workspace-slug"
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
          </Row>
          <Row description="A square image works best." label={label('workspace-logo', 'Logo URL')}>
            <Input
              className={field}
              defaultValue={organization.logo ?? ''}
              disabled={!canManage}
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
            <textarea
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm dark:bg-input/30"
              defaultValue={organization.workspaceSettings?.description ?? ''}
              disabled={!canManage}
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
            <Row description="For dates and copy." label={label('workspace-locale', 'Locale')}>
              <Input
                className={field}
                defaultValue={organization.workspaceSettings?.locale ?? 'en'}
                disabled={!canManage}
                id="workspace-locale"
                name="locale"
                required
              />
            </Row>
            <Row
              description="An IANA name, like America/New_York."
              label={label('workspace-timezone', 'Timezone')}
            >
              <Input
                className={field}
                defaultValue={organization.workspaceSettings?.timeZone ?? 'UTC'}
                disabled={!canManage}
                id="workspace-timezone"
                name="timeZone"
                placeholder="America/New_York"
                required
              />
            </Row>
            <Row
              description="When scheduled posts go out by default."
              label={label('workspace-default-publish-time', 'Default publishing time')}
            >
              <Input
                className={field}
                defaultValue={organization.workspaceSettings?.defaultPublishTime ?? '09:00'}
                disabled={!canManage}
                id="workspace-default-publish-time"
                name="defaultPublishTime"
                required
                type="time"
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
          <div className="flex justify-end">
            <Button className="rounded-lg" disabled={isSaving} type="submit">
              {isSaving ? 'Saving…' : 'Save workspace'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Ask a workspace admin to change these details.</p>
        )}
      </form>
      <WorkspaceDeletionSettings canDelete={canDelete} workspaceName={organization.name} />
    </div>
  )
}
