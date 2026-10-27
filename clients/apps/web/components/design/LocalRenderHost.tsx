'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { captureStage } from '@/lib/render/capture'
import type { RenderRequest, RenderResponse } from '@/lib/render/protocol'
import { StageRenderer } from './StageRenderer'
import { assertStageReady } from '@/lib/render/stage-checks'

type RenderJob = Extract<RenderRequest, { type: 'render' }>

function post(message: RenderResponse) {
  window.parent.postMessage(message, window.location.origin)
}

/**
 * The editor's stage in a frame of its own, rendering documents the editor
 * sends one at a time. Its stores are separate from the editor's, so
 * previews and batch renders never touch the design being edited.
 */
export function LocalRenderHost({ print = false }: { print?: boolean } = {}) {
  const queue = useRef<RenderJob[]>([])
  const current = useRef<RenderJob | null>(null)
  const [job, setJob] = useState<RenderJob | null>(null)
  const [flattened, setFlattened] = useState<string | null>(null)

  // Queue work happens outside state updaters: React may run an updater
  // twice, which would take two jobs off the queue and drop one.
  const pump = useCallback(() => {
    if (current.current) return
    current.current = queue.current.shift() ?? null
    setJob(current.current)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent<RenderRequest>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const message = event.data
      if (message.type === 'cancel') {
        queue.current = queue.current.filter((queued) => queued.id !== message.id)
        return
      }
      if (message.type !== 'render') return
      queue.current.push(message)
      pump()
    }
    window.addEventListener('message', onMessage)
    post({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [pump])

  const handleReady = useCallback(async () => {
    if (!job) return
    try {
      if (job.output.strict) await assertStageReady()
      // A print frame keeps one document on screen for the page it fills.
      if (print && job.hold) {
        if (job.raster) {
          const capture = await captureStage({ ...job.output, format: 'png', scale: 2 })
          setFlattened(URL.createObjectURL(capture.blob))
          setJob(null)
        }
        post({ type: 'drawn', id: job.id })
        return
      }
      const capture = await captureStage(job.output)
      post({ type: 'result', id: job.id, ...capture })
    } catch (error) {
      post({ type: 'error', id: job.id, message: error instanceof Error ? error.message : 'Render failed.' })
    }
    current.current = null
    pump()
  }, [job, pump, print])

  if (print)
    return (
      <main
        data-canvas-viewport
        data-print-frame
        className="flex h-screen w-screen items-center justify-center overflow-hidden"
      >
        {/* The whole frame is printed: nothing but the stage may draw (consent banner, toasts). */}
        <style>{`body *:not(:has([data-print-frame])):not([data-print-frame]):not([data-print-frame] *) { display: none !important; }`}</style>
        {flattened ? (
          <img alt="" src={flattened} className="h-screen w-screen" />
        ) : job ? (
          <StageRenderer key={job.id} document={job.document} onReady={handleReady} time={job.time} />
        ) : null}
      </main>
    )

  return (
    <main data-canvas-viewport className="ph-no-capture mx-auto flex h-[1048px] max-h-screen max-w-[1072px] items-center justify-center overflow-hidden bg-transparent p-6">
      {job ? (
        <StageRenderer key={job.id} document={job.document} onReady={handleReady} time={job.time} />
      ) : null}
    </main>
  )
}
