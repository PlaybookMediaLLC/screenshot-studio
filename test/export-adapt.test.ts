import assert from 'node:assert/strict'
import test from 'node:test'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import {
  adaptDocumentToSize,
  documentCanvasSize,
  SAFE_MARGIN,
  screenshotBox,
  TEXT_SCALE_LIMITS,
  type FractionBox,
} from '@/lib/export/adapt'

const landscape = { height: 1080, width: 1920 }
const story = { height: 1920, width: 1080 }

function baseDocument(): DesignDocument {
  return designDocumentSchema.parse({
    annotations: [{ end: { x: 0.55, y: 0.5 }, start: { x: 0.45, y: 0.45 }, type: 'arrow' }],
    canvas: { aspectRatio: 'custom', padding: 40, size: landscape },
    elements: [
      {
        height: 0.07,
        id: 'badge-1',
        props: {
          background: '#ef4444',
          borderColor: '#ffffff',
          borderWidth: 3,
          color: '#ffffff',
          fontScale: 0.55,
          number: 1,
          numbering: 'numeric',
          shadow: { blur: 0, color: '#000000', enabled: false, offsetX: 0, offsetY: 0 },
          shape: 'circle',
        },
        type: 'badge',
        width: 0.07 / (16 / 9),
        x: 0.95,
        y: 0.1,
      },
    ],
    image: { scale: 80, src: null },
    overlays: [{ position: { x: 0.9, y: 0.85 }, size: 0.15, src: '/overlays/arrow/arrow-1.png' }],
    redactions: [{ position: { x: 0.45, y: 0.45 }, size: { height: 0.1, width: 0.1 } }],
    texts: [{ fontSize: 0.05, position: { x: 50, y: 8 }, text: 'Ship faster with every release' }],
    version: 2,
  })
}

/** A point's place on a box, as fractions of the box. */
function onBox(point: { x: number; y: number }, box: FractionBox) {
  return { u: (point.x - box.cx) / box.width, v: (point.y - box.cy) / box.height }
}

