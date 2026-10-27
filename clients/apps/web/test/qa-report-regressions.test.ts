import assert from 'node:assert/strict'
import test from 'node:test'
import { slidePreviewDocument } from '../lib/design/slide-preview'
import { designDocumentSchema } from '../lib/design/document'
import { exportDesignDocument } from '../lib/design/export'
import { applyDesignDocument, applyDesignLayout } from '../lib/design/apply'
import { createElement } from '../lib/editor/elements/schema'
import { detectSensitiveText } from '../lib/redaction/patterns'
import { normalizeMentions } from '../lib/write/normalize-mentions'
import { serializeDraft } from '../lib/content-drafts/serialize'
import { createDeviceScreen, createMockup } from '../lib/device-mockups/layouts'
import { useImageStore } from '../lib/store'
import { arrangeScreens } from '../lib/frames/arrange'
import { replaceScreenshotEverywhere } from '../lib/redaction/apply'

function reset() {
  useImageStore.setState(useImageStore.getInitialState(), true)
  useImageStore.temporal.getState().clear()
}

test('OCR fragments of a credential redact the prefix and suffix as one region', () => {
  const words = ['sk_test_', '51HxQaZ0000fakekeyABCDEFG123456'].map((text, index) => ({
    text,
    line: 0,
    confidence: 45,
    bbox: { x0: 10 + index * 85, x1: 90 + index * 85, y0: 10, y1: 30 },
  }))
  const found = detectSensitiveText(words, { width: 400, height: 100 })
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'credential')
  assert.ok(found[0].box.x <= 10 / 400)
  assert.ok(found[0].box.x + found[0].box.width >= 175 / 400)
})

test('unresolved handles survive serialization and reopening, including children-only inputs', () => {
  for (const mention of [
    { type: 'mention_input', trigger: '@', value: 'someone ', children: [{ text: '' }] },
    { type: 'mention_input', trigger: '@', children: [{ text: 'someone ' }] },
  ]) {
    const body = [{ type: 'p', children: [{ text: '#qa ' }, mention] }]
    const saved = normalizeMentions(body)
    assert.equal(serializeDraft(saved, 'x').caption, '#qa @someone')
    assert.equal(serializeDraft(body, 'x').caption, '#qa @someone')
    assert.deepEqual(normalizeMentions(saved), saved)
    assert.equal(mention.type, 'mention_input')
  }
})

test('selecting slides updates the primary frame, preserves custom screens, and redaction survives layout reset', () => {
  reset()
  const state = useImageStore.getState()
  state.addImages(['one', 'two'].map((name) => new File(['image'], name, { type: 'image/png' })))
  const slides = useImageStore.getState().slides
  const screens = [
    createMockup('iphone-17-pro-front', createDeviceScreen(slides[0].src, 'one')),
    createMockup('iphone-17-pro-front', createDeviceScreen('custom.png', 'custom', true), 1),
  ]
  useImageStore.setState({ mockups: screens, deviceLayoutSnapshot: screens, editorMode: 'device' })
  state.setActiveSlide(slides[1].id)
  assert.equal(useImageStore.getState().mockups[0].screen.src, slides[1].src)
  assert.equal(useImageStore.getState().mockups[1].screen.src, 'custom.png')
  useImageStore.setState({
    mockups: screens.map((screen, index) => ({
      ...screen,
      screen: { ...screen.screen, src: `separate-${index}.png`, isCustom: true },
    })),
  })
  state.setActiveSlide(slides[1].id)
  assert.equal(useImageStore.getState().mockups[0].screen.src, slides[1].src)
  assert.equal(useImageStore.getState().mockups[1].screen.src, 'separate-1.png')
  state.setActiveSlide(slides[0].id)
  replaceScreenshotEverywhere(slides[0].src, 'redacted.png')
  assert.equal(useImageStore.getState().deviceLayoutSnapshot?.[0].screen.src, 'redacted.png')
  assert.equal(useImageStore.getState().slides[0].src, 'redacted.png')
  slides.forEach((slide) => URL.revokeObjectURL(slide.src))
  reset()
})

