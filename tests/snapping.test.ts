import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasSnapLines, mergeSnapLines, objectSnapLines, safeZoneRect, snapBox } from '../lib/editor/snapping'

test('a box snaps its centre to the canvas centre within tolerance', () => {
  const lines = canvasSnapLines(1000, 600)
  const result = snapBox({ height: 100, width: 200, x: 404, y: 247 }, lines, 6)
  assert.equal(result.dx, -4)
  assert.equal(result.dy, 3)
  assert.equal(result.vertical, 500)
  assert.equal(result.horizontal, 300)
})

test('nothing snaps outside the tolerance', () => {
  const result = snapBox({ height: 100, width: 200, x: 420, y: 100 }, canvasSnapLines(1000, 600), 6)
  assert.deepEqual(result, { dx: 0, dy: 0, horizontal: null, vertical: null })
})

test('edges snap to other objects, and the closest line wins', () => {
  const lines = mergeSnapLines(canvasSnapLines(1000, 600), objectSnapLines([{ height: 50, width: 100, x: 610, y: 40 }]))
  // Right edge at 608 is 2px from the other box's left edge, closer than any canvas line.
  const result = snapBox({ height: 20, width: 100, x: 508, y: 37 }, lines, 6)
  assert.equal(result.vertical, 610)
  assert.equal(result.dx, 2)
  assert.equal(result.horizontal, 40, 'top edges align')
})

test('thirds are offered only when shown', () => {
  assert.equal(canvasSnapLines(900, 300).vertical.includes(300), false)
  assert.equal(canvasSnapLines(900, 300, true).vertical.includes(300), true)
})

test('safe zones inset the canvas, and the X crop is a centred 16:9 band', () => {
  const story = safeZoneRect('instagram-story', 1080, 1920)
  assert.ok(story.y > 200 && story.y + story.height < 1920 - 300)
  const crop = safeZoneRect('x-feed-crop', 1080, 1920)
  assert.equal(Math.round(crop.height), Math.round((1080 * 9) / 16))
  assert.equal(Math.round(crop.y + crop.height / 2), 960)
})
