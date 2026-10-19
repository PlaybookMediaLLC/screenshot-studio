import test from 'node:test'
import assert from 'node:assert/strict'
import { createCreativeSet } from '../lib/creative-sets/recipes'
import {
  applyReusable,
  detachReusable,
  reusableDefinition,
  reusableOverrides,
  resetReusableField,
} from '../lib/creative-sets/reusable'
import { mergeAssigned } from '../lib/creative-sets/merge-assigned'

const source = {
  id: 'screen',
  revision: 1,
  src: 'asset:00000000-0000-4000-8000-000000000001',
  name: 'screen.png',
  width: 1440,
  height: 900,
}
const make = () =>
  createCreativeSet({
    headline: 'See decisions',
    supporting: '',
    source,
    focus: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    treatment: 'detail-spotlight',
  })

test('published updates preserve changed fields, deleted layers, additions and local order', () => {
  const base = [
    { id: 'a', x: 1, color: 'red' },
    { id: 'b', x: 2 },
    { id: 'c', x: 3 },
  ]
  const local = [
    { id: 'c', x: 9 },
    { id: 'a', x: 1, color: 'blue' },
    { id: 'local', x: 5 },
  ]
  const update = [
    { id: 'a', x: 4, color: 'green' },
    { id: 'b', x: 20 },
    { id: 'c', x: 6 },
    { id: 'new', x: 7 },
  ]
  assert.deepEqual(mergeAssigned(base, local, update), [
    { id: 'c', x: 9 },
    { id: 'a', x: 4, color: 'blue' },
    { id: 'local', x: 5 },
    { id: 'new', x: 7 },
  ])
})

test('a headline block updates by stable role and detaches without changing native output', () => {
  const set = make(),
    output = set.outputs[0]!
  const definition = reusableDefinition(output, 'headline')
  const template = {
    id: 'c1234567890123456789012345',
    name: 'Decision heading',
    version: 1,
    definition,
  }
  let linked = applyReusable(set, output.id, template)
  const first = linked.outputs[0]!
  const headline = first.document.texts.find((layer) => layer.id === first.bindings.headline)!
  headline.position = { x: 12, y: 17 }
  headline.color = '#ff0000'
  headline.text = 'Local headline'
  first.overrides.headline = true
  const updated = structuredClone(definition)
  const published = updated.document.texts.find((layer) => layer.id === updated.slots.headline)!
  published.fontSize = 0.09
  published.color = '#00ff00'
  linked = applyReusable(linked, output.id, {
    ...template,
    id: 'c2234567890123456789012345',
    version: 2,
    definition: updated,
  })
  const result = linked.outputs[0]!.document.texts.find(
    (layer) => layer.id === first.bindings.headline
  )!
  assert.equal(result.fontSize, 0.09)
  assert.equal(result.color, '#ff0000')
  assert.equal(result.text, 'Local headline')
  assert.deepEqual(result.position, { x: 12, y: 17 })
  assert.equal(linked.outputs[0]!.reusable[0]!.version, 2)
  const detached = detachReusable(linked, output.id, 'headline')
  assert.deepEqual(detached.outputs[0]!.document, linked.outputs[0]!.document)
  assert.equal(detached.outputs[0]!.reusable.length, 0)
  assert.throws(() => applyReusable(set, set.outputs[1]!.id, template), /authored for this format/)
})

test('republishing an instance keeps published IDs and a field reset preserves the other exceptions', () => {
  const original = make(),
    target = make()
  const template = {
    id: 'c1234567890123456789012345',
    name: 'Stable proof',
    version: 1,
    definition: reusableDefinition(original.outputs[0]!, 'composition'),
  }
  let applied = applyReusable(target, target.outputs[0]!.id, template)
  const output = applied.outputs[0]!
  output.document.texts[0]!.color = '#ff0000'
  output.document.texts[0]!.position.x = 13
  const republished = reusableDefinition(output, 'composition', template.name)
  assert.equal(republished.document.elements[0]!.id, original.outputs[0]!.document.elements[0]!.id)
  assert.equal(republished.slots.headline, template.definition.slots.headline)
  const field = reusableOverrides(output, 'composition').find(
    (field) => field.owner === 'headline' && field.path[0] === 'color'
  )!
  applied = resetReusableField(applied, output.id, 'composition', field)
  assert.equal(
    applied.outputs[0]!.document.texts[0]!.color,
    template.definition.document.texts[0]!.color
  )
  assert.equal(applied.outputs[0]!.document.texts[0]!.position.x, 13)
})
