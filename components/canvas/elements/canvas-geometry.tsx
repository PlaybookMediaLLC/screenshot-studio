'use client'

import { createContext, useContext } from 'react'
import type { StageRect } from '../utils/canvas-dimensions'

/** What elements need to know about the stage they sit on. */
export type CanvasGeometry = {
  canvasW: number
  canvasH: number
  /** Where the screenshot's pixels are drawn, or null when none is drawn (device scenes). */
  imageRect: StageRect | null
  /** The screenshot's source, for elements that show it (zoom callouts). */
  imageSrc: string | null
  imageNaturalSize: { height: number; width: number } | null
  /** The screenshot's adjustments as a CSS filter, so a callout matches it. */
  imageFilter: string | undefined
}

/** The stage's geometry, provided by the canvas renderer. */
export const CanvasGeometryContext = createContext<CanvasGeometry | null>(null)

/** Read the stage's geometry; throws outside a canvas. */
export function useCanvasGeometry(): CanvasGeometry {
  const geometry = useContext(CanvasGeometryContext)
  if (!geometry) throw new Error('useCanvasGeometry needs a CanvasGeometryContext provider.')
  return geometry
}

/** A rectangle for drawing the screenshot when the stage does not draw it itself. */
export function fallbackImageRect(geometry: CanvasGeometry): StageRect | null {
  if (geometry.imageRect) return geometry.imageRect
  const natural = geometry.imageNaturalSize
  if (!natural) return null
  const scale = Math.min(geometry.canvasW / natural.width, geometry.canvasH / natural.height) * 0.8
  const width = natural.width * scale
  const height = natural.height * scale
  return { height, width, x: (geometry.canvasW - width) / 2, y: (geometry.canvasH - height) / 2 }
}
