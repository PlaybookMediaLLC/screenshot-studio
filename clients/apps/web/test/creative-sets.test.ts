import assert from 'node:assert/strict'
import test from 'node:test'
import { applySetBrand, applySetCommand } from '@/lib/creative-sets/commands'
import { localTextBrandFields, resetTextBrandField } from '@/lib/creative-sets/brand'
import { readBrandKit } from '@/lib/brand/kit'
import { copyProjectIntoSet } from '@/lib/creative-sets/import-project'
import {
  creativeSetDocumentSchema,
  materializeOutput,
  TREATMENTS,
  type Treatment,
} from '@/lib/creative-sets/document'
import { SetHistory } from '@/lib/creative-sets/history'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { screenshotBox, documentCanvasSize } from '@/lib/export/adapt'
import { toCanvasShadow } from '@/components/canvas/utils/shadow-utils'

export const storyFixture = (treatment: Treatment = 'detail-spotlight') =>
  createCreativeSet({
    headline: 'See what needs your decision',
    supporting: 'All approvals, in one place.',
    treatment,
    source: {
      id: 'evidence',
      src: 'asset:11111111-1111-4111-8111-111111111111',
      name: 'approvals.png',
      revision: 1,
      width: 1440,
      height: 900,
    },
    focus: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
  })

test('twelve authored arrangements are native, exact-sized and idempotent', () => {
  for (const treatment of Object.keys(TREATMENTS) as Treatment[]) {
    const set = storyFixture(treatment)
    assert.equal(set.outputs.length, 3)
    assert.deepEqual(
      set.outputs.map((output) => output.document.canvas?.size),
      [
        { width: 1600, height: 900 },
        { width: 1080, height: 1080 },
        { width: 1080, height: 1350 },
      ]
    )
    for (const output of set.outputs) {
      assert.deepEqual(
        materializeOutput(set, output),
        materializeOutput(set, { ...output, document: materializeOutput(set, output) })
      )
    }
  }
})

test('shared copy preserves local wording and reset keeps placement and style', () => {
  let set = storyFixture()
  const portrait = set.outputs[2]!
  portrait.document.texts[0]!.position.x = 41
  portrait.document.texts[0]!.color = '#ff0000'
  set = applySetCommand(set, {
    type: 'output-copy',
    outputId: portrait.id,
    field: 'headline',
    value: 'Your next decision',
  })
  set = applySetCommand(set, {
    type: 'story-copy',
    storyId: set.stories[0]!.id,
    field: 'headline',
    value: 'Decide with confidence',
  })
  assert.deepEqual(
    set.outputs.map((output) => output.document.texts[0]!.text),
    ['Decide with confidence', 'Decide with confidence', 'Your next decision']
  )
  assert.equal(set.outputs[2]!.review.wording, true)
  set = applySetCommand(set, { type: 'reset-copy', outputId: portrait.id, field: 'headline' })
  assert.equal(set.outputs[2]!.document.texts[0]!.text, 'Decide with confidence')
  assert.equal(set.outputs[2]!.document.texts[0]!.position.x, 41)
  assert.equal(set.outputs[2]!.document.texts[0]!.color, '#ff0000')
})

test('bindings follow IDs after layer reorder and preserve deletion until reset', () => {
  let set = storyFixture()
  const output = set.outputs[0]!
  const doc = structuredClone(output.document)
  doc.texts.reverse()
  doc.texts.find((text) => text.id === output.bindings.headline)!.text = 'Custom'
  set = applySetCommand(set, { type: 'native-edit', outputId: output.id, document: doc })
  assert.equal(set.outputs[0]!.overrides.headline, true)
  set = applySetCommand(set, { type: 'promote-copy', outputId: output.id, field: 'headline' })
  assert.equal(set.stories[0]!.headline, 'Custom')
  const deleted = structuredClone(set.outputs[0]!.document)
  deleted.texts = deleted.texts.filter((text) => text.id !== output.bindings.headline)
  set = applySetCommand(set, { type: 'native-edit', outputId: output.id, document: deleted })
  set = applySetCommand(set, {
    type: 'story-copy',
    storyId: set.stories[0]!.id,
    field: 'headline',
    value: 'Changed',
  })
  assert.equal(set.outputs[0]!.document.texts.length, 1)
  set = applySetCommand(set, { type: 'reset-copy', outputId: output.id, field: 'headline' })
  assert.equal(set.outputs[0]!.document.texts.length, 2)
})

test('source update is atomic, requires review, and preserves local adjustments through undo', () => {
  const initial = storyFixture()
  const history = new SetHistory(initial)
  history.commit(
    applySetCommand(history.document, {
      type: 'output-copy',
      outputId: initial.outputs[2]!.id,
      field: 'headline',
      value: 'Local',
    })
  )
  const before = history.document
  history.commit(
    applySetCommand(before, {
      type: 'replace-source',
      storyId: initial.stories[0]!.id,
      source: { ...initial.stories[0]!.source, src: 'asset:22222222-2222-4222-8222-222222222222' },
      focus: { x: 0.7, y: 0.2, width: 0.2, height: 0.2 },
    })
  )
  assert.ok(history.document.outputs.every((output) => output.review.source))
  assert.equal(history.document.outputs[2]!.document.texts[0]!.text, 'Local')
  assert.equal(history.document.stories[0]!.source.revision, 2)
  const after = history.document
  assert.deepEqual(history.undo(), before)
  assert.deepEqual(history.undo(), initial)
  history.redo()
  assert.deepEqual(history.redo(), after)
  assert.deepEqual(initial.stories[0]!.focus, { x: 0.2, y: 0.3, width: 0.2, height: 0.2 })
})

