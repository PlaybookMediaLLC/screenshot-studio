'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { DesignDocument } from '@/lib/design/document'
import type { StageOutput } from './capture'
import { cachedPreview, previewKey, renderPreview } from './preview-cache'

/** Where a preview is: waiting to be needed, rendering, shown, or failed. */
export const previewStatusSchema = z.enum(['idle', 'rendering', 'ready', 'error'])
/** A preview's status. */
export type PreviewStatus = z.infer<typeof previewStatusSchema>

/**
 * A rendered preview of a document, drawn by the editor's own stage. While a
 * new version renders, the previous image stays up. Renders only while
 * `enabled` (for example, while the preview is on screen).
 */
export function useDocumentPreview(
  document: DesignDocument | null,
  output: StageOutput,
  { enabled = true, time = 0 }: { enabled?: boolean; time?: number } = {}
): { status: PreviewStatus; url: string | null } {
  const key = document ? previewKey(document, output, time) : null
  const [state, setState] = useState<{ key: string | null; status: PreviewStatus; url: string | null }>({
    key: null,
    status: 'idle',
    url: null,
  })

  useEffect(() => {
    if (!key || !document || !enabled) return
    const cached = cachedPreview(key)
    if (cached) {
      setState({ key, status: 'ready', url: cached })
      return
    }
    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'rendering' }))
    renderPreview(key, document, output, { time }).then(
      (url) => {
        if (!controller.signal.aborted) setState({ key, status: 'ready', url })
      },
      () => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, status: 'error' }))
      }
    )
    return () => controller.abort()
    // The key covers document, output, and time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key])

  return { status: state.status, url: state.url }
}
