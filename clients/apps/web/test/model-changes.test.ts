import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDesignDocument } from '@/lib/design/document'
import { patchFromModel } from '@/lib/design/model-changes'

const LOGO = 'blob:http://localhost/logo'
const SCREEN = 'blob:http://localhost/screen-2'

const base = parseDesignDocument({
  version: 2,
  devices: {
    mockups: [
      {
        definitionId: 'iphone-17-pro-front',
        id: 'm1',
        position: { x: 0.3, y: 0.5 },
        screen: { src: SCREEN },
        size: 0.4,
      },
    ],
  },
  image: { src: 'blob:http://localhost/main' },
  overlays: [
    { id: 'sticker', position: { x: 0.2, y: 0.2 }, size: 0.1, src: '/overlays/arrow.svg' },
    {
      id: 'hidden',
      position: { x: 0.5, y: 0.5 },
      size: 0.1,
      src: '/overlays/arrow.svg',
      visible: false,
    },
    { id: 'brand-logo', position: { x: 0.9, y: 0.9 }, size: 0.1, src: LOGO },
  ],
  texts: [{ fontSize: 0.05, id: 'h', position: { x: 50, y: 10 }, text: 'Hello' }],
})
/** What the model saw: no hidden layers, no local images. */
const view = parseDesignDocument({
  ...base,
  devices: {
    mockups: base.devices!.mockups.map((mockup) => ({
      ...mockup,
      screen: { ...mockup.screen, src: null },
    })),
  },
  image: { src: null },
  overlays: [base.overlays[0]!],
})

test('a model edit to a list keeps the layers the model never saw', () => {
  const result = patchFromModel(base, view, {
    overlays: [{ ...base.overlays[0]!, position: { x: 0.25, y: 0.25 } }],
  })
  assert.deepEqual(
    result.overlays.map((overlay) => overlay.id),
    ['sticker', 'hidden', 'brand-logo']
  )
  assert.deepEqual(result.overlays[0]?.position, { x: 0.25, y: 0.25 })
  assert.equal(result.overlays.find((overlay) => overlay.id === 'brand-logo')?.src, LOGO)
})

test('a layer the model saw and removed stays removed', () => {
  const result = patchFromModel(base, view, { overlays: [] })
  assert.deepEqual(
    result.overlays.map((overlay) => overlay.id),
    ['hidden', 'brand-logo']
  )
})

test('device screens keep their images through a model edit', () => {
  const result = patchFromModel(base, view, {
    devices: { mockups: [{ ...view.devices!.mockups[0]!, size: 0.5 }] },
  })
  assert.equal(result.devices?.mockups[0]?.size, 0.5)
  assert.equal(result.devices?.mockups[0]?.screen.src, SCREEN)
  assert.equal(result.image.src, base.image.src)
})
