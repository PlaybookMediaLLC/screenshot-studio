import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCommand, applyCommands } from '../lib/store-screenshots/commands/apply'
import {
  EMPTY_HISTORY,
  recordHistory,
  redoHistory,
  undoHistory,
  type History,
} from '../lib/store-screenshots/commands/history'
import type { Command } from '../lib/store-screenshots/commands/schema'
import {
  createDeviceLayer,
  createDocument,
  createStandardSlide,
  createTextLayer,
} from '../lib/store-screenshots/document/factory'
import {
  storeDocumentSchema,
  type DeviceLayer,
  type StoreDocument,
  type TextLayer,
} from '../lib/store-screenshots/document/schema'
import { localizedContent } from '../lib/store-screenshots/engine/text'

function project(count = 3): StoreDocument {
  const slides = Array.from({ length: count }, (_, index) =>
    createStandardSlide(`Slide ${index + 1}`, `asset-${index + 1}`, `Heading ${index + 1}`, `Sub ${index + 1}`)
  )
  return createDocument({ name: 'Test', slides })
}

const owner = (document: StoreDocument, index = 0) => ({ kind: 'slide' as const, id: document.slides[index].id })
const devices = (document: StoreDocument, index = 0) =>
  document.slides[index].layers.filter((layer): layer is DeviceLayer => layer.type === 'device')
const texts = (document: StoreDocument, index = 0) =>
  document.slides[index].layers.filter((layer): layer is TextLayer => layer.type === 'text')

test('switching to Duo adds a second device with the next slide screenshot', () => {
  const document = project()
  const next = applyCommand(document, { type: 'slides.setLayout', slideIds: [document.slides[0].id], layout: 'duo' })
  const pair = devices(next)
  assert.equal(pair.length, 2)
  assert.deepEqual(
    pair.map((device) => device.assetId).sort(),
    ['asset-1', 'asset-2'],
    'Duo shows two distinct screenshots'
  )
  const back = applyCommand(next, { type: 'slides.setLayout', slideIds: [document.slides[0].id], layout: 'classic' })
  assert.equal(devices(back).length, 2, 'switching back keeps the second device instead of deleting it')
})

test('device reset leaves text positions alone (UX-04)', () => {
  const document = project()
  const [device] = devices(document)
  const [heading] = texts(document)
  const moved = applyCommands(document, [
    { type: 'layers.patch', owner: owner(document), layerIds: [device.id], patch: { transform: { offsetX: 10, rotation: 8 } } },
    { type: 'layers.patch', owner: owner(document), layerIds: [heading.id], patch: { transform: { offsetY: 5 } } },
  ])
  const reset = applyCommand(moved, { type: 'reset.devices', owner: owner(moved), layerIds: [device.id] })
  assert.equal(devices(reset)[0].transform.offsetX, 0)
  assert.equal(devices(reset)[0].transform.rotation, 0)
  assert.equal(texts(reset)[0].transform.offsetY, 5, 'heading keeps its manual position')
  const textReset = applyCommand(reset, { type: 'reset.text', owner: owner(reset), layerIds: [heading.id], scope: 'position' })
  assert.equal(texts(textReset)[0].transform.offsetY, 0)
})

test('apply to slides copies only the chosen property groups (UX-08, F18)', () => {
  const document = project(3)
  const source = document.slides[0]
  const styled = applyCommands(document, [
    { type: 'slides.patch', slideIds: [source.id], patch: { background: { kind: 'solid', color: '#123456' } } },
    {
      type: 'layers.patch',
      owner: owner(document),
      layerIds: [texts(document)[0].id],
      patch: { style: { fontFamily: 'var(--font-sora), system-ui, sans-serif', fontWeight: 800, color: '#FF00FF' } },
    },
    { type: 'layers.patch', owner: owner(document), layerIds: [devices(document)[0].id], patch: { frame: { modelId: 'pixel-10-pro', finishId: 'jade' } } },
  ])
  const applied = applyCommand(styled, {
    type: 'slides.applyStyle',
    sourceSlideId: source.id,
    slideIds: [styled.slides[1].id],
    groups: ['background', 'typography', 'deviceFrame'],
  })
  assert.deepEqual(applied.slides[1].background, { kind: 'solid', color: '#123456' })
  assert.equal(texts(applied, 1)[0].style.fontWeight, 800)
  assert.equal(texts(applied, 1)[0].style.color, undefined, 'colors were not selected')
  assert.equal(devices(applied, 1)[0].frame.modelId, 'pixel-10-pro')
  assert.equal(texts(applied, 1)[0].content[0].text, 'Heading 2', 'content is never copied')
  assert.equal(applied.slides[2], styled.slides[2], 'unselected slides are untouched')
})

