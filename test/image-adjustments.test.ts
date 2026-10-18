import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoEnhanceFilters,
  hasImageAdjustments,
  imageFilterCss,
  NEUTRAL_IMAGE_FILTERS,
  tonalStats,
} from '../lib/editor/image-adjustments'

function pixels(colors: [number, number, number][]): number[] {
  return colors.flatMap(([r, g, b]) => [r, g, b, 255])
}

test('neutral adjustments draw nothing', () => {
  assert.equal(imageFilterCss(NEUTRAL_IMAGE_FILTERS), undefined)
  assert.equal(hasImageAdjustments(NEUTRAL_IMAGE_FILTERS), false)
  assert.equal(
    imageFilterCss({ ...NEUTRAL_IMAGE_FILTERS, brightness: 120, blur: 2 }),
    'brightness(1.2) blur(2px)'
  )
})

test('auto enhance leaves a well exposed bright UI alone', () => {
  const ui = tonalStats(
    pixels([...Array(90).fill([250, 250, 250]), ...Array(10).fill([20, 20, 20])])
  )
  const filters = autoEnhanceFilters(ui)
  assert.equal(filters.brightness, 100, 'a bright UI is never darkened')
  assert.equal(filters.contrast, 100)
})

test('auto enhance stretches a flat range and lifts a dark image', () => {
  const dark = tonalStats(
    pixels(
      Array(100)
        .fill(0)
        .map((_, i) => [40 + (i % 30), 40 + (i % 30), 45 + (i % 30)])
    )
  )
  const filters = autoEnhanceFilters(dark)
  assert.ok(filters.brightness > 100, `brightness ${filters.brightness}`)
  assert.ok(filters.contrast > 100, `contrast ${filters.contrast}`)
  assert.ok(filters.contrast <= 140 && filters.brightness <= 130, 'corrections stay subtle')
  assert.equal(filters.saturate, 110, 'a grey image gets a little colour')
  assert.equal(filters.hueRotate, 0)
})
