'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeDocumentBridge } from '@/lib/creative-sets/native-session'
import type { CanvasSession } from '@/lib/canvas/session'

/**
 * Mount one artboard in the native editor and keep it in step with the
 * canvas document. The editor reloads only when that artboard's document
 * changed from outside the editor (undo, a template, a brand kit, a
 * collaborator), never because another artboard moved. Switching
 * artboards flushes the open one first, so one artboard's editor state is
 * never written into another.
 */
export function useNativeArtboard(
  session: CanvasSession,
  activeId: string | null,
  enabled: boolean,
  loadEpoch: number
) {
  const bridge = useRef<NativeDocumentBridge | null>(null)
  const loaded = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const activeJson = useCallback(() => {
    const artboard = session.snapshot().document.artboards.find((item) => item.id === activeId)
    return artboard ? JSON.stringify(artboard.document) : null
  }, [session, activeId])

  // A load epoch means the document changed outside the editor; reload only if this artboard did.
  useEffect(() => {
    if (!bridge.current) return
    if (activeJson() !== loaded.current) setReload((value) => value + 1)
  }, [loadEpoch, activeJson])

  useEffect(() => {
    if (!enabled || !activeId) {
      setReady(false)
      return
    }
    if (!session.snapshot().document.artboards.some((item) => item.id === activeId)) return
    const instance = session.nativeBridge(activeId, (document) => {
      loaded.current = JSON.stringify(document)
    })
    bridge.current = instance
    loaded.current = activeJson()
    setReady(false)
    setError(null)
    instance.open().then(
      () => {
        if (bridge.current === instance) setReady(true)
      },
      (failure: unknown) => {
        if (bridge.current === instance)
          setError(
            failure instanceof Error ? failure.message : 'This artboard could not be opened.'
          )
      }
    )
    return () => {
      instance.close()
      if (bridge.current === instance) bridge.current = null
    }
  }, [session, activeId, enabled, reload, activeJson])

  /** Commit the open artboard's pending edit now. Throws when the edit cannot be stored. */
  const flush = useCallback(() => {
    bridge.current?.flush()
  }, [])

  return { ready: ready && Boolean(activeId), error, flush }
}
