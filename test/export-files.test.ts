import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extensionFor,
  FORMAT_INFO,
  formatForMimeType,
  formatHasControl,
  isAnimatedFormat,
  mimeTypeFor,
  outputFormatSchema,
} from '@/lib/export/formats'
import {
  batchEntryPath,
  designFileName,
  safeBaseName,
  sizeSlug,
  zipFileName,
} from '@/lib/export/naming'
import {
  canvasTarget,
  customTarget,
  EXPORT_SIZE_PRESETS,
  exportTargetSchema,
  getSizePreset,
  toggleTarget,
} from '@/lib/export/sizes'

test('every format has a unique MIME type and extension that map back to it', () => {
  const mimes = new Set<string>()
  for (const format of outputFormatSchema.options) {
    const info = FORMAT_INFO[format]
    assert.ok(!mimes.has(info.mime), `${format} MIME is unique`)
    mimes.add(info.mime)
    assert.equal(formatForMimeType(mimeTypeFor(format)), format)
    assert.match(extensionFor(format), /^[a-z0-9]+$/)
  }
  assert.equal(formatForMimeType('video/webm; codecs=vp9'), 'webm')
  assert.equal(formatForMimeType('IMAGE/JPEG'), 'jpeg')
  assert.equal(formatForMimeType('text/html'), null)
  assert.equal(extensionFor('jpeg'), 'jpg')
  assert.equal(mimeTypeFor('svg'), 'image/svg+xml')
  assert.equal(mimeTypeFor('pdf'), 'application/pdf')
})

test('each format shows only the controls that change it', () => {
  // Lossless and vector formats have no quality; JPEG, PDF, and video have no transparency.
  assert.ok(!formatHasControl('png', 'quality'))
  assert.ok(!formatHasControl('svg', 'quality'))
  assert.ok(formatHasControl('jpeg', 'quality'))
  assert.ok(!formatHasControl('jpeg', 'transparency'))
  assert.ok(!formatHasControl('pdf', 'transparency'))
  assert.ok(formatHasControl('pdf', 'compression'))
  // Several sizes come from the render frame, which draws stills only.
  for (const format of outputFormatSchema.options) {
    assert.equal(formatHasControl(format, 'sizes'), !isAnimatedFormat(format), format)
    assert.equal(formatHasControl(format, 'fps'), isAnimatedFormat(format), format)
  }
  assert.ok(formatHasControl('gif', 'width') && !formatHasControl('mp4', 'width'))
})

test('size presets are valid, unique, and include every group', () => {
  const ids = new Set<string>()
  for (const preset of EXPORT_SIZE_PRESETS) {
    assert.doesNotThrow(() => exportTargetSchema.parse(preset))
    assert.ok(!ids.has(preset.id), `${preset.id} is unique`)
    ids.add(preset.id)
  }
  const groups = new Set(EXPORT_SIZE_PRESETS.map((preset) => preset.group))
  for (const group of ['social', 'marketing', 'presentation', 'app-store'] as const)
    assert.ok(groups.has(group))
  assert.deepEqual(getSizePreset('instagram-story'), {
    group: 'social',
    height: 1920,
    id: 'instagram-story',
    label: 'Instagram story',
    width: 1080,
  })
})

test('custom sizes are validated with a readable error', () => {
  assert.deepEqual(customTarget(800, 600), {
    group: 'custom',
    height: 600,
    id: 'custom-800x600',
    label: '800×600',
    width: 800,
  })
  assert.throws(() => customTarget(10, 600), /between 16 and 8192/)
  assert.throws(() => customTarget(800.5, 600), /whole pixels/)
  assert.throws(() => customTarget(9000, 600), /between 16 and 8192/)
})

test('toggling targets adds and removes by id, in pick order', () => {
  const story = getSizePreset('instagram-story')!
  const og = getSizePreset('open-graph')!
  const picked = toggleTarget(toggleTarget([], story), og)
  assert.deepEqual(
    picked.map((target) => target.id),
    ['instagram-story', 'open-graph']
  )
  assert.deepEqual(
    toggleTarget(picked, story).map((target) => target.id),
    ['open-graph']
  )
})

test('names are safe for every file system and ZIP', () => {
  assert.equal(safeBaseName('../../etc/passwd'), 'etc-passwd')
  assert.equal(
    safeBaseName('Screen Shot 2026-10-16 at 9.05.10.png'),
    'Screen-Shot-2026-10-16-at-9.05.10'
  )
  assert.equal(safeBaseName('räksmörgås.JPG'), 'räksmörgås')
  assert.equal(safeBaseName('...'), 'shots')
  assert.equal(safeBaseName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j')
  assert.equal(safeBaseName('x'.repeat(200)).length, 60)
})

test('design files carry their size; a PDF holds every size', () => {
  const story = getSizePreset('instagram-story')!
  assert.equal(sizeSlug(story), 'instagram-story-1080x1920')
  assert.equal(sizeSlug(story, 2), 'instagram-story-1080x1920@2x')
  assert.equal(sizeSlug(canvasTarget(1920, 1440)), '1920x1440')
  assert.equal(
    designFileName('launch.png', 'png', canvasTarget(1920, 1440)),
    'launch-1920x1440.png'
  )
  assert.equal(
    designFileName('launch', 'jpeg', story, 2),
    'launch-instagram-story-1080x1920@2x.jpg'
  )
  assert.equal(designFileName('launch', 'pdf', story), 'launch.pdf')
  assert.equal(designFileName('', 'gif'), 'shots.gif')
  assert.equal(zipFileName('launch.png', 'sizes'), 'launch-sizes.zip')
})

test('batch files sit in one folder per size, numbered in import order', () => {
  const og = getSizePreset('open-graph')!
  assert.equal(
    batchEntryPath({ format: 'png', index: 0, name: 'Home page.png', target: og, total: 30 }),
    'open-graph-1200x630/01-Home-page.png'
  )
  assert.equal(
    batchEntryPath({ format: 'webp', index: 9, name: 'b.png', scale: 2, target: og, total: 10 }),
    'open-graph-1200x630@2x/10-b.webp'
  )
  assert.equal(
    batchEntryPath({ format: 'pdf', index: 2, name: 'c.png', target: og, total: 3 }),
    '3-c.pdf'
  )
})
