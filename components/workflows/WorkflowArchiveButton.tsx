'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import type { AutomationDefinition } from '@/lib/api/contracts/release-automation'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from '@/components/workspace/settings-client'

/** Archive with confirmation; preserve history and allow an inactive restore. */
export function WorkflowArchiveButton({
  definition,
  onChanged,
  disabled = false,
}: {
  definition: AutomationDefinition
  onChanged: () => void
  disabled?: boolean
}) {
  const client = useTRPCClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const action = definition.archived ? 'Restore' : 'Archive'
  return (
    <>
      <Button
        size="sm"
        variant={definition.archived ? 'outline' : 'destructive'}
        disabled={disabled || busy}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        {action}
        <span className="sr-only"> {definition.name}</span>
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {action} “{definition.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {definition.archived
              ? 'Restore this workflow as inactive. Nothing runs until you activate it again.'
              : 'This removes the workflow from the current list and requests cancellation of pending runs. Run history and completed outputs are kept. Unsaved edits will be discarded. You can restore it from Archived.'}
          </AlertDialogDescription>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                setBusy(true)
                void client.releaseAutomation.archive
                  .mutate({
                    id: definition.id,
                    revision: definition.revision,
                    archived: !definition.archived,
                  })
                  .then(() => {
                    setOpen(false)
                    onChanged()
                  })
                  .catch((failure) => setError(getErrorMessage(failure)))
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Saving…' : action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
