import { z } from 'zod'
import { boundsOf, type WorkspaceRect } from './document'
import { intersects } from './viewport'

/**
 * Arrangement of artboards on the plane: alignment, distribution, tidying,
 * snapping and placement. Pure functions over workspace rectangles; the
 * board turns their results into commands.
 */

/** A rectangle that belongs to an artboard. */
export type PlacedRect = { id: string; rect: WorkspaceRect }
/** Where an artboard moves to. */
export type Position = { id: string; x: number; y: number }

/** Edges and centres a selection can line up on. */
export const alignModeSchema = z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom'])
/** One of {@link alignModeSchema}. */
export type AlignMode = z.infer<typeof alignModeSchema>

/** The direction a selection spreads out in. */
export const distributeAxisSchema = z.enum(['horizontal', 'vertical'])
/** One of {@link distributeAxisSchema}. */
export type DistributeAxis = z.infer<typeof distributeAxisSchema>

/** Gap between artboards placed or tidied automatically, in workspace units. */
export const ARTBOARD_GAP = 120

/** Line every rectangle up on the selection's edge or centre. */
export function alignRects(items: readonly PlacedRect[], mode: AlignMode): Position[] {
  const bounds = boundsOf(items.map((item) => item.rect))
  if (!bounds || items.length < 2) return []
  return items.map(({ id, rect }) => {
    switch (mode) {
      case 'left':
        return { id, x: bounds.x, y: rect.y }
      case 'center':
        return { id, x: bounds.x + (bounds.width - rect.width) / 2, y: rect.y }
      case 'right':
        return { id, x: bounds.x + bounds.width - rect.width, y: rect.y }
      case 'top':
        return { id, x: rect.x, y: bounds.y }
      case 'middle':
        return { id, x: rect.x, y: bounds.y + (bounds.height - rect.height) / 2 }
      case 'bottom':
        return { id, x: rect.x, y: bounds.y + bounds.height - rect.height }
    }
  })
}

/** Equal gaps between neighbours, keeping the outermost two in place. Needs three. */
export function distributeRects(items: readonly PlacedRect[], axis: DistributeAxis): Position[] {
  if (items.length < 3) return []
  const horizontal = axis === 'horizontal'
  const start = (rect: WorkspaceRect) => (horizontal ? rect.x : rect.y)
  const length = (rect: WorkspaceRect) => (horizontal ? rect.width : rect.height)
  const sorted = [...items].sort((a, b) => start(a.rect) - start(b.rect))
  const first = sorted[0]!.rect
  const last = sorted.at(-1)!.rect
  const span = start(last) + length(last) - start(first)
  const used = sorted.reduce((total, item) => total + length(item.rect), 0)
  const gap = (span - used) / (sorted.length - 1)
  let cursor = start(first)
  return sorted.map(({ id, rect }) => {
    const position = horizontal ? { id, x: cursor, y: rect.y } : { id, x: rect.x, y: cursor }
    cursor += length(rect) + gap
    return position
  })
}

/**
 * Arrange in reading order (rows top to bottom, then left to right) into a
 * grid starting where the selection starts. Each row is as tall as its
 * tallest artboard.
 */
export function tidyRects(
  items: readonly PlacedRect[],
  { gap = ARTBOARD_GAP, columns }: { gap?: number; columns?: number } = {}
): Position[] {
  const bounds = boundsOf(items.map((item) => item.rect))
  if (!bounds) return []
  const ordered = readingOrder(items)
  const perRow = Math.max(1, columns ?? Math.ceil(Math.sqrt(ordered.length)))
  const result: Position[] = []
  let y = bounds.y
  for (let row = 0; row * perRow < ordered.length; row++) {
    const cells = ordered.slice(row * perRow, (row + 1) * perRow)
    let x = bounds.x
    for (const { id, rect } of cells) {
      result.push({ id, x, y })
      x += rect.width + gap
    }
    y += Math.max(...cells.map((cell) => cell.rect.height)) + gap
  }
  return result
}

/**
 * Rows by vertical overlap, then left to right: the order a person reads a
 * board in, used for ordered exports and tidying.
 */
