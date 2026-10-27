import assert from 'node:assert/strict'
import test from 'node:test'
import { createScratchDocument } from '@/lib/store-screenshots/document/factory'
import { applySetCommand } from '@/lib/creative-sets/commands'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { materializeStoreGroup } from '@/lib/creative-sets/store'
import {
  applyStoreBrand,
  resetStoreBrandField,
  storeBrandOverrides,
} from '@/lib/creative-sets/store-brand'
import { readBrandKit } from '@/lib/brand/kit'
import { mergeSetConcurrent } from '@/lib/creative-sets/concurrent'
import { storeGroupSchema } from '@/lib/creative-sets/store-schema'

function fixture() {
  const set = createCreativeSet({
    headline: 'Decide together',
    supporting: 'Keep context',
    treatment: 'product-hero',
    source: {
      id: 'source',
      src: 'asset:11111111-1111-4111-8111-111111111111',
      name: 'screen.png',
      revision: 1,
      width: 1440,
      height: 900,
    },
    focus: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
  })
  const group = storeGroupSchema.parse({
    id: 'store-group',
    kind: 'store',
    name: 'Store listing',
    document: createScratchDocument(),
    assetMap: {},
    bindings: [],
    review: { source: false, wording: false },
  })
  return applySetCommand(set, { type: 'add-store', group })
}

test('store bindings resolve native roles and preserve local native styling and placement', () => {
  let set = fixture()
  const story = set.stories[0]!
  const slideId = set.storeGroups[0]!.document.slides[0]!.id
  set = applySetCommand(set, {
    type: 'link-store-slide',
    groupId: 'store-group',
    storyId: story.id,
    slideId,
  })
  const group = set.storeGroups[0]!
  const headlineBinding = group.bindings.find((binding) => binding.field === 'headline')!
  const sourceBinding = group.bindings.find((binding) => binding.field === 'source')!
  assert.equal(group.assetMap[sourceBinding.assetId!], story.source.src)
  assert.deepEqual(materializeStoreGroup(set, group), group)
  const native = structuredClone(group.document)
  const headline = native.slides[0]!.layers.find((layer) => layer.id === headlineBinding.layerId)!
  assert.equal(headline.type, 'text')
  if (headline.type !== 'text') throw new Error('Expected text')
  headline.content = [{ text: 'Local store copy' }]
  headline.style.color = '#ff0000'
  headline.transform.offsetX = 17
  set = applySetCommand(set, { type: 'store-edit', groupId: group.id, document: native })
  set = applySetCommand(set, {
    type: 'story-copy',
    storyId: story.id,
    field: 'headline',
    value: 'New shared copy',
  })
  assert.deepEqual(
    set.storeGroups[0]!.document.slides[0]!.layers.find((layer) => layer.id === headline.id),
    headline
  )
  set = applySetCommand(set, {
    type: 'reset-store-binding',
    groupId: group.id,
    slideId,
    layerId: headline.id,
  })
  const reset = set.storeGroups[0]!.document.slides[0]!.layers.find(
    (layer) => layer.id === headline.id
  )!
  assert.equal(reset.type, 'text')
  if (reset.type === 'text') {
    assert.equal(reset.content[0]!.text, 'New shared copy')
    assert.equal(reset.style.color, '#ff0000')
    assert.equal(reset.transform.offsetX, 17)
  }
  set = applySetCommand(set, {
    type: 'replace-source',
    storyId: story.id,
    source: { ...story.source, src: 'asset:22222222-2222-4222-8222-222222222222' },
    focus: story.focus,
  })
  assert.equal(set.storeGroups[0]!.review.source, true)
  assert.equal(
    set.storeGroups[0]!.assetMap[sourceBinding.assetId!],
    'asset:22222222-2222-4222-8222-222222222222'
  )
})

