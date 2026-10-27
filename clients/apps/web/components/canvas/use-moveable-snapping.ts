'use client'

import { useEffect, useState } from 'react'
import { canvasOf, SNAPPABLE_SELECTOR } from '@/lib/editor/snap-dom'
import { canvasSnapLines } from '@/lib/editor/snapping'
import { useCanvasGuides } from '@/lib/store/canvas-guides'

const ALL_SIDES = { bottom: true, center: true, left: true, middle: true, right: true, top: true }

/**
 * Moveable props that snap a layer to the canvas and to every other layer,
 * with the user's tolerance, exactly as self-dragging layers do.
 */
export function useMoveableSnapping(target: HTMLElement | null, refreshKey: unknown) {
  const guides = useCanvasGuides()
  const [others, setOthers] = useState<HTMLElement[]>([])
  const [size, setSize] = useState({ height: 0, width: 0 })

  useEffect(() => {
    const canvas = canvasOf(target)
    if (!canvas || !target) return
    setSize({ height: canvas.clientHeight, width: canvas.clientWidth })
    setOthers(
      Array.from(canvas.querySelectorAll<HTMLElement>(SNAPPABLE_SELECTOR)).filter(
        (node) => node !== target && !node.contains(target) && !target.contains(node)
      )
    )
  }, [target, refreshKey])

  const lines = canvasSnapLines(size.width, size.height, guides.showThirds)
  const toCanvas = guides.snapping && guides.snapToCanvas
  return {
    elementGuidelines: guides.snapping && guides.snapToObjects ? others : [],
    elementSnapDirections: ALL_SIDES,
    horizontalGuidelines: toCanvas ? lines.horizontal : [],
    isDisplaySnapDigit: false,
    snapDirections: ALL_SIDES,
    snapThreshold: guides.snapTolerance,
    snappable: guides.snapping,
    verticalGuidelines: toCanvas ? lines.vertical : [],
  }
}
