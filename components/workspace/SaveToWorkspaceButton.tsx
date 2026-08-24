'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { useTRPCClient } from '@/lib/trpc/react'
import {
  buildExportFileName,
  saveExportToWorkspace,
  WorkspaceSaveError,
} from '@/lib/workspace/save-export'

/**
 * Saves the current export into the signed-in user's workspace.
 *
 * The editor works without an account, so this is additive rather than a
 * gate: signed-out users keep downloading exports as before, and the
 * control explains what signing in would add instead of blocking the
 * work already in progress.
 */

export interface SaveToWorkspaceButtonProps {
  /** Produces the bytes to save. Called only when the user asks to save,
   * because rendering an export is expensive. */
  createExport: () => Promise<Blob>
  disabled?: boolean
}

type SaveState = 'idle' | 'saving' | 'saved'

export function SaveToWorkspaceButton({ createExport, disabled }: SaveToWorkspaceButtonProps) {
  const trpcClient = useTRPCClient()
  const { data: session, isPending } = authClient.useSession()
  const [state, setState] = React.useState<SaveState>('idle')

  // Signing in is a separate flow with its own call to action. Rendering
  // a disabled control here would imply the editor needs an account,
  // which it does not.
  if (isPending || !session) {
    return null
  }

  async function handleSave(): Promise<void> {
    setState('saving')
    try {
      const blob = await createExport()
      const { assetId } = await saveExportToWorkspace({
        blob,
        fileName: buildExportFileName(blob.type),
        trpcClient,
      })

      setState('saved')
      toast.success('Saved to workspace', {
        action: {
          label: 'View assets',
          onClick: () => window.open('/assets', '_blank', 'noopener,noreferrer'),
        },
        description: 'This export is now available to your team.',
      })
      // Reset so a further edit can be saved without reloading.
      window.setTimeout(() => setState('idle'), 2_000)
      return void assetId
    } catch (error) {
      setState('idle')

      // Distinguish what the user can act on from what they cannot. An
      // unsupported format or an oversized export is fixable in the
      // editor; anything else is not, and saying so avoids implying the
      // user did something wrong.
      const description =
        error instanceof WorkspaceSaveError
          ? error.message
          : 'The export could not be saved. Your work is unchanged.'
      toast.error('Could not save to workspace', { description })
    }
  }

  return (
    <Button
      disabled={disabled || state === 'saving'}
      onClick={handleSave}
      type="button"
      variant="outline"
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save to workspace'}
    </Button>
  )
}
