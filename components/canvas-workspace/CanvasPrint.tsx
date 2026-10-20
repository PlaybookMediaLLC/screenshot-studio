'use client'

import { useEffect, useRef } from 'react'
import type { DesignDocument } from '@/lib/design/document'
import { RENDER_FRAME_PATH, type RenderRequest, type RenderResponse } from '@/lib/render/protocol'

declare global {
  interface Window {
    __canvasPrintReady?: boolean
    __canvasPrintError?: string
  }
}

/** One artboard to print: its native document with sources resolved, at its pixel size. */
export type PrintArtboard = {
  id: string
  width: number
  height: number
  document: DesignDocument
  /** Visible redactions: print the flattened pixels so nothing hidden is in the file. */
  raster: boolean
}

/**
 * Every artboard on a page of its own size, drawn live by the editor's
 * stage in a render frame per artboard (each frame has its own editor
 * state). The headless renderer prints this page to PDF once every frame
 * reports drawn, so text stays text and shapes stay vector shapes.
 */
export function CanvasPrint({ artboards }: { artboards: PrintArtboard[] }) {
  const frames = useRef<(HTMLIFrameElement | null)[]>([])
  useEffect(() => {
    const drawn = new Set<string>()
    const sent = new Set<string>()
    const listen = (event: MessageEvent<RenderResponse>) => {
      if (event.origin !== window.location.origin) return
      const index = frames.current.findIndex((frame) => frame?.contentWindow === event.source)
      const artboard = artboards[index]
      if (!artboard) return
      const message = event.data
      if (message.type === 'ready' && !sent.has(artboard.id)) {
        sent.add(artboard.id)
        const request: RenderRequest = {
          type: 'render',
          id: artboard.id,
          document: artboard.document,
          output: { format: 'png', strict: true },
          hold: true,
          raster: artboard.raster,
        }
        frames.current[index]?.contentWindow?.postMessage(request, window.location.origin)
      } else if (message.type === 'drawn') {
        drawn.add(message.id)
        if (drawn.size === artboards.length) window.__canvasPrintReady = true
      } else if (message.type === 'error') {
        window.__canvasPrintError = message.message
      }
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [artboards])
  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: transparent; }
        /* Only the artboards print: app chrome around them would add pages. */
        body *:not(:has(#canvas-print)):not(#canvas-print):not(#canvas-print *) { display: none !important; }
        ${
          // The app's wrappers come before the first artboard, so the first page takes
          // the default size: make that the first artboard's.
          artboards[0]
            ? `@page { size: ${artboards[0].width}px ${artboards[0].height}px; margin: 0; }`
            : ''
        }
        ${artboards
          .map(
            (artboard, index) =>
              `@page a${index} { size: ${artboard.width}px ${artboard.height}px; margin: 0; }`
          )
          .join('\n')}
      `}</style>
      <div id="canvas-print">
        {artboards.map((artboard, index) => (
          <div
            key={artboard.id}
            style={{
              page: `a${index}`,
              width: artboard.width,
              height: artboard.height,
              overflow: 'hidden',
              breakAfter: index < artboards.length - 1 ? 'page' : 'auto',
            }}
          >
            <iframe
              ref={(element) => {
                frames.current[index] = element
              }}
              src={`${RENDER_FRAME_PATH}?print=1`}
              title={`Artboard ${index + 1}`}
              width={artboard.width}
              height={artboard.height}
              style={{ border: 0, display: 'block' }}
            />
          </div>
        ))}
      </div>
    </>
  )
}
