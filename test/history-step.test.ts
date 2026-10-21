import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginHistoryStep,
  endHistoryStep,
  HISTORY_LIMIT,
  useImageStore,
  withHistoryStep,
} from '@/lib/store'

function fillHistory(count: number) {
  for (let index = 0; index < count; index++) useImageStore.getState().setCanvasPadding(index % 50)
}

test('a step undoes as one even when history is at its limit', () => {
  useImageStore.getState().clearImage()
  useImageStore.temporal.getState().clear()
  fillHistory(HISTORY_LIMIT + 20)
  assert.equal(useImageStore.temporal.getState().pastStates.length, HISTORY_LIMIT)
  const before = useImageStore.getState()
  const step = beginHistoryStep()
  useImageStore.getState().setImageScale(55)
  useImageStore.getState().setBorderRadius(31)
  useImageStore.getState().setImageOpacity(0.4)
  endHistoryStep(step)
  useImageStore.temporal.getState().undo()
  const after = useImageStore.getState()
  assert.equal(after.imageScale, before.imageScale)
  assert.equal(after.borderRadius, before.borderRadius)
  assert.equal(after.imageOpacity, before.imageOpacity)
})

test('a step from empty history and a nested step each undo as one', () => {
  useImageStore.getState().clearImage()
  useImageStore.temporal.getState().clear()
  const before = useImageStore.getState().imageScale
  withHistoryStep(() => {
    useImageStore.getState().setImageScale(70)
    withHistoryStep(() => useImageStore.getState().setBorderRadius(12))
    useImageStore.getState().setImageScale(80)
  })
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1)
  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().imageScale, before)
})

test('typing bursts undo together, while intervening edits and undo start a new step', async () => {
  const { withTypingHistory } = await import('../lib/store')
  useImageStore.setState(useImageStore.getInitialState(), true)
  const store = useImageStore.getState()
  const id = store.addTextOverlay()
  useImageStore.temporal.getState().clear()
  for (const text of ['H', 'He', 'Hello']) {
    withTypingHistory(id, () => store.updateTextOverlay(id, { text }))
  }
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1)
  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().textOverlays[0].text, 'Text')
  useImageStore.temporal.getState().redo()
  assert.equal(useImageStore.getState().textOverlays[0].text, 'Hello')
  store.setBorderRadius(23)
  withTypingHistory(id, () => store.updateTextOverlay(id, { text: 'Again' }))
  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().textOverlays[0].text, 'Hello')
  assert.equal(useImageStore.getState().borderRadius, 23)
  store.setShowTemplates(true)
  store.setShowTemplates(false)
  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().showTemplates, false)
  useImageStore.setState(useImageStore.getInitialState(), true)
  useImageStore.temporal.getState().clear()
})
