import { projectTransformedCorners, type Point, type Rect } from './geometry'
import type { Scene, SceneNode } from './scene'

/**
 * Hit testing against the drawn shapes. Uses the same projection as the
 * renderer, so a click lands on what the user sees even for rotated and
 * tilted layers.
 */

/** Whether a point is inside a polygon (ray casting). */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** The rectangle used for picking: glyph bounds for text (padded), the box otherwise. */
export function pickRect(node: SceneNode): Rect {
  if (node.type !== 'text') return node.box
  const pad = node.fontSizePx * 0.15
  return { x: node.ink.x - pad, y: node.ink.y - pad, width: node.ink.width + pad * 2, height: node.ink.height + pad * 2 }
}

/** The drawn outline of a node, in slide pixels. */
export function nodeOutline(node: SceneNode): Point[] {
  return projectTransformedCorners(pickRect(node), node.rotation, node.tiltX, node.tiltY)
}

/** Topmost unlocked node under a slide point, or null. */
export function hitTest(scene: Scene, point: Point, includeLocked = false): SceneNode | null {
  for (let index = scene.nodes.length - 1; index >= 0; index -= 1) {
    const node = scene.nodes[index]
    if (node.locked && !includeLocked) continue
    if (pointInPolygon(point, nodeOutline(node))) return node
  }
  return null
}