test('aspect changes preserve element aspect and reflow screens in one undo step', () => {
  reset()
  const state = useImageStore.getState()
  state.setAspectRatio('9_16')
  const screens = Array.from({ length: 6 }, (_, index) =>
    createMockup(
      'iphone-17-pro-front',
      createDeviceScreen(`screen-${index}.png`, 'screen', true),
      index
    )
  )
  useImageStore.setState({
    mockups: arrangeScreens(screens, 'grid', 9 / 16),
    activeDeviceLayoutId: 'grid',
  })
  state.addElement(createElement('badge', { aspect: 9 / 16, id: 'badge' }))
  const before = useImageStore.getState()
  useImageStore.temporal.getState().clear()
  state.setAspectRatio('16_9')
  const after = useImageStore.getState()
  assert.equal(after.elements[0].width, before.elements[0].width)
  assert.ok(
    Math.abs(after.elements[0].height / (16 / 9) - before.elements[0].height / (9 / 16)) < 1e-9
  )
  assert.deepEqual(after.mockups, arrangeScreens(before.mockups, 'grid', 16 / 9))
  useImageStore.temporal.getState().undo()
  assert.deepEqual(useImageStore.getState().elements, before.elements)
  assert.deepEqual(useImageStore.getState().mockups, before.mockups)
  reset()
})

test('new documents reset project-owned settings and invalid legacy durations do not reach new slides', () => {
  reset()
  const state = useImageStore.getState()
  state.setBrowserUrl('private.example/dashboard')
  state.setFrameChrome({ address: 'private.example' })
  useImageStore.setState({ slideshow: { ...state.slideshow, defaultDuration: 50 } })
  state.addImages([new File(['image'], 'image.png', { type: 'image/png' })])
  assert.equal(useImageStore.getState().slides[0].duration, 3)
  URL.revokeObjectURL(useImageStore.getState().slides[0].src)
  state.clearImage()
  assert.equal(useImageStore.getState().browserUrl, useImageStore.getInitialState().browserUrl)
  assert.deepEqual(
    useImageStore.getState().frameChrome,
    useImageStore.getInitialState().frameChrome
  )
  assert.equal(useImageStore.getState().slideshow.defaultDuration, 2)
  reset()
})

test('text stacking survives saving and reopening a project', () => {
  reset()
  const state = useImageStore.getState()
  const id = state.addTextOverlay()
  state.updateTextOverlay(id, { zIndex: 19 })
  state.setImagePlacement({ anchor: 'tl', offsetX: -100, offsetY: -100 })
  const document = exportDesignDocument({ keepLocalSources: true })
  assert.equal(document.texts[0].zIndex, 19)
  state.clearImage()
  applyDesignDocument(document, (src) => src)
  applyDesignLayout(document, (src) => src, { canvasW: 800, canvasH: 600 })
  assert.equal(useImageStore.getState().textOverlays[0].zIndex, 19)
  assert.equal(useImageStore.getState().imagePlacement.anchor, 'tl')
  useImageStore.getState().setImagePlacement({ offsetX: 20 })
  assert.equal(useImageStore.getState().imagePlacement.anchor, undefined)
  reset()
})

test('slide thumbnails render the composition with the selected slide and preserve secondary screens', () => {
  const document = designDocumentSchema.parse({
    version: 2,
    image: { src: '/original.png' },
    devices: {
      mockups: [
        {
          definitionId: 'iphone-17-pro-front',
          position: { x: 0.3, y: 0.5 },
          size: 0.3,
          screen: { src: '/separate.png' },
        },
        {
          definitionId: 'iphone-17-pro-front',
          position: { x: 0.7, y: 0.5 },
          size: 0.3,
          screen: { src: '/secondary.png' },
        },
      ],
    },
  })
  const preview = slidePreviewDocument(document, '/next.png')
  assert.equal(preview.image.src, '/next.png')
  assert.equal(preview.devices?.mockups[0].screen.src, null)
  assert.equal(preview.devices?.mockups[1].screen.src, '/secondary.png')
  assert.equal(document.devices?.mockups[0].screen.src, '/separate.png')
})