test('future versions, duplicate outputs and invalid focus are refused', () => {
  const set = storyFixture()
  assert.equal(creativeSetDocumentSchema.safeParse({ ...set, version: 99 }).success, false)
  assert.equal(
    creativeSetDocumentSchema.safeParse({
      ...set,
      outputs: [set.outputs[0], set.outputs[0], set.outputs[2]],
    }).success,
    false
  )
  assert.throws(() =>
    applySetCommand(set, {
      type: 'focus',
      storyId: set.stories[0]!.id,
      focus: { x: 0.9, y: 0, width: 0.2, height: 0.2 },
    })
  )
})

test('multiple stories keep source and copy updates scoped; reorder and removal remain reversible', () => {
  const first = storyFixture()
  const second = { ...storyFixture().stories[0]!, headline: 'A different benefit' }
  let set = applySetCommand(first, {
    type: 'add-story',
    story: second,
    treatment: 'editorial-split',
  })
  assert.equal(set.outputs.length, 6)
  const firstOutputs = structuredClone(set.outputs.filter((output) => output.storyId !== second.id))
  set = applySetCommand(set, {
    type: 'story-copy',
    storyId: second.id,
    field: 'headline',
    value: 'Only this benefit',
  })
  set = applySetCommand(set, {
    type: 'replace-source',
    storyId: second.id,
    source: { ...second.source, src: 'asset:22222222-2222-4222-8222-222222222222' },
    focus: second.focus,
  })
  assert.deepEqual(
    set.outputs.filter((output) => output.storyId !== second.id),
    firstOutputs
  )
  assert.ok(
    set.outputs
      .filter((output) => output.storyId === second.id)
      .every((output) => output.review.source)
  )
  const history = new SetHistory(set)
  history.commit(
    applySetCommand(set, { type: 'reorder-stories', storyIds: [second.id, first.stories[0]!.id] })
  )
  assert.equal(history.document.stories[0]!.id, second.id)
  history.commit(applySetCommand(history.document, { type: 'remove-story', storyId: second.id }))
  assert.equal(history.document.outputs.length, 3)
  history.undo()
  assert.equal(history.document.outputs.length, 6)
  history.undo()
  assert.deepEqual(history.document, set)
  assert.throws(() =>
    applySetCommand(first, { type: 'remove-story', storyId: first.stories[0]!.id })
  )
})

test('single-story v1 migration preserves native documents and rejects an orphan binding', () => {
  const set = storyFixture()
  const legacy = {
    ...set,
    version: 1,
    story: set.stories[0],
    outputs: set.outputs.map(({ storyId: _storyId, ...output }) => output),
  }
  const migrated = creativeSetDocumentSchema.parse(legacy)
  assert.deepEqual(migrated, set)
  assert.equal(
    creativeSetDocumentSchema.safeParse({
      ...set,
      outputs: [{ ...set.outputs[0], storyId: 'missing' }],
    }).success,
    false
  )
})

test('legacy project import preserves its complete native original and records origin without mutation', async () => {
  const project = {
    id: 'legacy-project',
    name: 'Existing design',
    revision: 7,
    document: storyFixture().outputs[0]!.document,
  }
  project.document.texts[0]!.position = { x: 23.456, y: 34.567 }
  project.document.texts[1]!.visible = false
  const before = structuredClone(project)
  const set = await copyProjectIntoSet(project, { width: 1440, height: 900 })
  assert.equal(set.outputs.length, 4)
  const original = set.outputs[0]!
  assert.deepEqual(original.document, before.document)
  assert.deepEqual(project, before)
  assert.deepEqual(materializeOutput(set, original), before.document)
  assert.equal(original.origin?.id, project.id)
  assert.equal(original.origin?.revision, 7)
  assert.match(original.origin!.documentHash, /^[a-f0-9]{64}$/)
  const changed = applySetCommand(set, {
    type: 'story-copy',
    storyId: set.stories[0]!.id,
    field: 'headline',
    value: 'New copy',
  })
  assert.deepEqual(changed.outputs[0]!.document, original.document)
  await assert.rejects(
    copyProjectIntoSet(
      { ...project, document: { ...project.document, version: 99 } },
      { width: 1, height: 1 }
    )
  )
})

