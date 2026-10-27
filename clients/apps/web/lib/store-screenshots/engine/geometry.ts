/**
 * Plane geometry for layout, hit testing, and selection. Rotations are in
 * degrees, clockwise (CSS `rotate`), about the rectangle's centre.
 */

/** An axis-aligned rectangle. */
export type Rect = { x: number; y: number; width: number; height: number }

/** A point. */
export type Point = { x: number; y: number }

/** Centre of a rectangle. */
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** Rotate a point about a centre. */
export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** Corners of a rotated rectangle: top-left, top-right, bottom-right, bottom-left. */
export function rotatedCorners(rect: Rect, degrees: number): Point[] {
  const center = rectCenter(rect)
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((corner) => rotatePoint(corner, center, degrees))
}

/** Axis-aligned bounds of a rotated rectangle. */
export function rotatedBounds(rect: Rect, degrees: number): Rect {
  if (degrees % 360 === 0) return rect
  const corners = rotatedCorners(rect, degrees)
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Area shared by two rectangles. */
export function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/** Whether a point lies inside a rotated rectangle. */
export function pointInRotatedRect(point: Point, rect: Rect, degrees: number): boolean {
  const local = rotatePoint(point, rectCenter(rect), -degrees)
  return (
    local.x >= rect.x &&
    local.x <= rect.x + rect.width &&
    local.y >= rect.y &&
    local.y <= rect.y + rect.height
  )
}

/** Union of rectangles; null for none. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Clamp a number. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Round to a number of decimals. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Perspective distance used for device tilt, as a multiple of the box height. */
export const TILT_PERSPECTIVE = 2.4

/**
 * The CSS transform the renderer applies to a box: rotate, then a
 * perspective tilt about the centre. Kept here so the selection overlay can
 * project the same corners with `projectTransformedCorners`.
 */
export function boxTransformCss(height: number, rotation: number, tiltX: number, tiltY: number): string {
  if (tiltX === 0 && tiltY === 0) return `rotate(${rotation}deg)`
  return `rotate(${rotation}deg) perspective(${height * TILT_PERSPECTIVE}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`
}

/**
 * Screen-space corners (TL, TR, BR, BL) of a box drawn with
 * `boxTransformCss`, matching the browser's math: rotateY, then rotateX,
 * then perspective divide, then the 2D rotation, about the box centre.
 */
export function projectTransformedCorners(rect: Rect, rotation: number, tiltX: number, tiltY: number): Point[] {
  if (tiltX === 0 && tiltY === 0) return rotatedCorners(rect, rotation)
  const center = rectCenter(rect)
  const distance = rect.height * TILT_PERSPECTIVE
  const ax = (tiltX * Math.PI) / 180
  const ay = (tiltY * Math.PI) / 180
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((corner) => {
    const x0 = corner.x - center.x
    const y0 = corner.y - center.y
    // rotateY
    const x1 = x0 * Math.cos(ay)
    const z1 = -x0 * Math.sin(ay)
    // rotateX
    const y2 = y0 * Math.cos(ax) - z1 * Math.sin(ax)
    const z2 = y0 * Math.sin(ax) + z1 * Math.cos(ax)
    // perspective: w = 1 - z / d
    const w = 1 - z2 / distance
    const projected = { x: center.x + x1 / w, y: center.y + y2 / w }
    return rotatePoint(projected, center, rotation)
  })
}
