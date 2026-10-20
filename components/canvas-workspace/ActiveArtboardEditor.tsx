'use client'

import { useEffect, useState } from 'react'
import { CanvasStageShell } from '@/components/canvas/CanvasStageShell'
import ClientCanvas from '@/components/canvas/ClientCanvas'
import { artboardRect, type Artboard } from '@/lib/canvas/document'
import { useCanvasViewport } from '@/lib/canvas/ui-store'
import { rectToScreen } from '@/lib/canvas/viewport'

/** Largest stage side the live editor draws; beyond it the stage is scaled, not redrawn larger. */
const MAX_STAGE = 4096

/**
 * The one mounted native editor, placed over its artboard. The stage is
 * laid out at the artboard's on-screen size when the camera is at rest;
 * while a zoom gesture runs it is only scaled, so the editor does not lay
 * its layers out again on every frame. Panning just moves it.
 */
export function ActiveArtboardEditor({
  artboard,
  ready,
  error,
  children,
}: {
  artboard: Artboard
  ready: boolean
  error: string | null
  /** Drawn over the stage in its coordinates, such as the layer selection. */
  children?: React.ReactNode
}) {
  const viewport = useCanvasViewport((state) => state.viewport)
  const settledZoom = useCanvasViewport((state) => state.settledZoom)
  const rect = artboardRect(artboard)
  const screenRect = rectToScreen(viewport, rect)
  const fit = Math.min(1, MAX_STAGE / Math.max(rect.width * settledZoom, rect.height * settledZoom))
  const stageZoom = settledZoom * fit
  const scale = viewport.zoom / stageZoom
  const [shown, setShown] = useState(false)
  // Reveal one frame after the editor reports ready, once the stage has its final size.
  useEffect(() => {
    if (!ready) {
      setShown(false)
      return
    }
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [ready])
  return (
    <>
      <div
        data-canvas-editor
        data-testid="canvas-active-editor"
        aria-label={`Editing ${artboard.name}`}
        className="absolute z-10 origin-top-left"
        style={{
          left: screenRect.x,
          top: screenRect.y,
          width: rect.width * stageZoom,
          height: rect.height * stageZoom,
          transform: Math.abs(scale - 1) > 1e-3 ? `scale(${scale})` : undefined,
          opacity: shown ? 1 : 0,
          pointerEvents: shown ? 'auto' : 'none',
        }}
      >
        <div data-canvas-viewport className="absolute inset-0 flex items-center justify-center">
          <CanvasStageShell id="image-render-card" className="overflow-hidden shadow-none ring-0">
            <ClientCanvas embedded />
          </CanvasStageShell>
        </div>
        {shown ? children : null}
      </div>
      {!shown ? (
        <div
          role="status"
          className="pointer-events-none absolute z-10 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm"
          style={{ left: screenRect.x + 8, top: screenRect.y + 8 }}
        >
          {error ?? 'Opening artboard…'}
        </div>
      ) : null}
    </>
  )
}
