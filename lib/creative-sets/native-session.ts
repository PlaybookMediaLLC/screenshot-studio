'use client'

import { applyStoredDocument } from '@/lib/design/open-design'
import { documentFromState, exportDesignDocument } from '@/lib/design/export'
import { applyDesignLayout } from '@/lib/design/apply'
import { rememberUploadedSources, withUploadedSources } from '@/lib/design/upload-sources'
import { type DesignDocument } from '@/lib/design/document'
import { useImageStore } from '@/lib/store'
import { nativeEdit } from './commands'
import { materializeOutput } from './document'
import type { CreativeSetSession } from './session'

/** Keep unchanged native fields lossless when the store rounds pixel-based geometry. */
export function mergeNativeDelta(original: unknown, baseline: unknown, next: unknown): unknown {
  if (JSON.stringify(baseline) === JSON.stringify(next)) return original
  if (Array.isArray(next) && Array.isArray(baseline) && Array.isArray(original)) {
    return next.map((item) =>
      item && typeof item === 'object' && 'id' in item
        ? mergeNativeDelta(
            original.find((entry) => entry?.id === item.id),
            baseline.find((entry) => entry?.id === item.id),
            item
          )
        : item
    )
  }
  if (
    next &&
    baseline &&
    typeof next === 'object' &&
    typeof baseline === 'object' &&
    !Array.isArray(next) &&
    !Array.isArray(baseline)
  ) {
    const result = { ...(original as Record<string, unknown>) }
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
      const value = mergeNativeDelta(
        result[key],
        (baseline as Record<string, unknown>)[key],
        (next as Record<string, unknown>)[key]
      )
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  return next
}

/** One mounted canvas; pointer gestures and text-edit sessions flush as one set transaction. */
export class NativeSetSession {
  private baseline: DesignDocument | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private unsubscribe: (() => void) | undefined
  private closed = false
  private pointing = false
  private reflowing = false
  private abort = new AbortController()
  constructor(
    private session: CreativeSetSession,
    private outputId: string
  ) {}
  async open() {
    const output = this.session
      .snapshot()
      .document.outputs.find((output) => output.id === this.outputId)!
    const sources = await applyStoredDocument(
      this.session.client,
      materializeOutput(this.session.snapshot().document, output),
      'external',
      { replace: true, signal: this.abort.signal }
    )
    if (this.closed) return
    rememberUploadedSources(sources)
    useImageStore.temporal.getState().pause()
    this.baseline = withUploadedSources(exportDesignDocument({ keepLocalSources: true }))
    this.unsubscribe = useImageStore.subscribe((state, previous) => {
      if (this.reflowing) return
      clearTimeout(this.timer)
      if (
        state.canvasDimensions &&
        previous.canvasDimensions &&
        (state.canvasDimensions.canvasW !== previous.canvasDimensions.canvasW ||
          state.canvasDimensions.canvasH !== previous.canvasDimensions.canvasH)
      ) {
        this.reflowing = true
        try {
          // Pixel layers still use the previous viewport; resizing is not a document edit.
          const local = documentFromState(
            { ...state, canvasDimensions: previous.canvasDimensions },
            { keepLocalSources: true }
          )
          this.commitSnapshot(withUploadedSources(local))
          applyDesignLayout(local, (source) => source, state.canvasDimensions, 'external')
          this.baseline = withUploadedSources(exportDesignDocument({ keepLocalSources: true }))
        } catch (error) {
          this.session.editorFailure(
            error instanceof Error ? error.message : 'Could not resize the canvas.'
          )
        } finally {
          this.reflowing = false
        }
        return
      }
      if (!this.pointing) this.timer = setTimeout(() => this.safeFlush(), 500)
    })
    window.addEventListener('pointerdown', this.start, true)
    window.addEventListener('pointerup', this.end)
    window.addEventListener('pointercancel', this.end)
    window.addEventListener('focusout', this.end)
    window.addEventListener('blur', this.end)
  }
  private start = () => {
    this.safeFlush()
    this.pointing = true
  }
  private end = () => {
    this.pointing = false
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.safeFlush(), 0)
  }
  private safeFlush = () => {
    try {
      this.flush()
    } catch {
      /* The session keeps the failure visible and blocks saving. */
    }
  }
  flush = () => {
    try {
      this.flushNow()
      this.session.editorFailure(null)
    } catch (error) {
      this.session.editorFailure(
        error instanceof Error
          ? error.message
          : 'The canvas edit is invalid. Correct it before leaving this format.'
      )
      throw error
    }
  }
  private flushNow() {
    clearTimeout(this.timer)
    if (!this.baseline || this.closed) return
    const next = withUploadedSources(exportDesignDocument({ keepLocalSources: true }))
    this.commitSnapshot(next)
  }
  private commitSnapshot(next: DesignDocument) {
    if (!this.baseline || JSON.stringify(this.baseline) === JSON.stringify(next)) return
    const set = this.session.snapshot().document
    const output = set.outputs.find((output) => output.id === this.outputId)!
    const merged = mergeNativeDelta(output.document, this.baseline, next) as DesignDocument
    this.session.commit(nativeEdit(set, output.id, merged), false)
    this.baseline = next
  }
  close() {
    this.safeFlush()
    this.closed = true
    this.abort.abort()
    clearTimeout(this.timer)
    this.unsubscribe?.()
    window.removeEventListener('pointerdown', this.start, true)
    window.removeEventListener('pointerup', this.end)
    window.removeEventListener('pointercancel', this.end)
    window.removeEventListener('focusout', this.end)
    window.removeEventListener('blur', this.end)
    useImageStore.temporal.getState().clear()
    useImageStore.temporal.getState().resume()
  }
}
