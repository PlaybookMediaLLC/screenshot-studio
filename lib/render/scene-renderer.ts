'use client'

import type { DesignDocument } from '@/lib/design/document'
import type { StageCapture, StageOutput } from './capture'
import { RENDER_FRAME_PATH, type RenderRequest, type RenderResponse } from './protocol'

/**
 * Render any document with the editor's own stage, in a hidden same-origin
 * frame. Previews, batch export, multi-size export, and variant grids use
 * this, so each one is drawn and exported exactly like the editor would,
 * without touching the design being edited.
 *
 * Renders run one at a time in the frame. A render that does not finish in
 * time reloads the frame, so one bad document cannot stall the queue.
 */

const FRAME_SIZE = { height: 1200, width: 1600 }
const RENDER_TIMEOUT_MS = 45_000

type Pending = {
  reject: (error: Error) => void
  resolve: (capture: StageCapture) => void
  timer: ReturnType<typeof setTimeout>
}

let frame: HTMLIFrameElement | null = null
let ready: Promise<void> | null = null
let markReady: (() => void) | null = null
let listening = false
let renderQueue: Promise<void> = Promise.resolve()
const pending = new Map<string, Pending>()

function onFrameMessage(event: MessageEvent<RenderResponse>) {
  if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return
  const message = event.data
  if (message.type === 'ready') {
    markReady?.()
    return
  }
  const job = pending.get(message.id)
  if (!job) return
  pending.delete(message.id)
  clearTimeout(job.timer)
  if (message.type === 'result') {
    job.resolve({ blob: message.blob, height: message.height, width: message.width })
  } else if (message.type === 'error') {
    job.reject(new Error(message.message))
  }
}

function createFrame(): Promise<void> {
  if (!listening) {
    window.addEventListener('message', onFrameMessage)
    listening = true
  }
  const element = document.createElement('iframe')
  element.src = RENDER_FRAME_PATH
  element.title = 'Render frame'
  element.setAttribute('aria-hidden', 'true')
  element.tabIndex = -1
  Object.assign(element.style, {
    border: '0',
    height: `${FRAME_SIZE.height}px`,
    left: '-100000px',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: `${FRAME_SIZE.width}px`,
  })
  frame = element
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      resetFrame('The render frame did not start.')
      reject(new Error('The render frame did not start.'))
    }, RENDER_TIMEOUT_MS)
    markReady = () => { clearTimeout(timeout); resolve() }
    document.body.appendChild(element)
  })
}

function send(message: RenderRequest) {
  frame?.contentWindow?.postMessage(message, window.location.origin)
}

/** Drop the frame and fail its renders, so the next render starts a fresh one. */
function resetFrame(reason: string) {
  frame?.remove()
  frame = null
  ready = null
  for (const [id, job] of pending) {
    clearTimeout(job.timer)
    job.reject(new Error(reason))
    pending.delete(id)
  }
}

export type RenderDocumentOptions = {
  signal?: AbortSignal
  /** Timeline position in milliseconds. */
  time?: number
}

/** Render a document (lossless, local sources allowed) to an image. */
async function renderOne(
  document: DesignDocument,
  output: StageOutput,
  { signal, time }: RenderDocumentOptions = {}
): Promise<StageCapture> {
  signal?.throwIfAborted()
  ready ??= createFrame()
  await ready
  signal?.throwIfAborted()
  const id = crypto.randomUUID()
  return new Promise<StageCapture>((resolve, reject) => {
    const timer = setTimeout(() => resetFrame('The render took too long.'), RENDER_TIMEOUT_MS)
    const abort = () => resetFrame('The render was cancelled.')
    const cleanup = () => signal?.removeEventListener('abort', abort)
    pending.set(id, {
      timer,
      reject: (error) => { cleanup(); reject(error) },
      resolve: (capture) => { cleanup(); resolve(capture) },
    })
    signal?.addEventListener('abort', abort, { once: true })
    send({ type: 'render', document, id, output, time })
  })
}

/** Queue before starting the timeout, so slow thumbnails cannot expire later exports. */
export function renderDocument(document: DesignDocument, output: StageOutput, options: RenderDocumentOptions = {}): Promise<StageCapture> {
  const result = renderQueue.then(() => renderOne(document, output, options))
  renderQueue = result.then(() => undefined, () => undefined)
  const { signal } = options
  if (!signal) return result
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
