import assert from 'node:assert/strict'
import test from 'node:test'
import { withAnimationPreset } from '../lib/animation/preview'
import { getPresetById } from '../lib/animation/presets'
import { designDocumentSchema, DESIGN_DOCUMENT_VERSION } from '../lib/design/document'
import { previewKey } from '../lib/render/preview-cache'
import { withLayoutPreset } from '../components/editor/sections/TransformsGallery'

const output = { format: 'jpeg', maxWidth: 480 } as const
const tilt = { perspective: 2400, rotateX: 8, rotateY: -6, rotateZ: 0, scale: 0.98, translateX: 0, translateY: -2 }

function design(frame: 'none' | 'windows-dark' | 'macos-light') {
  return designDocumentSchema.parse({
    image: { frame: { type: frame }, src: '/demo/notion-showcase.webp' },
    timeline: { clips: [], duration: 3000, tracks: [] },
    version: DESIGN_DOCUMENT_VERSION,
  })
}

test('a layout preview is the design with the preset applied, frame included', () => {
  const preview = withLayoutPreset(design('windows-dark'), tilt)
  assert.equal(preview.image.frame?.type, 'windows-dark')
  assert.deepEqual(preview.image.perspective, tilt)
  assert.equal(preview.timeline, undefined, 'animation never overrides a layout preview')
  assert.doesNotThrow(() => designDocumentSchema.parse(preview))
})

test('changing the frame changes every preview, and nothing else does', () => {
  const chrome = previewKey(withLayoutPreset(design('windows-dark'), tilt), output)
  assert.equal(previewKey(withLayoutPreset(design('windows-dark'), tilt), output), chrome)
  assert.notEqual(previewKey(withLayoutPreset(design('macos-light'), tilt), output), chrome)
  assert.notEqual(previewKey(withLayoutPreset(design('none'), tilt), output), chrome)
})

test('an animation preview plays only that preset, with stable ids', () => {
  const preset = getPresetById('drop-in') ?? getPresetById('hero-landing')
  assert.ok(preset)
  const first = withAnimationPreset(design('windows-dark'), preset)
  const second = withAnimationPreset(design('windows-dark'), preset)
  assert.deepEqual(first, second)
  assert.equal(first.timeline?.clips.length, 1)
  assert.equal(first.image.frame?.type, 'windows-dark')
  assert.doesNotThrow(() => designDocumentSchema.parse(first))
})
