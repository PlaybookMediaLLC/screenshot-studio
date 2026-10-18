import assert from 'node:assert/strict'
import test from 'node:test'
import { projectTransformedCorners, rotatedCorners } from '../lib/store-screenshots/engine/geometry'
import { applyMarks, commonMarks, normalizeSpans } from '../lib/store-screenshots/engine/rich-text'
import { snapRect } from '../lib/store-screenshots/engine/snapping'

test('rich text marks apply to a word without losing the rest (F10)', () => {
  const spans = [{ text: 'Track every workout' }]
  const bold = applyMarks(spans, 6, 11, { set: { bold: true } })
  assert.deepEqual(bold, [{ text: 'Track ' }, { text: 'every', bold: true }, { text: ' workout' }])
  const colored = applyMarks(bold, 0, 19, { set: { color: '#FF0000' } })
  assert.equal(colored.length, 3)
  assert.ok(colored.every((span) => span.color === '#FF0000'))
  assert.deepEqual(commonMarks(colored, 6, 11), { bold: true, color: '#FF0000' })
  const cleared = applyMarks(colored, 0, 19, { clear: ['bold', 'color'] })
  assert.deepEqual(cleared, [{ text: 'Track every workout' }])
})

test('normalizing merges equal neighbours and keeps one empty span', () => {
  assert.deepEqual(
    normalizeSpans([{ text: 'a', italic: true }, { text: 'b', italic: true }, { text: '' }]),
    [{ text: 'ab', italic: true }]
  )
  assert.deepEqual(normalizeSpans([]), [{ text: '' }])
})

test('snapping pulls a rectangle to the slide centre within the threshold (F15)', () => {
  const slide = { width: 1000, height: 2000 }
  const result = snapRect({ x: 396, y: 300, width: 200, height: 100 }, slide, [], 6)
  assert.equal(result.dx, 4)
  assert.equal(result.guides[0].axis, 'x')
  const none = snapRect({ x: 380, y: 300, width: 200, height: 100 }, slide, [], 6)
  assert.equal(none.dx, 0)
  const toOther = snapRect(
    { x: 10, y: 503, width: 50, height: 50 },
    slide,
    [{ x: 100, y: 500, width: 10, height: 10 }],
    6
  )
  assert.equal(toOther.dy, 2, 'the nearest line (the other layer centre) wins')
})

test('tilted selection corners match the CSS transform projection (UX-13)', () => {
  const rect = { x: 0, y: 0, width: 100, height: 200 }
  assert.deepEqual(projectTransformedCorners(rect, 10, 0, 0), rotatedCorners(rect, 10))
  const tilted = projectTransformedCorners(rect, 0, 0, 20)
  // rotateY brings the left edge toward the viewer: it grows, the right edge shrinks.
  const leftHeight = tilted[3].y - tilted[0].y
  const rightHeight = tilted[2].y - tilted[1].y
  assert.ok(leftHeight > 200 && rightHeight < 200)
})

test('restoring a version is one undo step and keeps the edits made before it', async () => {
  const { createEditorStore } = await import('../components/store-screenshots/studio/editor-store')
  const { createStarterDocument } = await import('../lib/store-screenshots/document/factory')
  const store = createEditorStore(createStarterDocument())
  store.getState().dispatch({ type: 'project.patch', patch: { name: 'Edited' } })
  const edited = store.getState().document
  const version = {
    ...createStarterDocument(),
    id: edited.id,
    revision: edited.revision,
    name: 'Restored',
  }
  store.getState().replaceDocument(version, { undoLabel: 'Restore version' })
  assert.equal(store.getState().document.name, 'Restored')
  store.getState().undo()
  assert.equal(store.getState().document, edited)
  store.getState().undo()
  assert.notEqual(store.getState().document.name, 'Edited')
  store.getState().redo()
  store.getState().redo()
  assert.equal(store.getState().document.name, 'Restored')
})

test('callout picking ends when the slide changes or its layer goes away', async () => {
  const { createEditorStore } = await import('../components/store-screenshots/studio/editor-store')
  const { createStarterDocument } = await import('../lib/store-screenshots/document/factory')
  const store = createEditorStore(createStarterDocument())
  const [first, second] = store.getState().document.slides
  const layerId = first.layers[0].id
  store.getState().setPickingCallout(layerId)
  store.getState().activateSlide(second.id)
  assert.equal(store.getState().pickingCalloutId, null)
  store.getState().activateSlide(first.id)
  store.getState().setPickingCallout(layerId)
  store.getState().dispatch({
    type: 'layers.delete',
    owner: { kind: 'slide', id: first.id },
    layerIds: [layerId],
  })
  assert.equal(store.getState().pickingCalloutId, null)
})
