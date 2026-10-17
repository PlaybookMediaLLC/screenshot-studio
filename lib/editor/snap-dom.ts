'use client'

import { create } from 'zustand'
import { useCanvasGuides } from '@/lib/store/canvas-guides'
import { canvasSnapLines, mergeSnapLines, objectSnapLines, type SnapBox, snapBox, type SnapLines } from './snapping'

/**
 * Snapping for layers that drag themselves (the screenshot, text): the same
 * lines and tolerance as Moveable layers, read from the canvas DOM.
 */

/** Layers other layers snap to. */
export const SNAPPABLE_SELECTOR =
  '[data-main-image-layer], [data-overlay-id], [data-text-overlay-id], [data-device-id], [data-element-id]'

/** The guide lines a drag is snapped to right now, for drawing. */
export const useActiveSnapGuides = create<{ horizontal: number | null; vertical: number | null }>()(() => ({
  horizontal: null,
  vertical: null,
}))

/** The canvas element a layer belongs to. */
export function canvasOf(node: Element | null): HTMLElement | null {
  return node?.closest<HTMLElement>('[data-html-canvas="true"]') ?? null
}

/** Lines a layer can snap to: the canvas's own, and every other layer's edges and centre. */
export function collectSnapLines(canvas: HTMLElement, exclude: Element | null): SnapLines {
  const guides = useCanvasGuides.getState()
  const origin = canvas.getBoundingClientRect()
  const boxes: SnapBox[] = guides.snapToObjects
    ? Array.from(canvas.querySelectorAll(SNAPPABLE_SELECTOR))
        .filter((node) => node !== exclude && !exclude?.contains(node))
        .map((node) => {
          const rect = node.getBoundingClientRect()
          return { height: rect.height, width: rect.width, x: rect.left - origin.left, y: rect.top - origin.top }
        })
    : []
  return mergeSnapLines(
    guides.snapToCanvas ? canvasSnapLines(origin.width, origin.height, guides.showThirds) : { horizontal: [], vertical: [] },
    objectSnapLines(boxes)
  )
}

/** Snap a dragged box (canvas px) and show the guides it snapped to. */
export function snapDrag(box: SnapBox, lines: SnapLines): { dx: number; dy: number } {
  const guides = useCanvasGuides.getState()
  if (!guides.snapping) {
    endSnapDrag()
    return { dx: 0, dy: 0 }
  }
  const result = snapBox(box, lines, guides.snapTolerance)
  useActiveSnapGuides.setState({ horizontal: result.horizontal, vertical: result.vertical })
  return { dx: result.dx, dy: result.dy }
}

/** Hide the drag guides. */
export function endSnapDrag() {
  useActiveSnapGuides.setState({ horizontal: null, vertical: null })
}
