import { z } from 'zod'

/**
 * Composition layouts for any number of screens. Each layout is pure math on
 * the screens' box aspects and the canvas aspect, so applying a layout, its
 * preview thumbnail, and a document written by the AI all agree.
 */

/** The layouts that arrange any number of screens. */
export const compositionLayoutSchema = z.enum(['side-by-side', 'stack', 'grid', 'bento', 'fan'])
/** A composition layout id. */
export type CompositionLayoutId = z.infer<typeof compositionLayoutSchema>

/** Names and descriptions, for the layout picker. */
export const COMPOSITION_LAYOUTS: Record<
  CompositionLayoutId,
  { description: string; name: string }
> = {
  bento: { description: 'One large screen beside a grid of smaller ones.', name: 'Bento' },
  fan: { description: 'Screens fanned out and overlapping.', name: 'Fan' },
  grid: { description: 'Equal cells in rows and columns.', name: 'Grid' },
  'side-by-side': { description: 'One row, every screen the same height.', name: 'Side by side' },
  stack: { description: 'One column, every screen the same width.', name: 'Stack' },
}

/** Where one screen goes: its centre and width as canvas fractions, and its rotation. */
export type LayoutSlot = { rotation: number; size: number; x: number; y: number }

type Cell = { height: number; width: number; x: number; y: number }

/** Margin around the composition and gap between screens, as fractions of the canvas's shorter side. */
const MARGIN = 0.08
const GAP = 0.035
const MIN_SIZE = 0.05
/** In a bento, every other screen shows at most this share of the first screen's area. */
const HERO_LEAD = 0.6

function fit(aspect: number, cell: Cell) {
  const width = Math.min(cell.width, cell.height * aspect)
  return { height: width / aspect, width }
}

/** Rows (or columns) of equal cells inside a region. */
function cells(region: Cell, count: number, columns: number, gap: number): Cell[] {
  const rows = Math.ceil(count / columns)
  const width = (region.width - (columns - 1) * gap) / columns
  const height = (region.height - (rows - 1) * gap) / rows
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const inRow = row === rows - 1 ? count - row * columns : columns
    const column = index % columns
    // A short last row is centred.
    const offset = ((columns - inRow) * (width + gap)) / 2
    return {
      height,
      width,
      x: region.x + offset + column * (width + gap),
      y: region.y + row * (height + gap),
    }
  })
}

function fittedArea(aspects: readonly number[], regions: readonly Cell[]) {
  return aspects.reduce((total, aspect, index) => {
    const box = fit(aspect, regions[index]!)
    return total + box.width * box.height
  }, 0)
}

/** The column count whose cells hold the most screen area. */
function bestColumns(aspects: readonly number[], region: Cell, gap: number): number {
  let best = 1
  let bestArea = -1
  for (let columns = 1; columns <= aspects.length; columns++) {
    const area = fittedArea(aspects, cells(region, aspects.length, columns, gap))
    if (area > bestArea + 1e-9) {
      best = columns
      bestArea = area
    }
  }
  return best
}

function bentoCells(
  aspects: readonly number[],
  area: Cell,
  gap: number,
  landscape: boolean
): Cell[] {
  const rest = aspects.length - 1
  const lines = rest <= 3 ? 1 : 2
  const columns = landscape ? lines : Math.ceil(rest / lines)
  const candidates = [0.5, 0.58, 0.66, 0.74].map((share) => {
    const hero: Cell = landscape
      ? { ...area, width: area.width * share - gap / 2 }
      : { ...area, height: area.height * share - gap / 2 }
    const others: Cell = landscape
      ? {
          ...area,
          width: area.width * (1 - share) - gap / 2,
          x: area.x + area.width * share + gap / 2,
        }
      : {
          ...area,
          height: area.height * (1 - share) - gap / 2,
          y: area.y + area.height * share + gap / 2,
        }
    const regions = [hero, ...cells(others, rest, columns, gap)]
    const areas = aspects.map((aspect, index) => {
      const box = fit(aspect, regions[index]!)
      return box.width * box.height
    })
    return {
      heroLeads: areas.every((value, index) => index === 0 || value <= areas[0]! * HERO_LEAD),
      regions,
      total: areas.reduce((sum, value) => sum + value, 0),
    }
  })
  // The split that shows the most screen while the first screen stays the largest.
  const leading = candidates.filter((candidate) => candidate.heroLeads)
  const pool = leading.length > 0 ? leading : candidates.slice(-1)
  return pool.reduce((best, candidate) => (candidate.total > best.total + 1e-9 ? candidate : best))
    .regions
}

/**
 * Arrange screens of the given box aspects (width / height) on a canvas of
 * `canvasAspect`. Returns one slot per screen, in the same order.
 */
export function layoutScreens(
  layout: CompositionLayoutId,
  aspects: readonly number[],
  canvasAspect: number
): LayoutSlot[] {
  const count = aspects.length
  if (count === 0) return []
  // Work in canvas units: the canvas is canvasAspect wide and 1 tall.
  const canvasW = canvasAspect
  const short = Math.min(canvasW, 1)
  const margin = MARGIN * short
  const gap = GAP * short
  const area: Cell = { height: 1 - 2 * margin, width: canvasW - 2 * margin, x: margin, y: margin }
  const slot = (centerX: number, centerY: number, width: number, rotation = 0): LayoutSlot => ({
    rotation,
    size: Math.min(1, Math.max(MIN_SIZE, width / canvasW)),
    x: centerX / canvasW,
    y: centerY,
  })
  const inCells = (regions: readonly Cell[]) =>
    aspects.map((aspect, index) => {
      const cell = regions[index]!
      const box = fit(aspect, cell)
      return slot(cell.x + cell.width / 2, cell.y + cell.height / 2, box.width)
    })

  switch (layout) {
    case 'side-by-side': {
      const sum = aspects.reduce((total, aspect) => total + aspect, 0)
      const height = Math.min(area.height, (area.width - (count - 1) * gap) / sum)
      const total = sum * height + (count - 1) * gap
      let left = area.x + (area.width - total) / 2
      return aspects.map((aspect) => {
        const width = aspect * height
        const placed = slot(left + width / 2, 0.5, width)
        left += width + gap
        return placed
      })
    }
    case 'stack': {
      const sum = aspects.reduce((total, aspect) => total + 1 / aspect, 0)
      const width = Math.min(area.width, (area.height - (count - 1) * gap) / sum)
      const total = sum * width + (count - 1) * gap
      let top = area.y + (area.height - total) / 2
      return aspects.map((aspect) => {
        const height = width / aspect
        const placed = slot(canvasW / 2, top + height / 2, width)
        top += height + gap
        return placed
      })
    }
    case 'grid':
      return inCells(cells(area, count, bestColumns(aspects, area, gap), gap))
    case 'bento':
      return count === 1 ? inCells([area]) : inCells(bentoCells(aspects, area, gap, canvasW >= 1))
    case 'fan': {
      const mean = aspects.reduce((total, aspect) => total + aspect, 0) / count
      const widest = Math.max(...aspects)
      const spread = 0.5 * mean
      const height = Math.min(
        area.height * 0.8,
        (area.width * 0.95) / ((count - 1) * spread + widest)
      )
      const step = count > 1 ? Math.min(12, 30 / (count - 1)) : 0
      return aspects.map((aspect, index) => {
        const offset = index - (count - 1) / 2
        return slot(
          canvasW / 2 + offset * spread * height,
          0.5 + Math.abs(offset) * height * 0.05,
          aspect * height,
          Math.round(offset * step * 10) / 10
        )
      })
    }
  }
}
