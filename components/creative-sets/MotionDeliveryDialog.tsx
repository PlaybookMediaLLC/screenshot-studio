'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { renderStoryMotion } from '@/lib/creative-sets/motion-delivery'
import { DeliveredMotion } from './DeliveredMotion'
import type { CreativeSetSession } from '@/lib/creative-sets/session'

export function MotionDeliveryDialog({
  session,
  outputId,
  onClose,
}: {
  session: CreativeSetSession
  outputId: string
  onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4')
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<
    (Awaited<ReturnType<typeof renderStoryMotion>> & { url: string; asset?: string }) | null
  >(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  async function render() {
    setError(null)
    setProgress(0)
    setResult(null)
    const controller = new AbortController()
    abort.current = controller
    try {
      if (!(await session.save())) throw new Error('Save this set before rendering.')
      const state = session.snapshot(),
        output = state.document.outputs.find((output) => output.id === outputId)!
      await session.client.creativeSet.createVersion.mutate({
        creativeSetId: session.record.id,
        name: `Delivery revision ${state.revision}`,
        baseRevision: state.revision,
      })
      const rendered = await renderStoryMotion(
        session.client,
        state.document,
        output,
        state.revision,
        format,
        controller.signal,
        setProgress
      )
      controller.signal.throwIfAborted()
      setResult({ ...rendered, url: URL.createObjectURL(rendered.blob) })
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Motion export failed.')
    } finally {
      setProgress(null)
      abort.current = null
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) {
          abort.current?.abort()
          onClose()
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogTitle>Deliver motion</DialogTitle>
        <DialogDescription>
          Render the native timeline at 24 fps and this format’s exact dimensions. The video keeps a
          revision manifest.
        </DialogDescription>
        <label className="grid gap-1 text-sm">
          Video format
          <select
            disabled={progress !== null}
            className="rounded border bg-background p-2"
            value={format}
            onChange={(event) => setFormat(event.target.value as 'mp4' | 'webm')}
          >
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
          </select>
        </label>
        {progress !== null ? (
          <>
            <progress value={progress} max={1} aria-label="Motion rendering progress" />
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              Cancel render
            </Button>
          </>
        ) : (
          <Button disabled={saving} onClick={() => void render()}>
            Render video
          </Button>
        )}
        {result ? (
          <DeliveredMotion
            key={result.manifest.id}
            session={session}
            result={result}
            onBusyChange={setSaving}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