test('shared layer order interleaves types, inserts on top, and survives export and undo', async () => {
  const { orderedLayerIds, moveLayer } = await import('../lib/editor/layer-order')
  reset()
  const state = useImageStore.getState()
  const screen = createMockup('iphone-17-pro-front', createDeviceScreen('/test.png', 'phone'))
  state.addMockup(screen)
  const textId = state.addTextOverlay()
  const badge = createElement('badge', { aspect: 1, id: 'ordered-badge' })
  state.addElement(badge)
  const before = orderedLayerIds(useImageStore.getState())
  assert.equal(before.at(-1), badge.id)
  useImageStore.setState({ layerOrder: moveLayer(before, textId, 'up') })
  assert.equal(orderedLayerIds(useImageStore.getState()).at(-1), textId)
  const document = exportDesignDocument({ keepLocalSources: true })
  assert.deepEqual(document.layerOrder, useImageStore.getState().layerOrder)
  useImageStore.temporal.getState().undo()
  assert.deepEqual(orderedLayerIds(useImageStore.getState()), before)
  await applyDesignDocument(document, (source) => source)
  applyDesignLayout(document, (source) => source, { canvasW: 800, canvasH: 800 })
  assert.equal(orderedLayerIds(useImageStore.getState()).at(-1), textId)
})

test('typography leaves a clear copy band above every composition screen', async () => {
  const { TYPOGRAPHY_TEMPLATES, withTypographyLayout } = await import('../lib/typography/templates')
  const { screenBoxAspect } = await import('../lib/frames/geometry')
  for (const aspectRatio of ['9_16', '16_9', '4_3'] as const) {
    const base = designDocumentSchema.parse({
      version: 2,
      canvas: { aspectRatio },
      image: { src: null },
      devices: {
        layoutId: 'grid',
        mockups: Array.from({ length: 6 }, (_, index) => ({
          id: `phone-${index}`,
          definitionId: 'iphone-17-pro-front',
          position: { x: 0.5, y: 0.5 },
          size: 0.3,
          screen: { src: null },
        })),
      },
    })
    for (const template of TYPOGRAPHY_TEMPLATES) {
      const result = withTypographyLayout(base, template)
      assert.equal(designDocumentSchema.safeParse(result).success, true)
      const aspect = aspectRatio === '9_16' ? 9 / 16 : aspectRatio === '16_9' ? 16 / 9 : 4 / 3
      const copyBottom = Math.max(
        ...result.texts.map(
          (text) => text.position.y / 100 + (text.fontSize * aspect * (text.lineHeight ?? 1.2)) / 2
        )
      )
      for (const screen of result.devices!.mockups) {
        const top = screen.position.y - (screen.size * aspect) / screenBoxAspect(screen) / 2
        assert.ok(
          top > copyBottom,
          `${template.id} at ${aspectRatio}: screen ${top} overlaps copy ${copyBottom}`
        )
      }
    }
  }
})

test('MediaPipe diagnostics retain real failures and restore console after overlapping scans', async (context) => {
  const { withMediaPipeDiagnostics } = await import('../lib/redaction/diagnostics')
  const errors: unknown[][] = [],
    info: unknown[][] = []
  context.mock.method(console, 'error', (...args: unknown[]) => errors.push(args))
  context.mock.method(console, 'info', (...args: unknown[]) => info.push(args))
  const original = console.error
  let finish!: () => void
  const one = withMediaPipeDiagnostics(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  await withMediaPipeDiagnostics(async () => {
    console.error('INFO: Created TensorFlow Lite XNNPACK delegate for CPU.')
    console.error('Model load failed')
  })
  finish()
  await one
  assert.equal(console.error, original)
  assert.deepEqual(errors, [['Model load failed']])
  assert.equal(info.length, 1)
})
