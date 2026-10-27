import { applyEasing } from './interpolation'
import type { CubicBezier, EasingName } from './motion-schema'

/**
 * Easing curves for motion: CSS `cubic-bezier()` evaluation, and the named
 * easings the preset clips use.
 */

const EPSILON = 1e-7

/**
 * The easing function of CSS `cubic-bezier(x1, y1, x2, y2)`: progress in
 * 0-1 to eased progress. Solves the curve's x for the time with Newton's
 * method and falls back to bisection where the slope is flat, as browsers do.
 */
export function cubicBezier({ x1, x2, y1, y2 }: CubicBezier): (progress: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx

  const solveT = (x: number) => {
    let t = x
    for (let step = 0; step < 8; step++) {
      const error = sampleX(t) - x
      if (Math.abs(error) < EPSILON) return t
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    let low = 0
    let high = 1
    t = x
    while (high - low > EPSILON) {
      const value = sampleX(t)
      if (Math.abs(value - x) < EPSILON) return t
      if (value < x) low = t
      else high = t
      t = (low + high) / 2
    }
    return t
  }

  return (progress) => (progress <= 0 ? 0 : progress >= 1 ? 1 : sampleY(solveT(progress)))
}

/**
 * The closest `cubic-bezier()` to each named easing, so the curve editor can
 * start a custom curve from the preset the user picked.
 */
export const EASING_BEZIERS: Record<EasingName, CubicBezier> = {
  'ease-in': { x1: 0.55, x2: 0.68, y1: 0.085, y2: 0.53 },
  'ease-in-cubic': { x1: 0.55, x2: 0.675, y1: 0.055, y2: 0.19 },
  'ease-in-expo': { x1: 0.95, x2: 0.795, y1: 0.05, y2: 0.035 },
  'ease-in-out': { x1: 0.455, x2: 0.515, y1: 0.03, y2: 0.955 },
  'ease-out': { x1: 0.25, x2: 0.45, y1: 0.46, y2: 0.94 },
  'ease-out-cubic': { x1: 0.215, x2: 0.355, y1: 0.61, y2: 1 },
  'ease-out-expo': { x1: 0.19, x2: 0.22, y1: 1, y2: 1 },
  linear: { x1: 0, x2: 1, y1: 0, y2: 1 },
}

/** Eased progress for raw progress in 0-1: the custom curve when set, else the named easing. */
export function easeProgress(progress: number, easing: EasingName, bezier?: CubicBezier): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return bezier ? cubicBezier(bezier)(clamped) : applyEasing(clamped, easing)
}

/** A curve as the CSS `cubic-bezier()` it is, for display. */
export function formatBezier({ x1, x2, y1, y2 }: CubicBezier): string {
  const round = (value: number) => Number(value.toFixed(3))
  return `cubic-bezier(${round(x1)}, ${round(y1)}, ${round(x2)}, ${round(y2)})`
}
