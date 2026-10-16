'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { captureStage } from '@/lib/render/capture'
import type { RenderRequest, RenderResponse } from '@/lib/render/protocol'
import { StageRenderer } from './StageRenderer'

type RenderJob = Extract<RenderRequest, { type: 'render' }>

function post(message: RenderResponse) {
  window.parent.postMessage(message, window.location.origin)
}

/**
 * The editor's stage in a frame of its own, rendering documents the editor
 * sends one at a time. Its stores are separate from the editor's, so
 * previews and batch renders never touch the design being edited.
 */
export function LocalRenderHost() {
  const queue = useRef<RenderJob[]>([])
  const [job, setJob] = useState<RenderJob | null>(null)

  const next = useCallback(() => setJob(queue.current.shift() ?? null), [])

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
      setJob((current) => current ?? queue.current.shift() ?? null)
    }
    window.addEventListener('message', onMessage)
    post({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const handleReady = useCallback(async () => {
    if (!job) return
    try {
      const capture = await captureStage(job.output)
      post({ type: 'result', id: job.id, ...capture })
    } catch (error) {
      post({ type: 'error', id: job.id, message: error instanceof Error ? error.message : 'Render failed.' })
    }
    next()
  }, [job, next])

  return (
    <main className="flex min-h-screen items-center justify-center bg-transparent p-6">
      {job ? (
        <StageRenderer key={job.id} document={job.document} onReady={handleReady} time={job.time} />
      ) : null}
    </main>
  )
}
