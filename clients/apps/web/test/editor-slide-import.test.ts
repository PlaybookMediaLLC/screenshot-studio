import assert from 'node:assert/strict'
import test from 'node:test'
import { useImageStore } from '../lib/store'

test('appending slides preserves the selected slide and the image being edited', () => {
  useImageStore.setState(useImageStore.getInitialState(), true)
  const store = useImageStore.getState()
  const file = (name: string) => new File(['image'], name, { type: 'image/png' })
  try {
    store.addImages([file('first.png'), file('second.png')])
    const second = useImageStore.getState().slides[1]
    store.setActiveSlide(second.id)
    store.addImages([file('third.png')])
    const state = useImageStore.getState()
    assert.equal(state.slides.length, 3)
    assert.equal(state.activeSlideId, second.id)
    assert.equal(state.uploadedImageUrl, second.src)
    assert.equal(state.imageName, second.name)
  } finally {
    useImageStore.getState().slides.forEach((slide) => URL.revokeObjectURL(slide.src))
    useImageStore.setState(useImageStore.getInitialState(), true)
    useImageStore.temporal.getState().clear()
  }
})

test('removing only the selected screenshot updates duration and undo restores the deck', async () => {
  const { removeScreenshot } = await import('../lib/editor/remove-screenshot')
  useImageStore.setState(useImageStore.getInitialState(), true)
  const store = useImageStore.getState()
  store.addImages(
    ['one', 'two', 'three'].map((name) => new File(['image'], name, { type: 'image/png' }))
  )
  const slides = useImageStore.getState().slides
  const textId = store.addTextOverlay()
  store.setActiveSlide(slides[2].id)
  assert.equal(useImageStore.getState().timeline.duration, 6000)
  removeScreenshot()
  assert.equal(useImageStore.getState().timeline.duration, 4000)
  assert.deepEqual(useImageStore.getState().slides, slides.slice(0, 2))
  assert.equal(useImageStore.getState().textOverlays[0].id, textId)
  useImageStore.temporal.getState().undo()
  assert.deepEqual(useImageStore.getState().slides, slides)
  assert.equal(useImageStore.getState().timeline.duration, 6000)
  slides.forEach((slide) => store.removeSlide(slide.id))
  assert.equal(useImageStore.getState().uploadedImageUrl, null)
  assert.equal(useImageStore.getState().textOverlays.length, 1)
  slides.forEach((slide) => URL.revokeObjectURL(slide.src))
  useImageStore.setState(useImageStore.getInitialState(), true)
  useImageStore.temporal.getState().clear()
})

test('slide durations reject invalid values and update every slide and the timeline', () => {
  useImageStore.setState(useImageStore.getInitialState(), true)
  const store = useImageStore.getState()
  store.addImages(['one', 'two'].map((name) => new File(['image'], name, { type: 'image/png' })))
  for (const defaultDuration of [NaN, Infinity, 0, -5, 50]) {
    store.setSlideshow({ defaultDuration })
    assert.equal(useImageStore.getState().slideshow.defaultDuration, 2)
  }
  store.setSlideshow({ defaultDuration: 0.5 })
  assert.deepEqual(
    useImageStore.getState().slides.map((slide) => slide.duration),
    [0.5, 0.5]
  )
  assert.equal(useImageStore.getState().timeline.duration, 1000)
  useImageStore.getState().slides.forEach((slide) => URL.revokeObjectURL(slide.src))
  useImageStore.setState(useImageStore.getInitialState(), true)
  useImageStore.temporal.getState().clear()
})