export function readingOrder<T extends PlacedRect>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  const rows: T[][] = []
  for (const item of sorted) {
    const row = rows.find((candidate) =>
      candidate.some(
        (other) =>
          item.rect.y < other.rect.y + other.rect.height * 0.5 &&
          other.rect.y < item.rect.y + item.rect.height * 0.5
      )
    )
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.rect.x - b.rect.x))
}

/** The axis a snap guide runs across: `x` guides are vertical lines at an x position. */
export const snapAxisSchema = z.enum(['x', 'y'])
/** One of {@link snapAxisSchema}. */
export type SnapAxis = z.infer<typeof snapAxisSchema>
/** A guide line drawn while snapping, in workspace units. */
export type SnapGuide = { axis: SnapAxis; position: number; from: number; to: number }

/**
 * Snap a moving selection's bounds to the edges and centres of other
 * artboards within `threshold` workspace units, or else to the grid.
 * Returns the correction to add to the move and the guides to draw.
 */
export function snapMove(
  moving: WorkspaceRect,
  others: readonly WorkspaceRect[],
  threshold: number,
  grid: number | null = null
): { dx: number; dy: number; guides: SnapGuide[] } {
  const axis = (horizontal: boolean) => {
    const start = (rect: WorkspaceRect) => (horizontal ? rect.x : rect.y)
    const size = (rect: WorkspaceRect) => (horizontal ? rect.width : rect.height)
    const lines = (rect: WorkspaceRect) => [
      start(rect),
      start(rect) + size(rect) / 2,
      start(rect) + size(rect),
    ]
    let best: { delta: number; position: number } | null = null
    for (const other of others) {
      for (const target of lines(other)) {
        for (const source of lines(moving)) {
          const delta = target - source
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
            best = { delta, position: target }
        }
      }
    }
    if (best) return best
    if (grid && grid > 0) {
      const delta = Math.round(start(moving) / grid) * grid - start(moving)
      return { delta, position: null }
    }
    return { delta: 0, position: null }
  }
  const x = axis(true)
  const y = axis(false)
  const snapped = { ...moving, x: moving.x + x.delta, y: moving.y + y.delta }
  const guides: SnapGuide[] = []
  const span = (rects: readonly WorkspaceRect[], horizontal: boolean) => {
    const values = rects.flatMap((rect) =>
      horizontal ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width]
    )
    return { from: Math.min(...values), to: Math.max(...values) }
  }
  const touching = (position: number, horizontal: boolean) =>
    others.filter((rect) =>
      (horizontal
        ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
        : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
      ).some((line) => Math.abs(line - position) < 0.5)
    )
  if (x.position !== null)
    guides.push({
      axis: 'x',
      position: x.position,
      ...span([snapped, ...touching(x.position, true)], true),
    })
  if (y.position !== null)
    guides.push({
      axis: 'y',
      position: y.position,
      ...span([snapped, ...touching(y.position, false)], false),
    })
  return { dx: x.delta, dy: y.delta, guides }
}

/** Round a value to the grid, when there is one. */
export function snapToGrid(value: number, grid: number | null): number {
  return grid && grid > 0 ? Math.round(value / grid) * grid : value
}

/** Where a new artboard of this size goes: to the right of everything, top-aligned. */
export function nextArtboardPosition(
  existing: readonly WorkspaceRect[],
  gap = ARTBOARD_GAP
): { x: number; y: number } {
  const bounds = boundsOf(existing)
  if (!bounds) return { x: 0, y: 0 }
  return { x: bounds.x + bounds.width + gap, y: bounds.y }
}

/** The topmost artboard under a workspace point; later artboards draw on top. */
export function hitTest(
  items: readonly PlacedRect[],
  point: { x: number; y: number }
): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const { id, rect } = items[index]!
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    )
      return id
  }
  return null
}

/** Every artboard a marquee touches. */
export function marqueeSelect(items: readonly PlacedRect[], marquee: WorkspaceRect): string[] {
  return items.filter((item) => intersects(item.rect, marquee)).map((item) => item.id)
}
