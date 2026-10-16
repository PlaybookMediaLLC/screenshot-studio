import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDesignDocument, applyDesignLayout } from '@/lib/design/apply'
import {
  getDesignAssetIds,
  getLocalDesignSources,
  mapDesignSources,
  parseDesignDocument,
} from '@/lib/design/document'
import { exportDesignDocument } from '@/lib/design/export'
import { useImageStore } from '@/lib/store'

const canvas = { canvasH: 900, canvasW: 1600 }
const identity = (ref: string) => ref
const sticker = 'blob:http://localhost/sticker'
const main = 'blob:http://localhost/main'
const slide = 'blob:http://localhost/slide-2'

function richEditor() {
  const store = useImageStore.getState()
  store.clearImage()
  useImageStore.setState({
    activeSlideId: 'slide-1',
    animationClips: [
      { color: '#c9ff2e', duration: 1500, id: 'clip-1', name: 'Drop In', presetId: 'drop-in', startTime: 200 },
    ],
    annotations: [
      {
        cx: 400,
        cy: 100,
        fillColor: 'transparent',
        id: 'arrow-1',
        isVisible: true,
        opacity: 1,
        strokeColor: '#ef4444',
        strokeWidth: 6,
        type: 'curved-arrow',
        x1: 160,
        x2: 800,
        y1: 90,
        y2: 450,
      },
    ],
    blurRegions: [
      {
        blurAmount: 12,
        id: 'blur-1',
        isVisible: false,
        position: { x: 320, y: 180 },
        size: { height: 90, width: 400 },
        style: 'mosaic',
      },
    ],
    canvasDimensions: { ...canvas, framedH: 800, framedW: 1400 },
    canvasPadding: 64,
    customDimensions: { height: 1000, width: 1500 },
    imageName: 'main.png',
    imageOverlays: [
      {
        blur: 2,
        flipX: true,
        flipY: false,
        id: 'overlay-1',
        isCustom: true,
        isVisible: true,
        layer: 'back',
        opacity: 0.8,
        position: { x: 800, y: 450 },
        radius: 12,
        rotation: 15,
        size: 320,
        src: sticker,
        tilt: { perspective: 800, rotateX: 10, rotateY: -20 },
      },
    ],
    imagePlacement: { offsetX: 160, offsetY: -90, rotation: 4 },
    imageShadow: {
      blur: 33,
      color: 'rgba(0, 0, 0, 0.4)',
      enabled: true,
      offsetX: 3,
      offsetY: 17,
      opacity: 0.4,
      spread: 6,
    },
    brand: {
      applied: { background: { type: 'solid', value: '#101010' }, 'texts.headline.color': '#fafafa' },
      kitId: 'ckbrandkit00000000000000',
      name: 'Acme',
      version: 3,
    },
    pattern: {
      blur: 0,
      color: '#ffffff',
      enabled: true,
      opacity: 0.2,
      rotation: 0,
      scale: 1,
      spacing: 24,
      type: 'dots',
    },
    selectedAspectRatio: 'custom',
    slides: [
      { duration: 2, id: 'slide-1', name: 'main.png', src: main },
      { duration: 3, id: 'slide-2', name: 'second.png', src: slide },
    ],
    textOverlays: [
      {
        color: '#ffffff',
        fontFamily: 'inter',
        fontSize: 64,
        fontWeight: 'bold',
        id: 'text-1',
        isVisible: false,
        opacity: 1,
        orientation: 'horizontal',
        position: { x: 50, y: 12 },
        text: 'Hidden headline',
        textShadow: { blur: 0, color: 'rgba(0,0,0,0)', enabled: false, offsetX: 0, offsetY: 0 },
      },
    ],
    timeline: {
      ...useImageStore.getState().timeline,
      duration: 4000,
      tracks: [
        {
          clipId: 'clip-1',
          id: 'track-1',
          isLocked: false,
          isVisible: true,
          keyframes: [
            { easing: 'ease-out', id: 'kf-1', properties: { translateY: -20 }, time: 200 },
            { easing: 'ease-out', id: 'kf-2', properties: { translateY: 0 }, time: 1700 },
          ],
          name: 'Transform',
          type: 'transform',
        },
      ],
    },
    uploadedImageUrl: main,
  })
}

test('a lossless export reproduces the editor exactly', () => {
  richEditor()
  const exported = exportDesignDocument({ keepLocalSources: true })

  useImageStore.getState().clearImage()
  applyDesignDocument(exported, identity)
  useImageStore.setState({ canvasDimensions: { ...canvas, framedH: 800, framedW: 1400 } })
  applyDesignLayout(exported, identity, canvas)

  assert.deepEqual(exportDesignDocument({ keepLocalSources: true }), exported)
  const state = useImageStore.getState()
  assert.equal(state.imageOverlays[0]?.src, sticker)
  assert.equal(state.textOverlays[0]?.isVisible, false)
  assert.equal(state.annotations[0]?.cx, 400)
  assert.equal(state.imageShadow.spread, 6)
  assert.equal(state.slides.length, 2)
  assert.deepEqual(state.customDimensions, { height: 1000, width: 1500 })
  assert.equal(state.animationClips[0]?.presetId, 'drop-in')
})

test('the AI view of the canvas leaves local images and hidden layers out', () => {
  richEditor()
  const forAi = exportDesignDocument()
  assert.equal(forAi.image.src, null)
  assert.equal(forAi.overlays.length, 0, 'a local sticker is not portable')
  assert.equal(forAi.texts.length, 0, 'hidden text is not shown to the AI')
  assert.equal(forAi.slides, undefined)
  assert.deepEqual(getLocalDesignSources(forAi), [])
})

test('local sources can be swapped for uploaded assets before a document is stored', () => {
  richEditor()
  const local = exportDesignDocument({ keepLocalSources: true })
  assert.deepEqual(getLocalDesignSources(local).sort(), [main, slide, sticker].sort())

  const ids: Record<string, string> = {
    [main]: 'asset:11111111-1111-4111-8111-111111111111',
    [slide]: 'asset:22222222-2222-4222-8222-222222222222',
    [sticker]: 'asset:33333333-3333-4333-8333-333333333333',
  }
  const stored = mapDesignSources(local, (ref) => ids[ref] ?? ref)
  assert.deepEqual(getLocalDesignSources(stored), [])
  assert.equal(getDesignAssetIds(stored).length, 3)
  assert.equal(stored.slides?.items[1]?.src, ids[slide])
})

test('a version 1 document is read as version 2', () => {
  const v1 = { image: { src: null }, version: 1 }
  assert.equal(parseDesignDocument(v1).version, 2)
  assert.throws(() => parseDesignDocument({ image: { src: null }, version: 3 }))
})