test('reset one branded style preserves local copy, geometry and other style exceptions', () => {
  const kit = readBrandKit({
    id: 'brand',
    name: 'Example',
    version: 1,
    status: 'ACTIVE',
    definition: {
      colors: { background: '#ffffff', text: '#123456' },
      typography: { headingFamily: 'inter' },
    },
  })!
  let set = applySetBrand(storyFixture(), kit).document
  const output = set.outputs[0]!
  const text = output.document.texts.find((text) => text.id === output.bindings.headline)!
  text.text = 'Local wording'
  text.position.x = 24
  text.color = '#ff0000'
  text.fontFamily = 'poppins'
  const position = structuredClone(text.position)
  assert.ok(localTextBrandFields(output, text.id!).includes('color'))
  set = resetTextBrandField(set, output.id, text.id!, 'color', kit)
  const reset = set.outputs[0]!.document.texts.find((layer) => layer.id === text.id)!
  assert.equal(reset.color, '#123456')
  assert.equal(reset.fontFamily, 'poppins')
  assert.equal(reset.text, 'Local wording')
  assert.deepEqual(reset.position, position)
  assert.ok(!localTextBrandFields(set.outputs[0]!, text.id!).includes('color'))
  assert.throws(() =>
    resetTextBrandField(set, output.id, text.id!, 'fontFamily', { ...kit, version: 2 })
  )
})

test('proof detail fits the selected evidence and avoids empty source edges', () => {
  const set = storyFixture()
  for (const output of set.outputs) {
    const document = materializeOutput(set, output)
    const image = screenshotBox(document, documentCanvasSize(document), 1440 / 900)!
    const detail = document.elements.find((element) => element.type === 'callout')!
    assert.equal(detail.type, 'callout')
    if (detail.type !== 'callout') return
    const width = detail.width / (image.width * detail.props.zoom)
    const height = detail.height / (image.height * detail.props.zoom)
    assert.ok(width >= set.stories[0]!.focus.width - 1e-9)
    assert.ok(height >= set.stories[0]!.focus.height - 1e-9)
    assert.ok(
      width < 0.6 && height < 0.6,
      'detail should magnify the focus, not the whole screenshot'
    )
    assert.ok(detail.props.source.x - width / 2 >= -1e-9)
    assert.ok(detail.props.source.x + width / 2 <= 1 + 1e-9)
    assert.ok(detail.props.source.y - height / 2 >= -1e-9)
    assert.ok(detail.props.source.y + height / 2 <= 1 + 1e-9)
  }
})

test('focus resolution preserves a local crop and does not use shared dimensions for a local source', () => {
  const set = storyFixture()
  const output = set.outputs[0]!
  const detail = output.document.elements[0]!
  assert.equal(detail.type, 'callout')
  if (detail.type !== 'callout') return
  detail.props.zoom = 4.2
  detail.props.source = { x: 0.6, y: 0.7 }
  output.overrides.focus = true
  assert.deepEqual(materializeOutput(set, output).elements, output.document.elements)
  output.overrides.focus = false
  output.overrides.source = true
  output.document.image.src = 'asset:22222222-2222-4222-8222-222222222222'
  assert.deepEqual(materializeOutput(set, output).elements, output.document.elements)
})

test('native shadow opacity is honored, including zero; legacy presets keep their fallback', () => {
  const shadow = { enabled: true, blur: 24, color: '#182520', offsetX: 0, offsetY: 8, spread: 0 }
  assert.equal(toCanvasShadow({ ...shadow, opacity: 0.14 }).intensity, 0.14)
  assert.equal(toCanvasShadow({ ...shadow, opacity: 0 }).intensity, 0)
  assert.equal(toCanvasShadow(shadow).intensity, 0.7)
})

test('screenshot-led posts keep the story as caption copy and allow field-level restoration', () => {
  let set = storyFixture('product-closeup')
  for (const output of set.outputs) {
    const document = materializeOutput(set, output)
    assert.ok(document.texts.every((text) => text.visible === false))
    assert.equal(document.image.opacity, 0)
    assert.equal(document.image.frame?.type, 'none')
    assert.equal(document.image.shadow?.custom?.enabled, false)
    const proof = document.elements[0]!
    assert.equal(proof.type, 'callout')
    if (proof.type === 'callout') assert.equal(proof.props.radius, 0.025)
  }
  assert.equal(set.stories[0]!.headline, 'See what needs your decision')
  set = applySetCommand(set, {
    type: 'story-copy',
    storyId: set.stories[0]!.id,
    field: 'headline',
    value: 'A clearer caption',
  })
  assert.ok(set.outputs.every((output) => !output.review.wording))
  const id = set.outputs[0]!.id
  set = applySetCommand(set, { type: 'reset-copy', outputId: id, field: 'headline' })
  assert.equal(set.outputs[0]!.document.texts[0]!.visible, true)
  assert.equal(set.outputs[1]!.document.texts[0]!.visible, false)
  set = applySetCommand(set, { type: 'layout', outputId: id, treatment: 'product-hero' })
  assert.equal(set.outputs[0]!.document.image.opacity, 1)
  set = applySetCommand(set, { type: 'layout', outputId: id, treatment: 'product-closeup' })
  assert.equal(set.outputs[0]!.document.texts[0]!.visible, false)
  assert.equal(set.outputs[0]!.document.image.opacity, 0)
})