const near = (actual: number, expected: number, label: string, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} != ${expected}`)

test('documentCanvasSize reads custom sizes and preset ids', () => {
  assert.deepEqual(documentCanvasSize(baseDocument()), landscape)
  const preset = designDocumentSchema.parse({
    canvas: { aspectRatio: '1_1' },
    image: { src: null },
    version: 2,
  })
  assert.deepEqual(documentCanvasSize(preset), { height: 1080, width: 1080 })
})

test('screenshotBox is the stage geometry: padding, double-applied scale, and centring', () => {
  const plain = designDocumentSchema.parse({
    canvas: { aspectRatio: 'custom', padding: 0, size: landscape },
    image: { src: null },
    version: 2,
  })
  const full = screenshotBox(plain, landscape, 16 / 9)!
  near(full.width, 1, 'full width')
  near(full.height, 1, 'full height')
  near(full.cx, 0.5, 'centre x')
  // The stage scales the fitted image by the layer's scale and again by its transform.
  const half = screenshotBox({ ...plain, image: { ...plain.image, scale: 50 } }, landscape, 16 / 9)!
  near(half.width, 0.25, 'scaled width')
  near(half.cy, 0.5, 'centre y')
  assert.equal(screenshotBox(plain, landscape, undefined), null)
})

test('adapting to the same size changes only the canvas', () => {
  const document = baseDocument()
  const adapted = adaptDocumentToSize(document, landscape, { imageAspect: 1.6 })
  assert.deepEqual(adapted.canvas, { ...document.canvas, aspectRatio: 'custom', size: landscape })
  assert.deepEqual(adapted.texts, document.texts)
  assert.deepEqual(adapted.elements, document.elements)
  assert.deepEqual(adapted.redactions, document.redactions)
})

test('a story keeps the headline readable and inside the margins', () => {
  const adapted = adaptDocumentToSize(baseDocument(), story)
  assert.deepEqual(adapted.canvas?.size, story)
  const [text] = adapted.texts
  assert.ok(text)
  const px = text.fontSize * story.width
  // The shorter side did not change, so the type would keep its 96px size,
  // but the line is too long for a 1080px width and shrinks to fit it.
  assert.ok(px < 0.05 * landscape.width, `font ${px}px should shrink to fit`)
  const lineWidth = text.text.length * 0.55 * px
  assert.ok(lineWidth <= story.width * (1 - SAFE_MARGIN * 2) + 1, 'line fits the width')
  assert.ok(
    text.position.y / 100 - (1.2 * px) / 2 / story.height >= SAFE_MARGIN - 1e-9,
    'below the top margin'
  )
})

test('text scale follows the shorter side and is clamped', () => {
  const document = designDocumentSchema.parse({
    ...baseDocument(),
    texts: [{ fontSize: 0.02, position: { x: 50, y: 50 }, text: 'Hi' }],
  })
  const half = adaptDocumentToSize(document, { height: 540, width: 960 })
  near(
    half.texts[0]!.fontSize * 960,
    0.02 * 1920 * TEXT_SCALE_LIMITS.min,
    'clamped at the minimum',
    0.01
  )
  const huge = adaptDocumentToSize(document, { height: 4096, width: 4096 })
  near(
    huge.texts[0]!.fontSize * 4096,
    0.02 * 1920 * TEXT_SCALE_LIMITS.max,
    'clamped at the maximum',
    0.01
  )
})

test('a wrapping text box wraps instead of shrinking', () => {
  const document = designDocumentSchema.parse({
    ...baseDocument(),
    texts: [
      {
        fontSize: 0.05,
        maxWidth: 0.8,
        position: { x: 50, y: 50 },
        text: 'Ship faster with every release',
      },
    ],
  })
  const adapted = adaptDocumentToSize(document, story)
  // Same shorter side, so the type keeps its pixel size and the box wraps it.
  near(adapted.texts[0]!.fontSize * story.width, 0.05 * landscape.width, 'font px kept', 0.01)
})

test('a wrapping box never ends up narrower than its longest word', () => {
  const wide = { height: 900, width: 1600 }
  const square = { height: 1080, width: 1080 }
  const document = designDocumentSchema.parse({
    ...baseDocument(),
    canvas: { aspectRatio: 'custom', size: wide },
    texts: [
      { fontSize: 0.048, maxWidth: 0.35, position: { x: 24, y: 35 }, text: 'Bulk approvals' },
    ],
  })
  const [text] = adaptDocumentToSize(document, square).texts
  assert.ok(text)
  const word = 'approvals'.length * 0.55 * 1.15 * text.fontSize * square.width
  assert.ok(word <= 0.35 * square.width + 1e-6, 'the longest word fits its box')
  const [unchanged] = adaptDocumentToSize(
    designDocumentSchema.parse({ ...document, texts: [{ ...document.texts[0]!, maxWidth: 0.9 }] }),
    square
  ).texts
  near(
    unchanged!.fontSize * square.width,
    0.048 * wide.width * 1.2,
    'a roomy box keeps the scaled size',
    0.01
  )
})

test('free elements keep their pixel proportions and stay inside the margins', () => {
  const adapted = adaptDocumentToSize(baseDocument(), story)
  const [badge] = adapted.elements
  assert.ok(badge)
  assert.ok(
    Math.abs(badge.width * story.width - badge.height * story.height) < 0.5,
    'a square badge stays square'
  )
  assert.ok(badge.x + badge.width / 2 <= 1 - SAFE_MARGIN + 1e-9, 'pulled inside the right margin')
  const [overlay] = adapted.overlays
  assert.ok(overlay && overlay.size <= 0.15, 'a sticker never grows past the canvas')
})

test('layers on the screenshot follow it to the new layout', () => {
  const aspect = 16 / 10
  const document = baseDocument()
  const adapted = adaptDocumentToSize(document, story, { imageAspect: aspect })
  const before = screenshotBox(document, landscape, aspect)!
  const after = screenshotBox(adapted, story, aspect)!
  const start = onBox(document.annotations[0]!.start, before)
  const moved = onBox(adapted.annotations[0]!.start, after)
  near(moved.u, start.u, 'u')
  near(moved.v, start.v, 'v')
  // The screenshot is a different share of a portrait canvas, so the point really moved.
  assert.notDeepEqual(adapted.annotations[0]!.start, document.annotations[0]!.start)
})

test('a style applied to another screenshot moves only what sits on the screenshot', () => {
  const document = baseDocument()
  const adapted = adaptDocumentToSize(document, landscape, {
    imageAspect: 0.5,
    sourceImageAspect: 16 / 10,
  })
  assert.deepEqual(adapted.texts, document.texts)
  assert.deepEqual(adapted.overlays, document.overlays)
  const before = screenshotBox(document, landscape, 16 / 10)!
  const after = screenshotBox(document, landscape, 0.5)!
  const start = onBox(document.annotations[0]!.start, before)
  const moved = onBox(adapted.annotations[0]!.start, after)
  near(moved.u, start.u, 'u')
  near(moved.v, start.v, 'v')
})

test('a blur region still covers what it hid, with a safety pad', () => {
  const aspect = 16 / 10
  const document = baseDocument()
  const adapted = adaptDocumentToSize(document, story, { imageAspect: aspect })
  const before = screenshotBox(document, landscape, aspect)!
  const after = screenshotBox(adapted, story, aspect)!
  const region = document.redactions[0]!
  const moved = adapted.redactions[0]!
  const hidden = {
    bottom: onBox({ x: 0, y: region.position.y + region.size.height }, before).v,
    left: onBox({ x: region.position.x, y: 0 }, before).u,
    right: onBox({ x: region.position.x + region.size.width, y: 0 }, before).u,
    top: onBox({ x: 0, y: region.position.y }, before).v,
  }
  const covers = {
    bottom: onBox({ x: 0, y: moved.position.y + moved.size.height }, after).v,
    left: onBox({ x: moved.position.x, y: 0 }, after).u,
    right: onBox({ x: moved.position.x + moved.size.width, y: 0 }, after).u,
    top: onBox({ x: 0, y: moved.position.y }, after).v,
  }
  assert.ok(covers.left < hidden.left && covers.top < hidden.top)
  assert.ok(covers.right > hidden.right && covers.bottom > hidden.bottom)
})

test('a blur region on the edge stays on the edge', () => {
  const document = designDocumentSchema.parse({
    ...baseDocument(),
    redactions: [
      { position: { x: 0, y: 0 }, size: { height: 0.05, width: 0.05 } },
      { position: { x: 0.9, y: 0.95 }, size: { height: 0.05, width: 0.1 } },
    ],
  })
  const adapted = adaptDocumentToSize(document, story)
  const [corner, bottomRight] = adapted.redactions
  assert.deepEqual(corner!.position, { x: 0, y: 0 })
  near(bottomRight!.position.x + bottomRight!.size.width, 1, 'right edge')
  near(bottomRight!.position.y + bottomRight!.size.height, 1, 'bottom edge')
})

test('devices keep their centre and shape, and layers on a device follow it', () => {
  const document = designDocumentSchema.parse({
    ...baseDocument(),
    annotations: [{ end: { x: 0.52, y: 0.55 }, start: { x: 0.5, y: 0.5 }, type: 'arrow' }],
    devices: {
      mockups: [{ definitionId: 'iphone-17-pro-front', position: { x: 0.5, y: 0.5 }, size: 0.3 }],
    },
    mode: 'device',
  })
  const adapted = adaptDocumentToSize(document, story)
  const device = adapted.devices!.mockups[0]!
  assert.deepEqual(device.position, { x: 0.5, y: 0.5 })
  // The phone is 0.3 × 1920 = 576px wide; contain = 0.5625 makes it 324px of 1080.
  near(device.size * story.width, 576 * 0.5625, 'device width px', 0.5)
  const deviceHeight = (device.size * story.width) / 0.485446
  assert.ok(deviceHeight <= story.height, 'the device still fits')
  // The arrow starts at the device centre and stays there.
  near(adapted.annotations[0]!.start.x, 0.5, 'start x')
  near(adapted.annotations[0]!.start.y, 0.5, 'start y')
})

test('every adapted document is valid', () => {
  for (const target of [
    story,
    { height: 627, width: 1200 },
    { height: 2796, width: 1290 },
    { height: 16, width: 8192 },
  ]) {
    const adapted = adaptDocumentToSize(baseDocument(), target, { imageAspect: 1.5 })
    assert.doesNotThrow(() => designDocumentSchema.parse(adapted))
  }
})
