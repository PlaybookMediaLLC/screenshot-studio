'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasStageShell } from '@/components/canvas/CanvasStageShell'
import ClientCanvas, { getCanvasContainer } from '@/components/canvas/ClientCanvas'
import { EditorStoreSync } from '@/components/canvas/EditorStoreSync'
import { useBackgroundImageReady } from '@/hooks/useBackgroundImageReady'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { applyDesignDocument, applyDesignLayout, waitForSettledCanvas } from '@/lib/design/apply'
import type { DesignDocument } from '@/lib/design/document'
import { exportElement } from '@/lib/export/export-service'
import { useEditorStore, useImageStore } from '@/lib/store'

declare global {
  interface Window {
    __designReady?: boolean
    __exportDesign?: () => Promise<{ base64: string; height: number; width: number }>
  }
}

type DesignRenderStageProps = {
  document: DesignDocument
  sources: Record<string, string>
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/**
 * Renders one design with the editor's own canvas and export pipeline, then
 * exposes `window.__exportDesign` for the headless renderer. Nothing here is
 * interactive; it is the editor stage without the editor.
 */
export function DesignRenderStage({ document, sources }: DesignRenderStageProps) {
  const [applied, setApplied] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const [layoutApplied, setLayoutApplied] = useState(false)
  const layoutStarted = useRef(false)
  const backgroundConfig = useImageStore((state) => state.backgroundConfig)
  const backgroundReady = useBackgroundImageReady(backgroundConfig)
  const resolve = (ref: string) => sources[ref] ?? ref

  useLayoutEffect(() => {
    applyDesignDocument(document, resolve)
    setApplied(true)
    // The document is fixed for the life of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!applied || layoutStarted.current) return
    layoutStarted.current = true
    const preset = getAspectRatioPreset(useImageStore.getState().selectedAspectRatio)
    void waitForSettledCanvas(preset ? preset.width / preset.height : null).then((dims) => {
      applyDesignLayout(document, resolve, dims)
      setLayoutApplied(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied])

  useEffect(() => {
    if (!canvasReady || !backgroundReady || !layoutApplied) return
    let cancelled = false
    void (async () => {
      await window.document.fonts.ready
      // Two frames so layers placed in phase 2 have painted.
      await new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
      )
      if (cancelled) return
      window.__exportDesign = async () => {
        const image = useImageStore.getState()
        const preset = getAspectRatioPreset(image.selectedAspectRatio)
        if (!preset) throw new Error('Unknown aspect ratio.')
        const { blob } = await exportElement(
          'image-render-card',
          {
            exportHeight: preset.height,
            exportWidth: preset.width,
            format: 'png',
            qualityPreset: 'high',
            // The editor's default export scale.
            scale: 2,
            skipSharp: true,
          },
          getCanvasContainer(),
          image.backgroundConfig,
          image.backgroundBorderRadius,
          image.textOverlays,
          image.imageOverlays,
          image.perspective3D,
          useEditorStore.getState().screenshot.src || undefined,
          useEditorStore.getState().screenshot.radius,
          image.backgroundBlur,
          image.backgroundNoise,
          image.backgroundConfig.opacity ?? 1
        )
        return {
          base64: await blobToBase64(blob),
          height: preset.height * 2,
          width: preset.width * 2,
        }
      }
      window.__designReady = true
    })()
    return () => {
      cancelled = true
    }
  }, [backgroundReady, canvasReady, layoutApplied])

  return (
    <main className="flex min-h-screen items-center justify-center bg-transparent p-6">
      <style>{`*, *::before, *::after { transition: none !important; animation: none !important; }`}</style>
      <EditorStoreSync />
      {applied ? (
        <CanvasStageShell className="shrink-0 overflow-hidden" id="image-render-card">
          <div className="absolute inset-0">
            <ClientCanvas embedded onReady={() => setCanvasReady(true)} />
          </div>
        </CanvasStageShell>
      ) : null}
    </main>
  )
}
