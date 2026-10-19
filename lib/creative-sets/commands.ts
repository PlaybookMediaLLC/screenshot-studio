import { z } from 'zod'
import { applyBrandKit } from '@/lib/brand/apply'
import type { BrandKit } from '@/lib/brand/kit'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import {
  contentFieldSchema,
  creativeSetDocumentSchema,
  focusRegionSchema,
  identifyLayers,
  materializeOutput,
  sourceSchema,
  storySchema,
  storyForOutput,
  creativeOutputSchema,
  STORY_FORMATS,
  treatmentSchema,
  type ContentField,
  type CreativeOutput,
  type CreativeSetDocument,
  type StoryFormat,
} from './document'
import { composeOutput } from './recipes'
import { storeDocumentSchema } from '@/lib/store-screenshots/document/schema'
import { storeGroupSchema } from './store-schema'
import { editStoreGroup, linkStoreSlide, materializeStoreGroup } from './store'
import { applyStoreBrand, type StoreBrandLogo } from './store-brand'

const outputId = z.string().min(1).max(80)
export const setCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('story-copy'),
    storyId: outputId,
    field: contentFieldSchema,
    value: z.string().max(300),
  }),
  z.object({
    type: z.literal('output-copy'),
    outputId,
    field: contentFieldSchema,
    value: z.string().max(300),
  }),
  z.object({ type: z.literal('reset-copy'), outputId, field: contentFieldSchema }),
  z.object({ type: z.literal('promote-copy'), outputId, field: contentFieldSchema }),
  z.object({ type: z.literal('native-edit'), outputId, document: designDocumentSchema }),
  z.object({
    type: z.literal('replace-source'),
    storyId: outputId,
    source: sourceSchema,
    focus: focusRegionSchema,
  }),
  z.object({ type: z.literal('focus'), storyId: outputId, focus: focusRegionSchema }),
  z.object({ type: z.literal('add-story'), story: storySchema, treatment: treatmentSchema }),
  z.object({
    type: z.literal('import-story'),
    story: storySchema,
    outputs: z.array(creativeOutputSchema).min(1).max(4),
  }),
  z.object({ type: z.literal('remove-story'), storyId: outputId }),
  z.object({ type: z.literal('reorder-stories'), storyIds: z.array(outputId).min(1).max(20) }),
  z.object({ type: z.literal('reviewed'), outputId }),
  z.object({ type: z.literal('reset-evidence'), outputId, field: z.enum(['source', 'focus']) }),
  z.object({ type: z.literal('reset-dimensions'), outputId }),
  z.object({ type: z.literal('layout'), outputId, treatment: treatmentSchema }),
  z.object({ type: z.literal('add-store'), group: storeGroupSchema }),
  z.object({ type: z.literal('store-edit'), groupId: outputId, document: storeDocumentSchema }),
  z.object({
    type: z.literal('link-store-slide'),
    groupId: outputId,
    slideId: outputId,
    storyId: outputId,
  }),
  z.object({
    type: z.literal('reset-store-binding'),
    groupId: outputId,
    slideId: outputId,
    layerId: outputId,
  }),
  z.object({ type: z.literal('review-store'), groupId: outputId }),
])
export type SetCommand = z.infer<typeof setCommandSchema>

function outputFor(set: CreativeSetDocument, id: string): CreativeOutput {
  const output = set.outputs.find((output) => output.id === id)
  if (!output) throw new Error('This format no longer exists.')
  return output
}

function setCopy(output: CreativeOutput, field: ContentField, value: string) {
  let layer = output.document.texts.find((text) => text.id === output.bindings[field])
  if (!layer) {
    // A reset can restore a deleted managed text without touching other layers.
    layer = designDocumentSchema.shape.texts.unwrap().element.parse({
      id: output.bindings[field],
      text: ' ',
      fontSize: 0.04,
      position: { x: 50, y: 15 },
    })
    output.document.texts.push(layer)
  }
  layer.text = value || ' '
  layer.visible = Boolean(value)
}

