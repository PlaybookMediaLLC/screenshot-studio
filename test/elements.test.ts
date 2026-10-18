import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDesignDocument } from '../lib/design/apply'
import { exportDesignDocument } from '../lib/design/export'
import {
  canvasElementSchema,
  createElement,
  elementTypeSchema,
  formatBadgeNumber,
  nextBadgeNumber,
} from '../lib/editor/elements/schema'
import { useImageStore } from '../lib/store'

test('every element type starts valid and centred where asked', () => {
  for (const type of elementTypeSchema.options) {
    const element = createElement(type, { aspect: 16 / 9, id: `e-${type}`, x: 0.4, y: 0.6 })
    assert.doesNotThrow(() => canvasElementSchema.parse(element), type)
    assert.equal(element.type, type)
  }
  const badge = createElement('badge', { aspect: 2, id: 'b' })
  assert.equal(badge.width * 2, badge.height, 'a badge is square on a 2:1 canvas')
})

test('badge numbers are written in each style and continue the sequence', () => {
  assert.equal(formatBadgeNumber(4, 'numeric'), '4')
  assert.equal(formatBadgeNumber(1, 'alpha'), 'A')
  assert.equal(formatBadgeNumber(28, 'alpha'), 'AB')
  assert.equal(formatBadgeNumber(14, 'roman'), 'XIV')
  const elements = [
    createElement('badge', { aspect: 1, id: 'a', number: 1 }),
    createElement('cursor', { aspect: 1, id: 'c' }),
    createElement('badge', { aspect: 1, id: 'b', number: 3 }),
  ]
  assert.equal(nextBadgeNumber(elements), 4)
  assert.equal(nextBadgeNumber([]), 1)
})

test('elements are added, edited, reordered, duplicated, and removed as undoable steps', () => {
  const store = useImageStore.getState()
  store.clearImage()
  useImageStore.temporal.getState().clear()
  store.addElement(createElement('badge', { aspect: 1, id: 'one', number: 1 }))
  store.addElement(createElement('spotlight', { aspect: 1, id: 'two' }))
  assert.equal(useImageStore.getState().selectedElementId, 'two', 'a new element is selected')

  store.updateElement('one', { props: { number: 7 }, x: 0.2 })
  const one = useImageStore.getState().elements[0]!
  assert.equal(one.x, 0.2)
  assert.equal(one.type === 'badge' && one.props.number, 7)
  assert.equal(one.type === 'badge' && one.props.shape, 'circle', 'props merge, not replace')

  store.reorderElement('one', 'top')
  assert.deepEqual(
    useImageStore.getState().elements.map((element) => element.id),
    ['two', 'one']
  )
  const copy = store.duplicateElement('one')
  assert.ok(copy)
  assert.equal(useImageStore.getState().elements.length, 3)
  store.removeElement(copy)
  assert.equal(useImageStore.getState().selectedElementId, null, 'removing the selection clears it')

  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().elements.length, 3, 'undo restores the removed element')
})

test('elements survive a document round trip unchanged', () => {
  const store = useImageStore.getState()
  store.clearImage()
  store.addElement(createElement('callout', { aspect: 4 / 3, id: 'zoom' }))
  const exported = exportDesignDocument({ keepLocalSources: true })
  store.clearImage()
  applyDesignDocument(exported, (ref) => ref)
  assert.deepEqual(useImageStore.getState().elements, exported.elements)
})