test('font change for selected slides only and one undo restores it (Workflow C)', () => {
  const document = project(10)
  const selected = document.slides.slice(0, 7).map((slide) => slide.id)
  let history: History = EMPTY_HISTORY
  const command: Command = { type: 'slides.patchText', slideIds: selected, roles: ['heading', 'subheading', 'body'], style: { fontFamily: 'var(--font-lora), Georgia, serif' } }
  const next = applyCommand(document, command, 1000)
  history = recordHistory(history, document, 'font', null, 1000)
  assert.equal(next.slides.filter((slide) => texts({ ...next, slides: [slide] })[0].style.fontFamily?.includes('lora')).length, 7)
  assert.equal(texts(next, 8)[0].style.fontFamily, undefined)
  const undone = undoHistory(history, next)!
  assert.equal(undone.document, document)
})

test('moving a slide keeps panorama members together and in order (F08)', () => {
  const document = project(5)
  const ids = document.slides.map((slide) => slide.id)
  const withPanorama = applyCommand(document, { type: 'panorama.create', slideIds: [ids[1], ids[2]] })
  assert.equal(withPanorama.panoramas.length, 1)
  const moved = applyCommand(withPanorama, { type: 'slides.move', slideIds: [ids[2]], toIndex: 3 })
  const order = moved.slides.map((slide) => slide.id)
  assert.equal(order.indexOf(ids[2]) - order.indexOf(ids[1]), 1, 'panorama stays contiguous')
  const reordered = applyCommand(withPanorama, { type: 'slides.reorder', order: [ids[2], ids[0], ids[3], ids[1], ids[4]] })
  const after = reordered.slides.map((slide) => slide.id)
  assert.equal(after.indexOf(ids[2]) - after.indexOf(ids[1]), 1)
})

test('detaching a panorama keeps the continuous look on each slide', () => {
  const document = project(3)
  const ids = document.slides.map((slide) => slide.id)
  const created = applyCommand(document, { type: 'panorama.create', slideIds: ids })
  const panoramaId = created.panoramas[0].id
  const withLayer = applyCommand(created, {
    type: 'layers.add',
    owner: { kind: 'panorama', id: panoramaId },
    layers: [createDeviceLayer('wide', 0, undefined, { placement: { mode: 'free', x: 50, y: 50, width: 20 } })],
  })
  const detached = applyCommand(withLayer, { type: 'panorama.detach', panoramaId })
  assert.equal(detached.panoramas.length, 0)
  assert.deepEqual(detached.slides.map((slide) => slide.backgroundSpan), [
    { count: 3, index: 0 },
    { count: 3, index: 1 },
    { count: 3, index: 2 },
  ])
  const middleDevice = devices(detached, 1).find((device) => device.assetId === 'wide')
  assert.ok(middleDevice && middleDevice.placement.mode === 'free')
  assert.equal(middleDevice.placement.mode === 'free' && middleDevice.placement.x, 50)
  assert.equal(devices(detached, 0).some((device) => device.assetId === 'wide'), false)
})

test('the last slide cannot be deleted and duplicates get fresh ids', () => {
  const document = project(1)
  assert.equal(applyCommand(document, { type: 'slides.delete', slideIds: [document.slides[0].id] }), document)
  const duplicated = applyCommand(document, { type: 'slides.duplicate', slideIds: [document.slides[0].id] })
  assert.equal(duplicated.slides.length, 2)
  assert.notEqual(duplicated.slides[1].id, duplicated.slides[0].id)
  const layerIds = new Set(duplicated.slides[0].layers.map((layer) => layer.id))
  assert.ok(duplicated.slides[1].layers.every((layer) => !layerIds.has(layer.id)))
})

test('invalid patches are rejected instead of corrupting the document', () => {
  const document = project(1)
  const [heading] = texts(document)
  const next = applyCommand(document, {
    type: 'layers.patch',
    owner: owner(document),
    layerIds: [heading.id],
    patch: { opacity: 0.5, style: { fontSize: 9999 } },
  })
  assert.equal(next, document)
  assert.equal(storeDocumentSchema.safeParse(applyCommand(document, { type: 'slides.duplicate', slideIds: [document.slides[0].id] })).success, true)
})

test('translations go outdated when the source changes and approval refreshes them (F13)', () => {
  const document = project(1)
  const [heading] = texts(document)
  const translated = applyCommand(document, {
    type: 'text.translate',
    entries: [{ slideId: document.slides[0].id, layerId: heading.id, locale: 'de-DE', content: [{ text: 'Überschrift' }], status: 'approved' }],
  })
  assert.equal(localizedContent(texts(translated)[0], 'de-DE', 'en-US').state, 'translated')
  const edited = applyCommand(translated, { type: 'layers.patch', owner: owner(translated), layerIds: [heading.id], patch: { content: [{ text: 'New source' }] } })
  const state = localizedContent(texts(edited)[0], 'de-DE', 'en-US')
  assert.equal(state.state, 'outdated')
  assert.equal(state.content[0].text, 'Überschrift', 'approved translation is not overwritten')
  const approved = applyCommand(edited, { type: 'text.setTranslationStatus', slideId: edited.slides[0].id, layerId: heading.id, locale: 'de-DE', status: 'approved' })
  assert.equal(localizedContent(texts(approved)[0], 'de-DE', 'en-US').state, 'translated')
})

