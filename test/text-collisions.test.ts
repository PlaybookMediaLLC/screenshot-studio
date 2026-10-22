import assert from 'node:assert/strict'
import test from 'node:test'
import { overlappingTextLayers } from '@/lib/render/text-collisions'

const line = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
})

test('export catches a wrapped headline colliding with a badge or supporting line', () => {
  assert.deepEqual(
    overlappingTextLayers([
      { label: 'Headline', lines: [line(10, 10, 100, 30), line(10, 30, 100, 50)] },
      { label: 'Supporting line', lines: [line(20, 45, 90, 65)] },
    ]),
    ['Headline', 'Supporting line']
  )
  assert.deepEqual(
    overlappingTextLayers([
      { label: 'New', lines: [line(45, 0, 65, 20)] },
      { label: 'Headline', lines: [line(10, 10, 100, 30)] },
    ]),
    ['New', 'Headline']
  )
})

test('empty layers, adjacent lines, and whitespace between lines do not block exports', () => {
  assert.equal(
    overlappingTextLayers([
      { label: 'Headline', lines: [line(0, 0, 100, 20), line(0, 60, 100, 80)] },
      { label: 'Label', lines: [line(10, 21, 90, 59)] },
      { label: 'Empty', lines: [] },
    ]),
    null
  )
  assert.equal(
    overlappingTextLayers([
      { label: 'Left', lines: [line(0, 0, 100, 20)] },
      { label: 'Right', lines: [line(99.5, 0, 200, 20)] },
    ]),
    null
  )
})
