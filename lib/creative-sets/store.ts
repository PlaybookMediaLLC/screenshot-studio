import { textSpanSchema, type StoreDocument } from '@/lib/store-screenshots/document/schema'
import type { CreativeSetDocument, Story } from './document'
import { createAssetMeta } from '@/lib/store-screenshots/document/factory'
import { storeGroupSchema, type StoreGroup } from './store-schema'

/** Resolve content only; the store engine owns geometry, translations and typography. */
export function materializeStoreGroup(
  set: Pick<CreativeSetDocument, 'stories'>,
  group: StoreGroup
): StoreGroup {
  const next = structuredClone(group)
  for (const binding of next.bindings) {
    if (binding.overridden) continue
    const story = set.stories.find((story) => story.id === binding.storyId)
    const layer = next.document.slides
      .find((slide) => slide.id === binding.slideId)
      ?.layers.find((layer) => layer.id === binding.layerId)
    if (!story || !layer) throw new Error('The linked story or store layer is missing.')
    if (
      binding.field === 'source' &&
      (layer.type === 'device' || layer.type === 'image') &&
      binding.assetId
    ) {
      const asset = next.document.assets[binding.assetId]
      if (!asset) throw new Error('The linked store image is missing.')
      if (next.assetMap[binding.assetId] !== story.source.src) next.review.source = true
      layer.assetId = binding.assetId
      next.assetMap[binding.assetId] = story.source.src
      Object.assign(asset, {
        src: null,
        name: story.source.name,
        width: story.source.width,
        height: story.source.height,
      })
    } else if (binding.field === 'focus' && layer.type === 'callout') {
      layer.region = { ...story.focus }
    } else if (
      (binding.field === 'headline' || binding.field === 'supporting') &&
      layer.type === 'text'
    ) {
      const text = story[binding.field]
      if (layer.content.map((span) => span.text).join('') !== text)
        layer.content = [textSpanSchema.parse({ ...layer.content[0], text })]
    }
  }
  return storeGroupSchema.parse(next)
}

/** Direct native edits become explicit exceptions; deleted bound layers stay deleted. */
export function editStoreGroup(group: StoreGroup, document: StoreDocument): StoreGroup {
  const next = structuredClone(group)
  for (const binding of next.bindings) {
    const before = group.document.slides
      .find((slide) => slide.id === binding.slideId)
      ?.layers.find((layer) => layer.id === binding.layerId)
    const after = document.slides
      .find((slide) => slide.id === binding.slideId)
      ?.layers.find((layer) => layer.id === binding.layerId)
    if (!before || !after) {
      binding.overridden = true
      continue
    }
    if (
      binding.field === 'source' &&
      'assetId' in before &&
      'assetId' in after &&
      before.assetId !== after.assetId
    ) {
      binding.overridden = true
      next.review.source = true
    }
    if (
      binding.field !== 'source' &&
      before.type === 'text' &&
      after.type === 'text' &&
      before.content.map((span) => span.text).join('') !==
        after.content.map((span) => span.text).join('')
    )
      binding.overridden = true
    if (
      binding.field === 'focus' &&
      before.type === 'callout' &&
      after.type === 'callout' &&
      JSON.stringify(before.region) !== JSON.stringify(after.region)
    )
      binding.overridden = true
  }
  next.document = structuredClone(document)
  return storeGroupSchema.parse(next)
}

/** Explicitly connect a slide's primary roles to one story, retaining all native styling. */
export function linkStoreSlide(group: StoreGroup, slideId: string, story: Story): StoreGroup {
  const next = structuredClone(group)
  const slide = next.document.slides.find((slide) => slide.id === slideId)
  if (!slide) throw new Error('This slide no longer exists.')
  next.bindings = next.bindings.filter((binding) => binding.slideId !== slideId)
  const headline = slide.layers.find((layer) => layer.type === 'text' && layer.role === 'heading')
  const supporting = slide.layers.find((layer) => layer.type === 'text' && layer.role !== 'heading')
  const product = slide.layers.find((layer) => layer.type === 'device' || layer.type === 'image')
  for (const [field, layer] of [
    ['headline', headline],
    ['supporting', supporting],
    ['source', product],
  ] as const) {
    if (!layer) continue
    let assetId: string | undefined
    if (field === 'source' && 'assetId' in layer) {
      const original = layer.assetId
        ? next.document.assets[layer.assetId]
        : createAssetMeta({
            name: story.source.name,
            mime: 'image/png',
            width: story.source.width,
            height: story.source.height,
            bytes: 0,
          })
      if (!original) throw new Error('The slide screenshot is missing.')
      assetId = crypto.randomUUID()
      next.document.assets[assetId] = { ...original, id: assetId }
      if (layer.assetId && next.assetMap[layer.assetId])
        next.assetMap[assetId] = next.assetMap[layer.assetId]!
      layer.assetId = assetId
    }
    next.bindings.push({
      storyId: story.id,
      slideId,
      layerId: layer.id,
      field,
      assetId,
      overridden: false,
    })
  }
  for (const layer of slide.layers)
    if (layer.type === 'callout' && layer.deviceLayerId === product?.id)
      next.bindings.push({
        storyId: story.id,
        slideId,
        layerId: layer.id,
        field: 'focus',
        overridden: false,
      })
  return storeGroupSchema.parse(next)
}
