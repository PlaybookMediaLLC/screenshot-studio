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
