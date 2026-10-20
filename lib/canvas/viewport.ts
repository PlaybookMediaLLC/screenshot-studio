import { z } from 'zod'
import type { WorkspaceRect } from './document'

/**
 * The camera over the plane. A workspace point `p` appears on screen at
 * `p * zoom + pan`. The viewport is session state: it is never saved in the
 * document or undone.
 */
export const viewportSchema = z.object({
  panX: z.number().finite(),
  panY: z.number().finite(),
  zoom: z.number().finite().positive(),
})
/** One of {@link viewportSchema}. */
export type Viewport = z.infer<typeof viewportSchema>

/** A point in screen pixels or workspace units, depending on context. */
export type Point = { x: number; y: number }
/** A screen area in pixels. */
export type ScreenSize = { width: number; height: number }

/** Zoom limits: far enough out to see a whole campaign, close enough to place a cursor badge. */
export const ZOOM_LIMITS = { min: 0.02, max: 4 } as const
/** Keyboard and menu zoom stops. */
export const ZOOM_STOPS = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const

/** The default camera: 100%, workspace origin at the top-left. */
export const DEFAULT_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1 }

/** Keep a zoom level inside {@link ZOOM_LIMITS}. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom))
}

/** Where a workspace point appears on screen. */
export function worldToScreen(viewport: Viewport, point: Point): Point {
  return { x: point.x * viewport.zoom + viewport.panX, y: point.y * viewport.zoom + viewport.panY }
}

/** The workspace point under a screen point. */
export function screenToWorld(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  }
}

/** A workspace rectangle in screen pixels. */
export function rectToScreen(viewport: Viewport, rect: WorkspaceRect): WorkspaceRect {
  const origin = worldToScreen(viewport, rect)
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  }
}

/** Move the camera by a screen distance. */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, panX: viewport.panX + dx, panY: viewport.panY + dy }
}

/** Zoom to a level while the workspace point under `anchor` stays under it. */
export function zoomAt(viewport: Viewport, anchor: Point, zoom: number): Viewport {
  const next = clampZoom(zoom)
  const world = screenToWorld(viewport, anchor)
  return { zoom: next, panX: anchor.x - world.x * next, panY: anchor.y - world.y * next }
}

/**
 * A wheel or pinch gesture's zoom factor. Trackpad pinches arrive as small
 * `ctrlKey` wheel deltas; mouse wheels as larger steps. Both scale smoothly.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.01)
}

/** The next zoom stop in a direction, from the current level. */
export function steppedZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STOPS.find((stop) => stop > zoom + 1e-6) ?? ZOOM_LIMITS.max
  return [...ZOOM_STOPS].reverse().find((stop) => stop < zoom - 1e-6) ?? ZOOM_LIMITS.min
}

/**
 * The camera that shows `rect` centred in `screen` with `padding` pixels on
 * every side, never closer than `maxZoom`.
 */
export function fitRect(
  rect: WorkspaceRect,
  screen: ScreenSize,
  { padding = 64, maxZoom = 1 }: { padding?: number; maxZoom?: number } = {}
): Viewport {
  const width = Math.max(1, screen.width - padding * 2)
  const height = Math.max(1, screen.height - padding * 2)
  const zoom = clampZoom(
    Math.min(maxZoom, width / Math.max(1, rect.width), height / Math.max(1, rect.height))
  )
  return {
    zoom,
    panX: screen.width / 2 - (rect.x + rect.width / 2) * zoom,
    panY: screen.height / 2 - (rect.y + rect.height / 2) * zoom,
  }
}

/** The workspace area the screen shows, grown by `margin` screen pixels for pre-loading. */
export function visibleWorldRect(
  viewport: Viewport,
  screen: ScreenSize,
  margin = 0
): WorkspaceRect {
  const topLeft = screenToWorld(viewport, { x: -margin, y: -margin })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: (screen.width + margin * 2) / viewport.zoom,
    height: (screen.height + margin * 2) / viewport.zoom,
  }
}

/** Whether two rectangles overlap (touching edges count). */
export function intersects(a: WorkspaceRect, b: WorkspaceRect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  )
}

/** A rectangle from two corner points in any order. */
export function rectFromPoints(a: Point, b: Point): WorkspaceRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/**
 * The preview width worth rendering for an artboard shown `screenWidth`
 * pixels wide: a few fixed buckets, so zooming reuses cached renders.
 */
export function previewWidthFor(screenWidth: number, devicePixelRatio = 1): number {
  const needed = screenWidth * Math.min(2, devicePixelRatio)
  return [320, 640, 1280, 2048].find((bucket) => bucket >= needed) ?? 2048
}
