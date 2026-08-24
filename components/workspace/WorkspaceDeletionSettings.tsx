'use client'

import { type FormEvent, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

export function WorkspaceDeletionSettings({
  canDelete,
  workspaceName,
}: {
  canDelete: boolean
  workspaceName: string
}) {
  const trpcClient = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!canDelete) return null

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const confirmation = String(new FormData(event.currentTarget).get('confirmation') ?? '')
    setError(null)
    setIsSubmitting(true)
    try {
      await trpcClient.workspace.requestDeletion.mutate({ confirmation })
      window.location.reload()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mt-10 border-t border-destructive/30 pt-6">
      <h3 className="text-sm font-semibold text-destructive">Delete workspace</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Access stops immediately. You can restore this workspace for 14 days before its data is
        purged.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Two-factor authentication and a fresh sign-in are required.
      </p>
      <form className="mt-4 grid max-w-md gap-3" onSubmit={handleSubmit}>
        <Input name="confirmation" placeholder={workspaceName} required />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button disabled={isSubmitting} type="submit" variant="destructive">
          {isSubmitting ? 'Scheduling deletion…' : 'Schedule deletion'}
        </Button>
      </form>
    </section>
  )
}

export function WorkspaceDeletionRecovery({
  canRestore,
  scheduledFor,
}: {
  canRestore: boolean
  scheduledFor: Date
}) {
  const trpcClient = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  async function restore(): Promise<void> {
    setError(null)
    setIsRestoring(true)
    try {
      await trpcClient.workspace.cancelDeletion.mutate()
      window.location.assign('/workspace')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
      setIsRestoring(false)
    }
  }

  return (
    <section className="mx-auto mt-16 max-w-xl rounded-lg border border-destructive/30 bg-card p-6">
      <h1 className="text-xl font-semibold">Workspace deletion is scheduled</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Workspace access is suspended until you restore it. Data will be purged after{' '}
        {new Date(scheduledFor).toLocaleString()}.
      </p>
      {error ? (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canRestore ? (
        <Button
          className="mt-5"
          disabled={isRestoring}
          onClick={() => void restore()}
          type="button"
        >
          {isRestoring ? 'Restoring…' : 'Restore workspace'}
        </Button>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          Only the owner who scheduled this deletion can restore the workspace.
        </p>
      )}
    </section>
  )
}