test('native store layer deletion remains an override and removing a story detaches its store bindings', () => {
  let set = fixture()
  const original = set.stories[0]!
  set = applySetCommand(set, {
    type: 'add-story',
    story: { ...original, id: 'second' },
    treatment: 'product-hero',
  })
  const group = set.storeGroups[0]!
  set = applySetCommand(set, {
    type: 'link-store-slide',
    groupId: group.id,
    storyId: original.id,
    slideId: group.document.slides[0]!.id,
  })
  const native = structuredClone(set.storeGroups[0]!.document)
  native.slides[0]!.layers = []
  set = applySetCommand(set, { type: 'store-edit', groupId: group.id, document: native })
  assert.ok(set.storeGroups[0]!.bindings.every((binding) => binding.overridden))
  set = applySetCommand(set, { type: 'remove-story', storyId: original.id })
  assert.equal(set.storeGroups[0]!.bindings.length, 0)
  assert.deepEqual(set.storeGroups[0]!.document, native)
})

test('store theme updates preserve local fields and reset restores only the chosen brand field', () => {
  const kit = readBrandKit({
    id: 'brand',
    name: 'Brand',
    version: 1,
    status: 'ACTIVE',
    definition: {
      colors: { background: '#ffffff', text: '#123456' },
      typography: { headingFamily: 'inter' },
    },
  })!
  let group = applyStoreBrand(fixture().storeGroups[0]!, kit)
  group.document.theme.textStyles.heading.color = '#ff0000'
  group.document.theme.textStyles.heading.fontSize = 99
  const updated = { ...kit, version: 2, colors: { ...kit.colors, foreground: '#00ff00' } }
  group = applyStoreBrand(group, updated)
  assert.equal(group.document.theme.textStyles.heading.color, '#ff0000')
  const color = storeBrandOverrides(group).find(
    (field) => field.role === 'heading' && field.field === 'color'
  )!
  group = resetStoreBrandField(group, color)
  assert.equal(group.document.theme.textStyles.heading.color, '#00ff00')
  assert.equal(group.document.theme.textStyles.heading.fontSize, 99)
})

test('store rich-text style edits retain their copy link and coexist with a peer placement edit', () => {
  let base = fixture()
  const group = base.storeGroups[0]!,
    slideId = group.document.slides[0]!.id
  base = applySetCommand(base, {
    type: 'link-store-slide',
    groupId: group.id,
    storyId: base.stories[0]!.id,
    slideId,
  })
  const document = structuredClone(base.storeGroups[0]!.document)
  const binding = base.storeGroups[0]!.bindings.find((binding) => binding.field === 'headline')!
  const layer = document.slides[0]!.layers.find((layer) => layer.id === binding.layerId)!
  if (layer.type !== 'text') throw new Error('Expected text')
  layer.content[0]!.bold = true
  const local = applySetCommand(base, { type: 'store-edit', groupId: group.id, document })
  assert.equal(
    local.storeGroups[0]!.bindings.find((item) => item.layerId === layer.id)!.overridden,
    false
  )
  const peer = structuredClone(base)
  peer.outputs[0]!.document.image.offset = { x: 0.2, y: 0.3 }
  const merged = mergeSetConcurrent(base, local, peer)
  const result = merged.storeGroups[0]!.document.slides[0]!.layers.find(
    (item) => item.id === layer.id
  )!
  assert.deepEqual(result, layer)
  assert.deepEqual(merged.outputs[0]!.document.image.offset, { x: 0.2, y: 0.3 })
  assert.equal(merged.storeGroups[0]!.review.source, base.storeGroups[0]!.review.source)
})

test('store delivery rejects missing assets and bounds stalled font loading', async (context) => {
  const { assertStoreAssetsReady } = await import('@/lib/creative-sets/store-delivery')
  const native = createScratchDocument()
  await assert.rejects(
    assertStoreAssetsReady(native, () => null),
    /Missing asset/
  )
  const original = globalThis.document
  context.mock.timers.enable({ apis: ['setTimeout'] })
  Object.assign(globalThis, { document: { fonts: { ready: new Promise(() => {}) } } })
  try {
    const failed = assert.rejects(
      assertStoreAssetsReady(native, () => 'blob:ready'),
      /Fonts did not finish/
    )
    context.mock.timers.tick(15_000)
    await failed
  } finally {
    Object.assign(globalThis, { document: original })
    context.mock.timers.reset()
  }
})
