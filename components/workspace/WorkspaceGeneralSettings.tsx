'use client'

import { type FormEvent, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

type WorkspaceGeneralSettingsProps = {
  canManage: boolean
  organization: { id: string; name: string; slug: string }
}

export function WorkspaceGeneralSettings({
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
        name: String(data.name ?? ''),
        slug: String(data.slug ?? ''),
      })
      setMessage('Workspace details updated.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="grid max-w-xl gap-5" onSubmit={handleSubmit}>
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
  )
}
