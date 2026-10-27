import type { Point } from '@/lib/store-screenshots/engine/geometry'

/** Gap between a contextual toolbar and the element it belongs to, in screen pixels. */
const TOOLBAR_GAP = 12

/**
 * Place a contextual toolbar next to an element without covering it: above
 * the element's on-screen bounds when there is room, otherwise below, then
 * beside it, and finally pinned to the viewport edge. Works for rotated and
 * tilted elements because it uses their projected outline.
 */
export function placeToolbar(
  outline: Point[],
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number }
): Point {
  const left = Math.min(...outline.map((point) => point.x))
  const right = Math.max(...outline.map((point) => point.x))
  const top = Math.min(...outline.map((point) => point.y))
  const bottom = Math.max(...outline.map((point) => point.y))
  const centerX = (left + right) / 2
  const clampX = (x: number) => Math.max(8, Math.min(viewport.width - toolbar.width - 8, x))
  const clampY = (y: number) => Math.max(8, Math.min(viewport.height - toolbar.height - 8, y))
  if (top - TOOLBAR_GAP - toolbar.height >= 8) {
    return { x: clampX(centerX - toolbar.width / 2), y: top - TOOLBAR_GAP - toolbar.height }
  }
  if (bottom + TOOLBAR_GAP + toolbar.height <= viewport.height - 8) {
    return { x: clampX(centerX - toolbar.width / 2), y: bottom + TOOLBAR_GAP }
  }
  if (right + TOOLBAR_GAP + toolbar.width <= viewport.width - 8) {
    return { x: right + TOOLBAR_GAP, y: clampY((top + bottom) / 2 - toolbar.height / 2) }
  }
  if (left - TOOLBAR_GAP - toolbar.width >= 8) {
    return { x: left - TOOLBAR_GAP - toolbar.width, y: clampY((top + bottom) / 2 - toolbar.height / 2) }
  }
  return { x: clampX(centerX - toolbar.width / 2), y: 8 }
}
