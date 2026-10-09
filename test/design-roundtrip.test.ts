import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDesignChanges, applyDesignDocument, applyDesignLayout } from '@/lib/design/apply'
import { patchDesignDocument } from '@/lib/design/document'
import { exportDesignDocument } from '@/lib/design/export'
import { getDesignTemplate } from '@/lib/design/templates'
import { useImageStore } from '@/lib/store'

const canvas = { canvasH: 900, canvasW: 1600 }
const identity = (ref: string) => ref
const close = (actual: number | undefined, expected: number, label: string) =>
  assert.ok(
    Math.abs((actual ?? Number.NaN) - expected) < 0.01,
    `${label}: ${actual} != ${expected}`
  )

function loadDesign() {
  useImageStore.setState({ canvasDimensions: { ...canvas, framedH: 800, framedW: 1400 } })
  const base = getDesignTemplate('layout-browser-launch')!.build({
    headline: 'Your docs, in one place',
    screenshot: '/demo/notion-showcase.webp',
  })
  const document = patchDesignDocument(base, {
    annotations: [{ end: { x: 0.4, y: 0.5 }, start: { x: 0.2, y: 0.3 }, type: 'arrow' }],
    image: { perspective: { rotateY: 8 } },
    overlays: [{ position: { x: 0.8, y: 0.2 }, size: 0.1, src: 'overlays/arrow/arrow-1.svg' }],
    redactions: [{ position: { x: 0.1, y: 0.6 }, size: { height: 0.05, width: 0.2 } }],
  })
  applyDesignDocument(document, identity)
  applyDesignLayout(document, identity, canvas)
  return document
}

test('a design survives being loaded into the editor and exported back', () => {
  const document = loadDesign()
  const exported = exportDesignDocument()

  assert.equal(exported.canvas?.aspectRatio, '16_9')
  assert.equal(exported.image.frame?.type, 'macos-dark')
  close(exported.image.perspective?.rotateY, 8, 'rotateY')
  assert.equal(exported.texts[0]?.text, 'Your docs, in one place')
  close(exported.texts[0]?.fontSize, document.texts[0]!.fontSize, 'fontSize')
  close(exported.texts[0]?.position.y, document.texts[0]!.position.y, 'text y')
  close(exported.annotations[0]?.start.x, 0.2, 'annotation start x')
  close(exported.annotations[0]?.end.y, 0.5, 'annotation end y')
  close(exported.redactions[0]?.size.width, 0.2, 'redaction width')
  assert.equal(exported.overlays.length, 1, 'template light overlays are not user overlays')
  close(exported.overlays[0]?.position.x, 0.8, 'overlay x')
})

test('an AI edit changes only what it names and undoes in one step', async () => {
  loadDesign()
  const before = useImageStore.getState().backgroundConfig.value
  const perspectiveBefore = useImageStore.getState().perspective3D.perspective
  await applyDesignChanges(
    {
      background: { blur: 0, noise: 0, opacity: 1, type: 'gradient', value: 'mesh:mesh_ocean' },
      image: { perspective: { rotateY: -12 } },
    },
    identity
  )
  const edited = exportDesignDocument()
  assert.equal(edited.background?.value, 'mesh:mesh_ocean')
  close(edited.image.perspective?.rotateY, -12, 'rotateY')
  assert.equal(edited.texts[0]?.text, 'Your docs, in one place', 'untouched layers stay')
  assert.equal(edited.annotations.length, 1, 'untouched layers stay')
  assert.equal(
    useImageStore.getState().perspective3D.perspective,
    perspectiveBefore,
    'a partial perspective change keeps the fields it did not name'
  )

  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().backgroundConfig.value, before)
  close(useImageStore.getState().perspective3D.rotateY, 8, 'rotateY after undo')
})
