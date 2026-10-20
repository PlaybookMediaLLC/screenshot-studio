'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePrivateCreativeSurface } from '@/components/creative-sets/use-private-surface'
import { useTRPCClient } from '@/lib/trpc/react'
import {
  CanvasSession,
  readCanvasRecoveries,
  removeCanvasRecovery,
  type CanvasRecovery,
} from '@/lib/canvas/session'
import { useCanvasUi } from '@/lib/canvas/ui-store'
import { CanvasWorkspace } from './CanvasWorkspace'

/**
 * Open a stored canvas. A draft this device kept after an interrupted save
 * is offered before editing starts; choosing it never overwrites newer
 * saved work silently.
 */
export function CanvasEditor({
  canvasId,
  workspaceId,
  canEdit,
  canHandOff,
}: {
  canvasId: string
  workspaceId: string
  canEdit: boolean
  canHandOff: boolean
}) {
  usePrivateCreativeSurface()
  const client = useTRPCClient()
  const [session, setSession] = useState<CanvasSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<CanvasRecovery | null>(null)
  useEffect(() => {
    let active = true
    let instance: CanvasSession | null = null
    useCanvasUi.getState().reset()
    void (async () => {
      const record = await client.canvas.get.query({ canvasId })
      if (!active) return
      instance = new CanvasSession(record, client)
      setSession(instance)
      if (!canEdit) return
      try {
        const drafts = await readCanvasRecoveries(workspaceId, canvasId)
        const draft = drafts.find(
          (item) => JSON.stringify(item.document) !== JSON.stringify(record.document)
        )
        if (active && draft) setRecovery(draft)
      } catch {
        if (active)
          setError('Local recovery is unavailable on this device. Cloud saving still works.')
      }
    })().catch((failure: unknown) => {
      if (active)
        setError(
          failure instanceof Error
            ? failure.message
            : 'This canvas could not be opened. Update the app if a newer version saved it.'
        )
    })
    return () => {
      active = false
      instance?.dispose()
    }
  }, [client, canvasId, workspaceId, canEdit])

  if (error && !session)
    return (
      <main className="grid min-h-[60vh] place-items-center p-8">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">This canvas could not be opened</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
          <Button variant="outline" asChild>
            <Link href="/canvas">Back to Canvas</Link>
          </Button>
        </div>
      </main>
    )
  if (!session)
    return (
      <main className="grid h-[var(--editor-height,100dvh)] place-items-center" aria-busy>
        <p className="text-sm text-muted-foreground">Opening canvas…</p>
      </main>
    )
  return (
    <>
      <CanvasWorkspace session={session} canEdit={canEdit} canHandOff={canHandOff} notice={error} />
      {recovery ? (
        <Dialog open>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Recover unsaved work</DialogTitle>
            <DialogDescription>
              This device kept a draft from {new Date(recovery.updatedAt).toLocaleString()} that was
              not saved. It is based on revision {recovery.revision}; the saved canvas is at
              revision {session.snapshot().revision}.
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void removeCanvasRecovery(recovery.key).catch(() => undefined)
                  setRecovery(null)
                }}
              >
                Use saved version
              </Button>
              <Button
                onClick={() => {
                  session.recover(recovery)
                  setRecovery(null)
                }}
              >
                Recover draft
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
