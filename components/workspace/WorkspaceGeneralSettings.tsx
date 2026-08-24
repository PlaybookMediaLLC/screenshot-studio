'use client'

import { type FormEvent, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

  return (
    <div className="max-w-xl">
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <Label className="grid gap-1.5" htmlFor="workspace-name">
          Workspace name
          <Input
            defaultValue={organization.name}
            disabled={!canManage}
            id="workspace-name"
            name="name"
            required
          />
        </Label>
        <Label className="grid gap-1.5" htmlFor="workspace-slug">
          Workspace slug
          <Input
            defaultValue={organization.slug}
            disabled={!canManage}
            id="workspace-slug"
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <span className="text-xs font-normal text-muted-foreground">
            Lowercase letters, numbers, and hyphens only.
          </span>
        </Label>
        <Label className="grid gap-1.5" htmlFor="workspace-logo">
          Logo URL
          <Input
            defaultValue={organization.logo ?? ''}
            disabled={!canManage}
            id="workspace-logo"
            name="logo"
            placeholder="https://example.com/logo.svg"
            type="url"
          />
        </Label>
        <Label className="grid gap-1.5" htmlFor="workspace-description">
          Description
          <textarea
            className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm"
            defaultValue={organization.workspaceSettings?.description ?? ''}
            disabled={!canManage}
            id="workspace-description"
            maxLength={1000}
            name="description"
          />
        </Label>
        <div className="grid gap-5 sm:grid-cols-2">
          <Label className="grid gap-1.5" htmlFor="workspace-locale">
            Locale
            <Input
              defaultValue={organization.workspaceSettings?.locale ?? 'en'}
              disabled={!canManage}
              id="workspace-locale"
              name="locale"
              required
            />
          </Label>
          <Label className="grid gap-1.5" htmlFor="workspace-timezone">
            Timezone
            <Input
              defaultValue={organization.workspaceSettings?.timeZone ?? 'UTC'}
              disabled={!canManage}
              id="workspace-timezone"
              name="timeZone"
              placeholder="America/New_York"
              required
            />
          </Label>
        </div>
        <Label className="grid gap-1.5" htmlFor="workspace-default-publish-time">
          Default publishing time
          <Input
            defaultValue={organization.workspaceSettings?.defaultPublishTime ?? '09:00'}
            disabled={!canManage}
            id="workspace-default-publish-time"
            name="defaultPublishTime"
            required
            type="time"
          />
        </Label>
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
          <Button className="w-fit" disabled={isSaving} type="submit">
            {isSaving ? 'Saving…' : 'Save workspace'}
          </Button>
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
