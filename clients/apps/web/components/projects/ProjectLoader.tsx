'use client'

import * as React from 'react'
import { registerNavigationGuard } from '@/lib/platform/navigation-guard'
import { TRPCClientError } from '@trpc/client'
import { toast } from 'sonner'
import { projectIdSchema } from '@/lib/projects/schema'
import {
  openProject,
  releaseDraft,
  saveProjectNow,
  useProjectSession,
} from '@/lib/projects/session'
import { useTRPCClient } from '@/lib/trpc/react'

/**
 * Opens the project named by `?project=<id>` when the editor mounts, or
 * reopens the project that was open when the editor comes back into view,
 * so the canvas and the project never drift apart. Leaving the editor saves
 * what is pending.
 */
export function ProjectLoader() {
  const trpcClient = useTRPCClient()
  const startedRef = React.useRef(false)
  const { status, error } = useProjectSession()

  React.useEffect(() => {
    if (status === 'error' || status === 'offline' || status === 'conflict') {
      toast.error('Your project has not been saved', {
        id: 'project-save-error',
        description: error ?? 'Open the project menu to resolve the problem.',
        duration: Infinity,
        action:
          status === 'conflict'
            ? undefined
            : {
                label: 'Retry',
                onClick: () => void saveProjectNow(),
              },
      })
    } else if (status === 'saved') {
      toast.dismiss('project-save-error')
    }
  }, [status, error])

  React.useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const requested =
      new URLSearchParams(window.location.search).get('project') ??
      useProjectSession.getState().projectId
    if (!requested) {
      releaseDraft()
      return
    }
    const parsed = projectIdSchema.safeParse(requested)
    if (!parsed.success) {
      toast.error('Could not open the project', { description: 'The project link is not valid.' })
      return
    }
    openProject(trpcClient, parsed.data)
      .then((outcome) => {
        if (outcome === 'recovered') {
          toast.success('Recovered your unsaved changes', {
            description: 'They are being saved to the project now.',
          })
        }
      })
      .catch((error: unknown) => {
        const missing = error instanceof TRPCClientError && error.data?.code === 'NOT_FOUND'
        toast.error('Could not open the project', {
          description: missing
            ? 'It may have been deleted, or you may not have access to it.'
            : 'Check your connection, then reload the page to try again.',
        })
      })
  }, [trpcClient])

  React.useEffect(
    () =>
      registerNavigationGuard(async () => {
        if (!useProjectSession.getState().projectId) return
        await saveProjectNow()
        if (useProjectSession.getState().status !== 'saved')
          throw new Error('Save the screenshot project before leaving.')
      }, true),
    []
  )
  React.useEffect(() => () => void saveProjectNow(), [])

  return null
}
