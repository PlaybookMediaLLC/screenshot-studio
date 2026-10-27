import { memo } from 'react'
import { useCanvasGuides } from '@/lib/store/canvas-guides'

interface HTMLGridLayerProps {
  canvasW: number
  canvasH: number
  gridSize?: number
}

export const HTMLGridLayer = memo(function HTMLGridLayer({
  canvasW,
  canvasH,
  gridSize = 50,
}: HTMLGridLayerProps) {
  // A guide, not part of the design: exported only when guides are.
  const guidesInExport = useCanvasGuides((state) => state.guidesInExport)
  return (
    <div
      aria-hidden
      data-export-exclude={guidesInExport ? undefined : 'true'}
      style={{
        position: 'absolute',
        inset: 0,
        width: `${canvasW}px`,
        height: `${canvasH}px`,
        zIndex: 250,
        pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(to right, rgba(128,128,128,0.25) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(128,128,128,0.25) 1px, transparent 1px)
        `,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }}
    />
  )
})
