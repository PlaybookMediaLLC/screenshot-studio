import { z } from 'zod'
import type { Rect } from './geometry'

/**
 * Smart snapping for canvas drags. Pure and unit-agnostic: callers pass
 * slide-pixel rectangles and a threshold already divided by the zoom, so
 * snapping feels the same at every zoom level.
 */

/** Guide axis: a vertical line at an x position, or a horizontal line at a y position. */
export const axisSchema = z.enum(['x', 'y'])

/** Axis. */
export type Axis = z.infer<typeof axisSchema>

/** A guide line to draw while a snap is active. Positions are slide pixels. */
export type SnapGuide = { axis: Axis; position: number; from: number; to: number }

/** Result of snapping a moving rectangle. */
export type SnapResult = { dx: number; dy: number; guides: SnapGuide[] }

/** Edges and centre lines of a rectangle on one axis. */
function lines(rect: Rect, axis: Axis): number[] {
  return axis === 'x'
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
}

function bestSnap(moving: number[], targets: number[], threshold: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null
  for (const line of moving) {
    for (const target of targets) {
      const delta = target - line
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target }
    }
  }
  return best
}

/**
 * Snap `moving` (already offset by the raw drag) to the slide edges and
 * centre, the safe area, and other layers' edges and centres.
 */
export function snapRect(
  moving: Rect,
  slide: { width: number; height: number },
  others: Rect[],
  threshold: number,
  safeArea?: Rect
): SnapResult {
  const frames = [{ x: 0, y: 0, width: slide.width, height: slide.height }, ...(safeArea ? [safeArea] : []), ...others]
  const targetsX = frames.flatMap((frame) => lines(frame, 'x'))
  const targetsY = frames.flatMap((frame) => lines(frame, 'y'))
  const snapX = bestSnap(lines(moving, 'x'), targetsX, threshold)
  const snapY = bestSnap(lines(moving, 'y'), targetsY, threshold)
  const dx = snapX?.delta ?? 0
  const dy = snapY?.delta ?? 0
  const guides: SnapGuide[] = []
  if (snapX) guides.push({ axis: 'x', position: snapX.target, from: 0, to: slide.height })
  if (snapY) guides.push({ axis: 'y', position: snapY.target, from: 0, to: slide.width })
  return { dx, dy, guides }
}