test('applying a copy suggestion keeps the replaced copy available (F14)', () => {
  const document = project(1)
  const remembered = applyCommand(document, {
    type: 'copy.remember',
    suggestions: [{ id: 's1', slideId: document.slides[0].id, locale: 'en-US', headline: 'Train smarter', subheadline: 'Plans that adapt', tone: 'confident' }],
  })
  const applied = applyCommand(remembered, { type: 'copy.apply', suggestionId: 's1' })
  assert.equal(texts(applied)[0].content[0].text, 'Train smarter')
  const previous = applied.copySuggestions.find((item) => item.tone === 'previous')
  assert.equal(previous?.headline, 'Heading 1')
  assert.ok(applied.copySuggestions.find((item) => item.id === 's1')?.appliedAt)
})

test('layer arrange, group, and delete keep dependent callouts consistent (F16)', () => {
  const document = project(1)
  const [device] = devices(document)
  const callout = {
    ...createTextLayer('body', 'x'),
  }
  void callout
  const withCallout = applyCommand(document, {
    type: 'layers.add',
    owner: owner(document),
    layers: [
      {
        id: 'callout-1',
        name: 'Callout',
        hidden: false,
        locked: false,
        groupId: null,
        opacity: 1,
        transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, tiltX: 0, tiltY: 0 },
        type: 'callout',
        deviceLayerId: device.id,
        region: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
        placement: { mode: 'free', x: 70, y: 40, width: 30 },
        shape: 'circle',
        borderWidth: 6,
        borderColor: '#FFFFFF',
        shadow: 40,
        connector: true,
      },
    ],
  })
  const front = applyCommand(withCallout, { type: 'layers.arrange', owner: owner(withCallout), layerIds: [device.id], move: 'front' })
  assert.equal(front.slides[0].layers.at(-1)?.id, device.id)
  const grouped = applyCommand(front, { type: 'layers.group', owner: owner(front), layerIds: [device.id, 'callout-1'], groupId: 'g' })
  assert.equal(grouped.slides[0].layers.filter((layer) => layer.groupId === 'g').length, 2)
  const deleted = applyCommand(grouped, { type: 'layers.delete', owner: owner(grouped), layerIds: [device.id] })
  assert.equal(deleted.slides[0].layers.some((layer) => layer.id === 'callout-1'), false)
})

test('forty edits undo and redo back to the exact documents (Workflow J)', () => {
  let document = project(3)
  let history: History = EMPTY_HISTORY
  const snapshots: StoreDocument[] = [document]
  for (let step = 0; step < 40; step += 1) {
    const slide = document.slides[step % 3]
    const command: Command =
      step % 4 === 0
        ? { type: 'slides.setLayout', slideIds: [slide.id], layout: (['hero', 'duo', 'minimal', 'offset'] as const)[step % 4 === 0 ? (step / 4) % 4 : 0] }
        : step % 4 === 1
          ? { type: 'layers.patch', owner: { kind: 'slide', id: slide.id }, layerIds: [slide.layers[0].id], patch: { transform: { rotation: step % 20 } } }
          : step % 4 === 2
            ? { type: 'slides.patch', slideIds: [slide.id], patch: { background: { kind: 'solid', color: `#${(step * 111111).toString(16).padStart(6, '0').slice(0, 6)}` } } }
            : { type: 'slides.move', slideIds: [slide.id], toIndex: (step + 1) % 3 }
    const next = applyCommand(document, command, step * 1000)
    if (next !== document) {
      history = recordHistory(history, document, command.type, null, step * 1000)
      document = next
      snapshots.push(document)
    }
  }
  assert.ok(snapshots.length > 30)
  for (let index = snapshots.length - 2; index >= 0; index -= 1) {
    const result = undoHistory(history, document)!
    history = result.history
    document = result.document
    assert.equal(document, snapshots[index])
  }
  assert.equal(undoHistory(history, document), null)
  for (let index = 1; index < snapshots.length; index += 1) {
    const result = redoHistory(history, document)!
    history = result.history
    document = result.document
    assert.equal(document, snapshots[index])
  }
})

test('continuous gestures coalesce into one undo step', () => {
  const document = project(1)
  let history = recordHistory(EMPTY_HISTORY, document, 'Move', 'drag:a', 0)
  history = recordHistory(history, { ...document }, 'Move', 'drag:a', 300)
  history = recordHistory(history, { ...document }, 'Move', 'drag:a', 900)
  assert.equal(history.past.length, 1)
  assert.equal(history.past[0].document, document)
  history = recordHistory(history, { ...document }, 'Move', 'drag:a', 2000)
  assert.equal(history.past.length, 2)
})