/** One validated command produces one complete snapshot, including all linked outputs. */
export function applySetCommand(
  current: CreativeSetDocument,
  input: SetCommand
): CreativeSetDocument {
  const command = setCommandSchema.parse(input)
  const set = structuredClone(current)
  switch (command.type) {
    case 'story-copy': {
      const story = set.stories.find((story) => story.id === command.storyId)
      if (!story) throw new Error('This story no longer exists.')
      if (command.field === 'headline' && !command.value.trim())
        throw new Error('Enter a headline.')
      story[command.field] = command.value
      for (const output of set.outputs.filter((output) => output.storyId === story.id))
        if (
          output.overrides[command.field] &&
          output.document.texts.some(
            (text) => text.id === output.bindings[command.field] && text.visible !== false
          )
        )
          output.review.wording = true
      for (const group of set.storeGroups)
        if (
          group.bindings.some(
            (binding) =>
              binding.storyId === story.id && binding.field === command.field && binding.overridden
          )
        )
          group.review.wording = true
      break
    }
    case 'output-copy': {
      const output = outputFor(set, command.outputId)
      output.overrides[command.field] = true
      setCopy(output, command.field, command.value)
      break
    }
    case 'reset-copy': {
      const output = outputFor(set, command.outputId)
      output.overrides[command.field] = false
      setCopy(output, command.field, storyForOutput(set, output)[command.field])
      break
    }
    case 'promote-copy': {
      const output = outputFor(set, command.outputId)
      const layer = output.document.texts.find((text) => text.id === output.bindings[command.field])
      const value = layer?.visible === false ? '' : (layer?.text ?? '')
      if (command.field === 'headline' && !value.trim())
        throw new Error('Enter a headline before sharing it.')
      const story = storyForOutput(set, output)
      story[command.field] = value
      output.overrides[command.field] = false
      for (const other of set.outputs.filter((other) => other.storyId === story.id))
        if (
          other.overrides[command.field] &&
          other.document.texts.some(
            (text) => text.id === other.bindings[command.field] && text.visible !== false
          )
        )
          other.review.wording = true
      break
    }
    case 'native-edit': {
      const output = outputFor(set, command.outputId)
      const before = materializeOutput(set, output)
      const next = identifyLayers(command.document)
      for (const field of contentFieldSchema.options) {
        const oldLayer = before.texts.find((text) => text.id === output.bindings[field])
        const layer = next.texts.find((text) => text.id === output.bindings[field])
        if (layer?.text !== oldLayer?.text || layer?.visible !== oldLayer?.visible)
          output.overrides[field] = true
      }
      if (next.image.src !== before.image.src) {
        output.overrides.source = true
        output.review.source = true
        output.review.redactions = next.redactions.length > 0
      }
      const previousFocus = before.elements.find((element) => element.id === output.bindings.focus)
      const focus = next.elements.find((element) => element.id === output.bindings.focus)
      if (
        focus?.type === 'callout' &&
        previousFocus?.type === 'callout' &&
        (JSON.stringify(focus.props.source) !== JSON.stringify(previousFocus.props.source) ||
          focus.props.zoom !== previousFocus.props.zoom)
      )
        output.overrides.focus = true
      output.document = next
      break
    }
    case 'replace-source': {
      const story = set.stories.find((story) => story.id === command.storyId)
      if (!story) throw new Error('This story no longer exists.')
      if (command.source.src === story.source.src) throw new Error('Choose a new screenshot.')
      story.source = {
        ...command.source,
        id: story.source.id,
        revision: story.source.revision + 1,
      }
      story.focus = command.focus
      for (const output of set.outputs.filter((output) => output.storyId === story.id)) {
        if (!output.overrides.source) {
          output.review.source = true
          output.review.redactions = output.document.redactions.length > 0
        }
      }
      break
    }
    case 'focus': {
      const story = set.stories.find((story) => story.id === command.storyId)
      if (!story) throw new Error('This story no longer exists.')
      story.focus = command.focus
      break
    }
    case 'add-story': {
      if (set.stories.some((story) => story.id === command.story.id))
        throw new Error('This story already exists.')
      set.stories.push(command.story)
      for (const format of Object.keys(STORY_FORMATS) as StoryFormat[])
        set.outputs.push(
          composeOutput(command.story, format, command.treatment, crypto.randomUUID())
        )
      break
    }
    case 'import-story': {
      if (set.stories.some((story) => story.id === command.story.id))
        throw new Error('This story already exists.')
      if (command.outputs.some((output) => output.storyId !== command.story.id))
        throw new Error('Imported outputs must belong to the imported story.')
      set.stories.push(command.story)
      set.outputs.push(...command.outputs)
      break
    }
    case 'remove-story': {
      if (set.stories.length === 1) throw new Error('Keep at least one story.')
      if (!set.stories.some((story) => story.id === command.storyId))
        throw new Error('This story no longer exists.')
      set.stories = set.stories.filter((story) => story.id !== command.storyId)
      set.outputs = set.outputs.filter((output) => output.storyId !== command.storyId)
      for (const group of set.storeGroups)
        group.bindings = group.bindings.filter((binding) => binding.storyId !== command.storyId)
      break
    }
    case 'reorder-stories': {
      if (
        command.storyIds.length !== set.stories.length ||
        new Set(command.storyIds).size !== set.stories.length
      )
        throw new Error('Keep every story when changing the reading order.')
      set.stories = command.storyIds.map((id) => {
        const story = set.stories.find((story) => story.id === id)
        if (!story) throw new Error('This story no longer exists.')
        return story
      })
      break
    }
    case 'reset-evidence': {
      const output = outputFor(set, command.outputId)
      output.overrides[command.field] = false
      if (command.field === 'source') {
        output.review.source = true
        output.review.redactions = output.document.redactions.length > 0
      }
      break
    }
    case 'reset-dimensions': {
      const output = outputFor(set, command.outputId)
      if (output.format === 'original') break
      output.document.canvas = composeOutput(
        storyForOutput(set, output),
        output.format,
        treatmentSchema.safeParse(output.composition.id).data ?? 'product-hero',
        output.id
      ).document.canvas
      break
    }
    case 'reviewed':
      outputFor(set, command.outputId).review = { source: false, redactions: false, wording: false }
      break
    case 'layout': {
      const output = outputFor(set, command.outputId)
      if (output.format === 'original')
        throw new Error('Keep the original composition, or edit one of its adapted formats.')
      const next = composeOutput(
        storyForOutput(set, output),
        output.format,
        command.treatment,
        output.id
      )
      // Recomposition is explicit and affects managed placement only; added layers survive.
      const managed = new Set(Object.values(output.bindings))
      for (const field of contentFieldSchema.options) {
        const previous = output.document.texts.find((text) => text.id === output.bindings[field])
        const proposed = next.document.texts.find((text) => text.id === output.bindings[field])!
        if (previous)
          Object.assign(proposed, previous, {
            position: proposed.position,
            maxWidth: proposed.maxWidth,
          })
        if (command.treatment === 'product-closeup') {
          proposed.visible = false
          output.overrides[field] = true
        }
      }
      output.document = {
        ...output.document,
        ...(command.treatment === 'product-closeup' || output.composition.id === 'product-closeup'
          ? { mode: next.document.mode }
          : {}),
        image: {
          ...output.document.image,
          scale: next.document.image.scale,
          offset: next.document.image.offset,
          ...(command.treatment === 'product-closeup' || output.composition.id === 'product-closeup'
            ? {
                opacity: next.document.image.opacity,
                frame: next.document.image.frame,
                shadow: next.document.image.shadow,
              }
            : {}),
        },
        texts: [
          ...next.document.texts,
          ...output.document.texts.filter((text) => !managed.has(text.id!)),
        ],
        elements: [
          ...next.document.elements,
          ...output.document.elements.filter((element) => !managed.has(element.id)),
        ],
      }
      output.composition = next.composition
      output.overrides.focus = false
      break
    }
    case 'add-store':
      set.storeGroups.push(command.group)
      break
    case 'store-edit':
    case 'link-store-slide':
    case 'reset-store-binding':
    case 'review-store': {
      const index = set.storeGroups.findIndex((group) => group.id === command.groupId)
      const group = set.storeGroups[index]
      if (!group) throw new Error('This store group no longer exists.')
      if (command.type === 'store-edit')
        set.storeGroups[index] = editStoreGroup(group, command.document)
      else if (command.type === 'link-store-slide') {
        const story = set.stories.find((story) => story.id === command.storyId)
        if (!story) throw new Error('This story no longer exists.')
        set.storeGroups[index] = linkStoreSlide(group, command.slideId, story)
      } else if (command.type === 'reset-store-binding') {
        const binding = group.bindings.find(
          (binding) => binding.slideId === command.slideId && binding.layerId === command.layerId
        )
        if (!binding) throw new Error('This store layer is not linked.')
        binding.overridden = false
      } else group.review = { source: false, wording: false }
      break
    }
  }
  for (const output of set.outputs) output.document = materializeOutput(set, output)
  set.storeGroups = set.storeGroups.map((group) => materializeStoreGroup(set, group))
  return creativeSetDocumentSchema.parse(set)
}

/** Existing brand assignments preserve each output's deliberate local styling. */
export function applySetBrand(
  current: CreativeSetDocument,
  kit: BrandKit,
  storeLogo?: StoreBrandLogo
): { document: CreativeSetDocument; keptOverrides: number } {
  const document = structuredClone(current)
  let keptOverrides = 0
  for (const output of document.outputs) {
    const result = applyBrandKit(
      output.document,
      kit,
      ['colors', 'typography', 'background', 'frame', 'logo'],
      { binding: output.document.brand }
    )
    output.document = { ...result.document, brand: result.binding }
    keptOverrides += result.keptOverrides.length
  }
  document.brand = { id: kit.id, name: kit.name, version: kit.version }
  document.storeGroups = document.storeGroups.map((group) => applyStoreBrand(group, kit, storeLogo))
  return { document: creativeSetDocumentSchema.parse(document), keptOverrides }
}

/** Output-document transaction; callers suppress this while loading resolved values. */
export function nativeEdit(set: CreativeSetDocument, outputId: string, document: DesignDocument) {
  return applySetCommand(set, { type: 'native-edit', outputId, document })
}
