import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCanvasCommand } from '@/lib/canvas/commands'
import {
  createComponent,
  instanceLayerId,
  instanceLayers,
  reconcileInstance,
  type ComponentInstance,
} from '@/lib/canvas/components'
import {
  canvasDocumentSchema,
  sizedDesignDocument,
  type CanvasDocument,
} from '@/lib/canvas/document'
import {
  duplicateLayers,
  ensureLayerIds,
  groupLayers,
  layerRefs,
  pruneGroups,
  removeLayers,
  setLayersVisible,
  translateLayers,
  ungroupLayers,
  type LayerRef,
} from '@/lib/canvas/layers'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { createElement } from '@/lib/editor/elements/schema'

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} ≉ ${expected}`)

/** A 1000×500 artboard with one of each movable layer kind. */
function layered(): DesignDocument {
  return designDocumentSchema.parse({
    ...sizedDesignDocument({ width: 1000, height: 500 }),
    texts: [
      { id: 't1', text: 'Headline', fontSize: 0.05, position: { x: 20, y: 30 } },
      { text: 'No id yet', fontSize: 0.03, position: { x: 50, y: 50 } },
    ],
    overlays: [
      {
        id: 'o1',
        src: 'asset:11111111-1111-4111-8111-111111111111',
        size: 0.2,
        position: { x: 0.3, y: 0.4 },
      },
    ],
    annotations: [
      {
        id: 'a1',
        type: 'rectangle',
        start: { x: 0.1, y: 0.1 },
        end: { x: 0.3, y: 0.2 },
        radius: 0.25,
      },
    ],
    elements: [createElement('cursor', { aspect: 2, id: 'e1', x: 0.5, y: 0.5 })],
  })
}

const T1: LayerRef = { kind: 'text', id: 't1' }
const O1: LayerRef = { kind: 'overlay', id: 'o1' }
const A1: LayerRef = { kind: 'annotation', id: 'a1' }

test('layer references cover every section and ids are filled in once', () => {
  const document = layered()
  assert.deepEqual(
    layerRefs(document).map((ref) => `${ref.kind}:${ref.id}`),
    ['text:t1', 'overlay:o1', 'annotation:a1', 'element:e1']
  )
  let n = 0
  const filled = ensureLayerIds(document, () => `new-${++n}`)
  assert.equal(filled.texts[1]!.id, 'new-1')
  assert.equal(filled.texts[0]!.id, 't1')
  assert.equal(document.texts[1]!.id, undefined, 'the input is not mutated')
})

test('translating layers moves each kind in its own units and stays in bounds', () => {
  const moved = translateLayers(layered(), [T1, O1, A1, { kind: 'element', id: 'e1' }], 0.1, -0.05)
  close(moved.texts[0]!.position.x, 30)
  close(moved.texts[0]!.position.y, 25)
  close(moved.texts[1]!.position.x, 50, 'unselected layers stay')
  close(moved.overlays[0]!.position.x, 0.4)
  close(moved.annotations[0]!.start.x, 0.2)
  close(moved.annotations[0]!.end.y, 0.15)
  close(moved.elements[0]!.x, 0.6)
  const far = translateLayers(layered(), [O1], 5, 5)
  assert.deepEqual(far.overlays[0]!.position, { x: 1, y: 1 })
})

test('duplicate, hide and remove work on references', () => {
  const { document, copies } = duplicateLayers(
    layered(),
    [T1, A1],
    () => 'copy-' + Math.random().toString(36).slice(2, 8)
  )
  assert.equal(document.texts.length, 3)
  assert.equal(document.annotations.length, 2)
  assert.equal(copies.length, 2)
  close(document.texts[2]!.position.x, 22)
  assert.equal(document.texts[2]!.text, 'Headline')
  const hidden = setLayersVisible(document, copies, false)
  assert.equal(hidden.texts[2]!.visible, false)
  assert.equal(hidden.texts[0]!.visible, undefined)
  const removed = removeLayers(hidden, copies)
  assert.equal(removed.texts.length, 2)
  assert.equal(removed.annotations.length, 1)
})

test('groups take whole groups along, dissolve below two layers and prune deleted layers', () => {
  const groups = groupLayers([], [T1, O1], { id: 'g1', name: 'Hero' })
  assert.equal(groups.length, 1)
  // Grouping a member of g1 with another layer takes all of g1 along and replaces it.
  const regrouped = groupLayers(groups, [T1, A1], { id: 'g2', name: 'All' })
  assert.deepEqual(
    regrouped.map((group) => group.id),
    ['g2']
  )
  assert.equal(regrouped[0]!.layers.length, 3)
  assert.throws(() => groupLayers([], [T1], { id: 'g3', name: 'One' }), /two layers/)
  const pruned = pruneGroups(removeLayers(layered(), [O1]), groups)
  assert.deepEqual(pruned, [], 'a group left with one layer dissolves')
  assert.deepEqual(ungroupLayers(regrouped, 'g2'), [])
})

function canvasWith(document: DesignDocument): CanvasDocument {
  return canvasDocumentSchema.parse({
    version: 1,
    kind: 'canvas',
    artboards: [
      { id: 'a', name: 'Hero', x: 0, y: 0, document },
      {
        id: 'b',
        name: 'Wide',
        x: 1200,
        y: 0,
        document: sizedDesignDocument({ width: 2000, height: 500 }),
      },
    ],
  })
}

let counter = 0
const short = () => `m${++counter}`

test('a component made from layers turns them into its first instance in place', () => {
  const document = layered()
  const made = createComponent(document, [T1, A1], {
    componentId: 'c1',
    instanceId: 'i1',
    name: 'Badge',
    frame: { x: 100, y: 50, width: 200, height: 150 },
    newId: short,
  })
  assert.equal(made.component.layers.length, 2)
  const textId = made.component.layers[0]!.layer.id!
  assert.equal(made.document.texts[0]!.id, instanceLayerId('i1', textId))
  // The instance draws exactly the layers it was made from.
  const drawn = instanceLayers(made.component, made.instance, { width: 1000, height: 500 })
  const text = drawn.get(textId)!.layer as DesignDocument['texts'][number]
  close(text.position.x, 20)
  close(text.position.y, 30)
  close(text.fontSize, 0.05)
  assert.equal(
    reconcileInstance(made.document, made.component, made.instance)!.overrides['x'],
    undefined
  )
  assert.deepEqual(reconcileInstance(made.document, made.component, made.instance)!.overrides, {})
})

test('instances keep overrides, follow their component, move as a whole, reset and detach', () => {
  const made = createComponent(layered(), [T1, A1], {
    componentId: 'c1',
    instanceId: 'i1',
    name: 'Badge',
    frame: { x: 100, y: 50, width: 200, height: 150 },
    newId: short,
  })
  const [textMain, shapeMain] = made.component.layers.map((item) => item.layer.id!)
  let canvas = applyCanvasCommand(canvasWith(layered()), {
    type: 'add-component',
    component: made.component,
    artboardId: 'a',
    instance: made.instance,
    document: made.document,
  })
  // Place a second instance on the wide artboard, at its own offset.
  const second: ComponentInstance = {
    id: 'i2',
    componentId: 'c1',
    version: 1,
    x: 1000,
    y: 100,
    scale: 1,
    overrides: {},
  }
  canvas = applyCanvasCommand(canvas, {
    type: 'insert-instance',
    artboardId: 'b',
    instance: second,
  })
  const wide = () => canvas.artboards[1]!.document
  const wideText = () => wide().texts.find((text) => text.id === instanceLayerId('i2', textMain!))!
  // The text sits at (200, 150)px, the frame at (100, 50)px; placed at (1000, 100)px it lands at
  // (1100, 200)px of 2000×500.
  close(wideText().position.x, 55)
  close(wideText().position.y, 40)
  // Same pixel size on a wider artboard: half the fraction of the width.
  close(wideText().fontSize, 0.025)

  // Override the copy of the second instance.
  const edited = structuredClone(wide())
  edited.texts.find((text) => text.id === instanceLayerId('i2', textMain!))!.text = 'Local copy'
  canvas = applyCanvasCommand(canvas, { type: 'native-edit', id: 'b', document: edited })
  assert.deepEqual(canvas.artboards[1]!.instances[0]!.overrides, {
    [textMain!]: { text: 'Local copy' },
  })

  // Change the main component through the first instance: colour and copy.
  const hero = structuredClone(canvas.artboards[0]!.document)
  const heroText = hero.texts.find((text) => text.id === instanceLayerId('i1', textMain!))!
  heroText.text = 'Main copy'
  heroText.color = '#ff0000'
  canvas = applyCanvasCommand(canvas, { type: 'native-edit', id: 'a', document: hero })
  canvas = applyCanvasCommand(canvas, {
    type: 'update-component',
    artboardId: 'a',
    instanceId: 'i1',
  })
  assert.equal(canvas.components[0]!.version, 2)
  assert.deepEqual(canvas.artboards[0]!.instances[0]!.overrides, {})
  assert.equal(wideText().text, 'Local copy', 'the override wins')
  assert.equal(wideText().color, '#ff0000', 'everything else follows the main component')
  assert.equal(canvas.artboards[1]!.instances[0]!.version, 2)

  // Moving every layer of an instance moves the instance instead of overriding positions.
  const moved = structuredClone(wide())
  const ids = [instanceLayerId('i2', textMain!), instanceLayerId('i2', shapeMain!)]
  const shifted = translateLayers(
    moved,
    [
      { kind: 'text', id: ids[0]! },
      { kind: 'annotation', id: ids[1]! },
    ],
    0.05,
    0
  )
  canvas = applyCanvasCommand(canvas, { type: 'native-edit', id: 'b', document: shifted })
  const instance = canvas.artboards[1]!.instances[0]!
  close(instance.x, 1100)
  assert.deepEqual(Object.keys(instance.overrides), [textMain])

  // Deleting an instance layer hides it; reset brings it back and drops overrides.
  const without = removeLayers(wide(), [{ kind: 'annotation', id: ids[1]! }])
  canvas = applyCanvasCommand(canvas, { type: 'native-edit', id: 'b', document: without })
  assert.deepEqual(canvas.artboards[1]!.instances[0]!.overrides[shapeMain!], { visible: false })
  canvas = applyCanvasCommand(canvas, { type: 'reset-instance', artboardId: 'b', instanceId: 'i2' })
  assert.equal(wideText().text, 'Main copy')
  assert.equal(wide().annotations.length, 1)
  assert.equal(wide().annotations[0]!.radius, 0.25, 'corner radius travels with the component')

  // Detaching leaves plain layers; removing the component keeps its instances' layers.
  canvas = applyCanvasCommand(canvas, {
    type: 'detach-instance',
    artboardId: 'b',
    instanceId: 'i2',
  })
  assert.equal(canvas.artboards[1]!.instances.length, 0)
  assert.equal(wide().texts.length, 1)
  canvas = applyCanvasCommand(canvas, { type: 'remove-component', componentId: 'c1' })
  assert.equal(canvas.components.length, 0)
  assert.equal(canvas.artboards[0]!.instances.length, 0)
  assert.equal(canvas.artboards[0]!.document.texts.length, 2)
})

test('an instance whose layers were all deleted is removed', () => {
  const made = createComponent(layered(), [T1], {
    componentId: 'c9',
    instanceId: 'i9',
    name: 'Solo',
    frame: { x: 150, y: 120, width: 100, height: 40 },
    newId: short,
  })
  let canvas = applyCanvasCommand(canvasWith(layered()), {
    type: 'add-component',
    component: made.component,
    artboardId: 'a',
    instance: made.instance,
    document: made.document,
  })
  const layer: LayerRef = { kind: 'text', id: made.document.texts[0]!.id! }
  canvas = applyCanvasCommand(canvas, {
    type: 'set-artboard-layers',
    id: 'a',
    document: removeLayers(canvas.artboards[0]!.document, [layer]),
    groups: [],
  })
  assert.equal(canvas.artboards[0]!.instances.length, 0)
  assert.equal(canvas.components.length, 1, 'the component stays available to insert again')
})

test('set-artboard-layers stores groups and prunes ones that lost their layers', () => {
  const document = layered()
  const canvas = applyCanvasCommand(canvasWith(document), {
    type: 'set-artboard-layers',
    id: 'a',
    document: removeLayers(document, [O1]),
    groups: groupLayers([], [T1, O1, A1], { id: 'g', name: 'Group' }),
  })
  assert.deepEqual(
    canvas.artboards[0]!.groups[0]!.layers.map((ref) => ref.id),
    ['t1', 'a1']
  )
})
