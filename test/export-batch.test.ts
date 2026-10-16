import assert from 'node:assert/strict'
import test from 'node:test'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { screenshotBox } from '@/lib/export/adapt'
import { batchZipEntries, composeBatchItem, renderBatch, runPool } from '@/lib/export/batch'
import { getSizePreset } from '@/lib/export/sizes'

const size = { height: 1080, width: 1920 }

function style(): DesignDocument {
  return designDocumentSchema.parse({
    annotations: [{ end: { x: 0.5, y: 0.55 }, start: { x: 0.45, y: 0.5 }, type: 'arrow' }],
    background: { type: 'solid', value: '#0f172a' },
    canvas: { aspectRatio: 'custom', padding: 40, size },
    image: {
      frame: { type: 'macos-dark' },
      name: 'original.png',
      scale: 90,
      src: 'blob:http://localhost/original',
    },
    pattern: { type: 'grid' },
    redactions: [{ position: { x: 0.4, y: 0.4 }, size: { height: 0.05, width: 0.1 } }],
    slides: {
      items: [
        { duration: 2, id: 'a', src: 'blob:http://localhost/a' },
        { duration: 2, id: 'b', src: 'blob:http://localhost/b' },
      ],
    },
    texts: [{ fontSize: 0.05, position: { x: 50, y: 8 }, text: 'Release notes' }],
    version: 2,
  })
}

const screenshot = { aspect: 0.5, name: 'phone.png', src: 'blob:http://localhost/phone' }

test('a batch item is the style showing its own screenshot', () => {
  const item = composeBatchItem(style(), screenshot, { styleAspect: 16 / 10 })
  assert.equal(item.image.src, screenshot.src)
  assert.equal(item.image.name, 'phone.png')
  assert.equal(item.slides, undefined, 'slides belong to the style design, not the item')
  assert.deepEqual(item.canvas?.size, size, 'the item keeps the style size')
  assert.equal(item.image.frame?.type, 'macos-dark')
  assert.deepEqual(item.texts, style().texts)
  assert.deepEqual(item.background, style().background)
  // The arrow sat on the original screenshot; it keeps its place on the new one.
  const before = screenshotBox(style(), size, 16 / 10)!
  const after = screenshotBox(item, size, 0.5)!
  const u = (point: { x: number }, box: typeof before) => (point.x - box.cx) / box.width
  assert.ok(
    Math.abs(u(item.annotations[0]!.start, after) - u(style().annotations[0]!.start, before)) < 1e-6
  )
  assert.doesNotThrow(() => designDocumentSchema.parse(item))
})

test('batch-wide switches drop the background, frame, text, or markup', () => {
  const item = composeBatchItem(style(), screenshot, {
    adjustments: { background: false, frame: false, markup: false, text: false },
  })
  assert.deepEqual(item.background, {
    blur: 0,
    noise: 0,
    opacity: 1,
    radius: undefined,
    type: 'solid',
    value: 'transparent',
  })
  assert.equal(item.pattern, undefined)
  assert.equal(item.image.frame?.type, 'none')
  assert.deepEqual(item.texts, [])
  assert.deepEqual(item.annotations, [])
  assert.deepEqual(item.redactions, [])
  assert.deepEqual(item.elements, [])
})

test('the pool never runs more than its limit, keeps order, and stops on abort', async () => {
  let running = 0
  let peak = 0
  const started: number[] = []
  await runPool([1, 2, 3, 4, 5, 6], 2, async (item) => {
    started.push(item)
    peak = Math.max(peak, ++running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running--
  })
  assert.equal(peak, 2)
  assert.deepEqual(started, [1, 2, 3, 4, 5, 6])

  const controller = new AbortController()
  const seen: number[] = []
  await runPool(
    [1, 2, 3, 4, 5, 6],
    2,
    async (item) => {
      seen.push(item)
      if (item === 2) controller.abort()
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    controller.signal
  )
  assert.deepEqual(seen, [1, 2], 'no new item starts after abort')
})

test('ZIP entries are numbered by the current list, so removed items leave no gaps', () => {
  const story = getSizePreset('instagram-story')!
  const og = getSizePreset('open-graph')!
  const blob = new Blob(['x'])
  const items = [
    {
      name: 'b.png',
      outputs: [
        { blob, target: story },
        { blob, target: og },
      ],
    },
    { name: 'c.png' },
    { name: 'd.png', outputs: [{ blob, target: story }] },
  ]
  assert.deepEqual(
    batchZipEntries(items, { format: 'png', scale: 1 }).map((entry) => entry.path),
    [
      'instagram-story-1080x1920/1-b.png',
      'open-graph-1200x630/1-b.png',
      'instagram-story-1080x1920/3-d.png',
    ]
  )
  assert.deepEqual(
    batchZipEntries([{ name: 'a.png', outputs: [{ blob }] }], { format: 'pdf', scale: 2 }).map(
      (entry) => entry.path
    ),
    ['1-a.pdf']
  )
})

test('a batch run reports progress, keeps going past a failed item, and resets cancelled items', async () => {
  const updates = new Map<string, Record<string, unknown>>()
  const onUpdate = (id: string, update: Record<string, unknown>) =>
    updates.set(id, { ...updates.get(id), ...update })
  const blob = new Blob(['x'])
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const completed = await renderBatch(
    items,
    async (item, onSize) => {
      if (item.id === 'b') throw new Error('The render took too long.')
      onSize(1)
      return [{ blob }]
    },
    onUpdate,
    new AbortController().signal,
    2
  )
  assert.equal(completed, true)
  assert.equal(updates.get('a')!.status, 'done')
  assert.equal(updates.get('a')!.done, 1)
  assert.deepEqual(updates.get('b'), {
    done: 0,
    error: 'The render took too long.',
    outputs: undefined,
    status: 'failed',
  })
  assert.equal(updates.get('c')!.status, 'done')

  // Retrying the failed item clears its error.
  await renderBatch([items[1]!], async () => [{ blob }], onUpdate, new AbortController().signal, 2)
  assert.equal(updates.get('b')!.status, 'done')
  assert.equal(updates.get('b')!.error, undefined)

  const controller = new AbortController()
  const cancelled = await renderBatch(
    items,
    async (_item, _onSize, signal) => {
      controller.abort()
      signal.throwIfAborted()
      return [{ blob }]
    },
    onUpdate,
    controller.signal,
    1
  )
  assert.equal(cancelled, false)
  assert.equal(updates.get('a')!.status, 'pending')
})
