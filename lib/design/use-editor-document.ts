'use client'

import { useEffect, useState } from 'react'
import { useImageStore } from '@/lib/store'
import type { DesignDocument } from './document'
import { exportDesignDocument } from './export'

/**
 * The live editor as a lossless document, refreshed once edits pause, for
 * previews that must show the design exactly as it is (frame, devices,
 * text, background). Null when the canvas has nothing to show.
 */
export function useEditorDocument(delayMs = 400): DesignDocument | null {
  const [document, setDocument] = useState<DesignDocument | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      const state = useImageStore.getState()
      const empty = !state.uploadedImageUrl && state.mockups.length === 0 && state.textOverlays.length === 0
      setDocument(empty ? null : exportDesignDocument({ keepLocalSources: true }))
    }
    refresh()
    const unsubscribe = useImageStore.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(refresh, delayMs)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [delayMs])

  return document
}
