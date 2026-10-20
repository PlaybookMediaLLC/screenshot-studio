import assert from 'node:assert/strict'
import test from 'node:test'
import {
  artboardRect,
  boundsOf,
  canvasDocumentSchema,
  emptyCanvasDocument,
  readCanvasDocument,
  sizedDesignDocument,
  type CanvasDocument,
} from '@/lib/canvas/document'
import {
  clampZoom,
  fitRect,
  intersects,
  previewWidthFor,
  rectToScreen,
  screenToWorld,
  steppedZoom,
  visibleWorldRect,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
  ZOOM_LIMITS,
} from '@/lib/canvas/viewport'
import {
  alignRects,
  distributeRects,
  hitTest,
  marqueeSelect,
  nextArtboardPosition,
  readingOrder,
  snapMove,
  tidyRects,
} from '@/lib/canvas/layout'
import { applyCanvasCommand } from '@/lib/canvas/commands'
import { blankArtboard } from '@/lib/canvas/recipes'
import { documentCanvasSize } from '@/lib/export/adapt'

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} ≉ ${expected}`)

function ids(prefix = 'id') {
  let next = 0
  return () => `${prefix}-${++next}`
}

function canvasWith(...sizes: { width: number; height: number }[]): CanvasDocument {
  const newId = ids('board')
  let x = 0
  const artboards = sizes.map((size) => {
    const artboard = blankArtboard(size, { x, y: 0, newId })
    x += size.width + 100
    return artboard
  })
  return canvasDocumentSchema.parse({ version: 1, kind: 'canvas', artboards })
}

test('screen and workspace coordinates convert both ways at any zoom and pan', () => {
  const viewport = { panX: 120, panY: -40, zoom: 0.25 }
  const point = { x: 1600, y: 900 }
  const screen = worldToScreen(viewport, point)
  assert.deepEqual(screen, { x: 520, y: 185 })
  assert.deepEqual(screenToWorld(viewport, screen), point)
  assert.deepEqual(rectToScreen(viewport, { x: 0, y: 0, width: 1600, height: 900 }), {
    x: 120,
    y: -40,
    width: 400,
    height: 225,
  })
})

test('zooming keeps the workspace point under the pointer fixed and respects limits', () => {
  const viewport = { panX: 33, panY: 71, zoom: 0.5 }
  const anchor = { x: 400, y: 300 }
  const before = screenToWorld(viewport, anchor)
  const zoomed = zoomAt(viewport, anchor, 1.7)
  const after = screenToWorld(zoomed, anchor)
  close(after.x, before.x)
  close(after.y, before.y)
  assert.equal(zoomAt(viewport, anchor, 99).zoom, ZOOM_LIMITS.max)
  assert.equal(clampZoom(0), ZOOM_LIMITS.min)
  assert.ok(wheelZoomFactor(-10) > 1 && wheelZoomFactor(10) < 1, 'wheel up zooms in')
  close(wheelZoomFactor(10) * wheelZoomFactor(-10), 1, 'opposite wheel steps cancel out')
  assert.equal(steppedZoom(1, 1), 1.5)
  assert.equal(steppedZoom(1, -1), 0.75)
  assert.equal(steppedZoom(0.6, -1), 0.5)
})

test('fit shows a rectangle centred with padding, never closer than the cap', () => {
  const screen = { width: 1000, height: 800 }
  const rect = { x: 2000, y: 1000, width: 3200, height: 900 }
  const fitted = fitRect(rect, screen, { padding: 100 })
  close(fitted.zoom, 800 / 3200)
  const centre = worldToScreen(fitted, { x: 3600, y: 1450 })
  close(centre.x, 500)
  close(centre.y, 400)
  assert.equal(fitRect({ x: 0, y: 0, width: 10, height: 10 }, screen).zoom, 1)
  assert.equal(fitRect({ x: 0, y: 0, width: 10, height: 10 }, screen, { maxZoom: 2 }).zoom, 2)
})

test('culling keeps only artboards near the visible area', () => {
  const viewport = { panX: 0, panY: 0, zoom: 0.5 }
  const visible = visibleWorldRect(viewport, { width: 800, height: 600 }, 100)
  assert.deepEqual(visible, { x: -200, y: -200, width: 2000, height: 1600 })
  assert.ok(intersects(visible, { x: 1700, y: 0, width: 100, height: 100 }))
  assert.ok(!intersects(visible, { x: 1801, y: 0, width: 100, height: 100 }))
  assert.equal(previewWidthFor(300), 320)
  assert.equal(previewWidthFor(500, 2), 1280)
  assert.equal(previewWidthFor(5000, 2), 2048)
})

test('artboards align, distribute and tidy without changing their sizes', () => {
  const items = [
    { id: 'a', rect: { x: 0, y: 40, width: 100, height: 50 } },
    { id: 'b', rect: { x: 300, y: 0, width: 200, height: 100 } },
    { id: 'c', rect: { x: 1000, y: 70, width: 100, height: 100 } },
  ]
  assert.deepEqual(
    alignRects(items, 'top').map((p) => p.y),
    [0, 0, 0]
  )
  assert.deepEqual(
    alignRects(items, 'right').map((p) => p.x),
    [1000, 900, 1000]
  )
  assert.deepEqual(
    alignRects(items, 'middle').map((p) => p.y),
    [60, 35, 35]
  )
  assert.deepEqual(
    alignRects(items.slice(0, 1), 'left'),
    [],
    'one artboard has nothing to align to'
  )
  const spread = distributeRects(items, 'horizontal')
  assert.deepEqual(
    spread.map((p) => p.x),
    [0, 450, 1000],
    'gaps between neighbours are equal and the ends stay put'
  )
  assert.deepEqual(distributeRects(items.slice(0, 2), 'vertical'), [])
  const tidy = tidyRects(items, { gap: 10, columns: 2 })
  assert.deepEqual(
    tidy,
    [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 110, y: 0 },
      { id: 'c', x: 0, y: 110 },
    ],
    'a and b share a row (they overlap vertically); rows are as tall as their tallest artboard'
  )
})

test('reading order groups artboards into rows, then left to right', () => {
  const order = readingOrder([
    { id: 'row2-left', rect: { x: 0, y: 1000, width: 100, height: 100 } },
    { id: 'row1-right', rect: { x: 500, y: 20, width: 100, height: 100 } },
    { id: 'row1-left', rect: { x: 0, y: 0, width: 100, height: 100 } },
  ])
  assert.deepEqual(
    order.map((item) => item.id),
    ['row1-left', 'row1-right', 'row2-left']
  )
})

test('moving artboards snap to neighbours first and the grid second', () => {
  const others = [{ x: 0, y: 0, width: 1000, height: 500 }]
  const near = snapMove({ x: 1004, y: 7, width: 300, height: 300 }, others, 10)
  assert.equal(near.dx, -4, 'left edge snaps to the neighbour right edge')
  assert.equal(near.dy, -7, 'top edge snaps to the neighbour top edge')
  assert.deepEqual(
    near.guides.map((guide) => guide.axis),
    ['x', 'y']
  )
  const centred = snapMove({ x: 352, y: 900, width: 300, height: 100 }, others, 5)
  assert.equal(centred.dx, -2, 'centres line up')
  const gridded = snapMove({ x: 1203, y: 912, width: 300, height: 100 }, others, 5, 8)
  assert.deepEqual([gridded.dx, gridded.dy], [-3, 0])
  assert.deepEqual(gridded.guides, [])
})

test('hit testing, marquee selection and placement use workspace rectangles', () => {
  const items = [
    { id: 'under', rect: { x: 0, y: 0, width: 500, height: 500 } },
    { id: 'over', rect: { x: 100, y: 100, width: 100, height: 100 } },
  ]
  assert.equal(hitTest(items, { x: 150, y: 150 }), 'over')
  assert.equal(hitTest(items, { x: 50, y: 50 }), 'under')
  assert.equal(hitTest(items, { x: 600, y: 50 }), null)
  assert.deepEqual(marqueeSelect(items, { x: 450, y: 450, width: 10, height: 10 }), ['under'])
  assert.deepEqual(nextArtboardPosition([]), { x: 0, y: 0 })
  assert.deepEqual(nextArtboardPosition(items.map((item) => item.rect)), { x: 620, y: 0 })
  assert.deepEqual(boundsOf(items.map((item) => item.rect)), {
    x: 0,
    y: 0,
    width: 500,
    height: 500,
  })
})

test('an artboard position never changes its native document or export size', () => {
  const canvas = canvasWith({ width: 1600, height: 900 })
  const before = canvas.artboards[0]!
  const moved = applyCanvasCommand(canvas, {
    type: 'move-artboards',
    positions: [{ id: before.id, x: -12_345, y: 67_890 }],
  })
  const after = moved.artboards[0]!
  assert.deepEqual(after.document, before.document)
  assert.deepEqual(artboardRect(after), { x: -12_345, y: 67_890, width: 1600, height: 900 })
  assert.equal(canvas.artboards[0]!.x, 0, 'commands never mutate their input')
})

test('commands add, rename, duplicate, stack, resize and remove artboards deterministically', () => {
  let canvas = canvasWith({ width: 1600, height: 900 }, { width: 1080, height: 1080 })
  const [first, second] = canvas.artboards
  canvas = applyCanvasCommand(canvas, {
    type: 'rename-artboard',
    id: first!.id,
    name: '  Launch  ',
  })
  assert.equal(canvas.artboards[0]!.name, 'Launch')
  const command = {
    type: 'duplicate-artboards' as const,
    copies: [{ sourceId: first!.id, id: 'copy-1', name: 'Launch copy', x: 0, y: 1100 }],
  }
  const duplicated = applyCanvasCommand(canvas, command)
  assert.deepEqual(applyCanvasCommand(canvas, command), duplicated, 'same input, same result')
  const copy = duplicated.artboards.at(-1)!
  assert.equal(copy.id, 'copy-1')
  assert.deepEqual(copy.document, first!.document)
  assert.throws(
    () => applyCanvasCommand(duplicated, command),
    /unique/,
    'a second copy with the same id is refused'
  )
  const stacked = applyCanvasCommand(duplicated, {
    type: 'stack-artboards',
    ids: [first!.id],
    move: 'front',
  })
  assert.equal(stacked.artboards.at(-1)!.id, first!.id)
  const resized = applyCanvasCommand(stacked, {
    type: 'resize-artboard',
    id: second!.id,
    width: 1080,
    height: 1920,
  })
  const target = resized.artboards.find((artboard) => artboard.id === second!.id)!
  assert.deepEqual(documentCanvasSize(target.document), { width: 1080, height: 1920 })
  assert.equal(
    target.document.texts.length,
    second!.document.texts.length,
    'layers are laid out again, not dropped'
  )
  const removed = applyCanvasCommand(resized, {
    type: 'remove-artboards',
    ids: [first!.id, 'copy-1'],
  })
  assert.deepEqual(
    removed.artboards.map((artboard) => artboard.id),
    [second!.id]
  )
  assert.throws(
    () => applyCanvasCommand(removed, { type: 'rename-artboard', id: first!.id, name: 'Gone' }),
    /no longer on this canvas/
  )
})

test('canvas documents are versioned and reject what this app cannot read', () => {
  const empty = emptyCanvasDocument()
  assert.deepEqual(empty, {
    version: 1,
    kind: 'canvas',
    artboards: [],
    context: {},
    deliveries: [],
    components: [],
  })
  assert.equal(readCanvasDocument({ version: 2, kind: 'canvas', artboards: [] }), null)
  assert.equal(readCanvasDocument({ version: 1, kind: 'story-set', artboards: [] }), null)
  const document = sizedDesignDocument({ width: 1200.4, height: 630 })
  assert.deepEqual(documentCanvasSize(document), { width: 1200, height: 630 })
  assert.throws(() =>
    canvasDocumentSchema.parse({
      version: 1,
      kind: 'canvas',
      artboards: [{ id: 'a', name: 'A', x: 2e6, y: 0, document }],
    })
  )
})
