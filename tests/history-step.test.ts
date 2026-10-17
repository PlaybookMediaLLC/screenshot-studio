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
