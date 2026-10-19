import { z } from 'zod'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { documentCanvasSize } from '@/lib/export/adapt'
import { storeGroupSchema } from './store-schema'
import { reusableReferenceSchema } from './reusable-schema'
import { resolveFocus } from './focus'

const id = z.string().min(1).max(80)
const unit = z.number().min(0).max(1)
export const focusRegionSchema = z
  .object({ x: unit, y: unit, width: unit.min(0.02), height: unit.min(0.02) })
  .refine(
    (region) => region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001,
    'Keep the focus inside the screenshot.'
  )
export const treatmentSchema = z.enum([
  'product-hero',
  'editorial-split',
  'detail-spotlight',
  'product-closeup',
])
export const authoredFormatSchema = z.enum(['wide', 'square', 'portrait'])
export const formatSchema = z.enum(['wide', 'square', 'portrait', 'original'])
export const compositionSchema = z.object({ id, version: z.number().int().positive() })
export const originSchema = z.object({
  kind: z.enum(['project', 'store-project', 'file']),
  id,
  revision: z.number().int().nonnegative(),
  copiedAt: z.string().datetime(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const contentFieldSchema = z.enum(['headline', 'supporting'])
export const sourceSchema = z.object({
  id,
  revision: z.number().int().positive(),
  src: z.string().regex(/^asset:[0-9a-f-]{36}$/i),
  name: z.string().min(1).max(200),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
})
export const creativeOutputSchema = z.object({
  id,
  storyId: id,
  kind: z.literal('design'),
  format: formatSchema,
  composition: compositionSchema,
  origin: originSchema.optional(),
  reusable: z.array(reusableReferenceSchema).max(3).default([]),
  bindings: z.object({ headline: id, supporting: id, focus: id }),
  overrides: z.object({
    headline: z.boolean(),
    supporting: z.boolean(),
    source: z.boolean(),
    focus: z.boolean(),
  }),
  review: z.object({ source: z.boolean(), redactions: z.boolean(), wording: z.boolean() }),
  document: designDocumentSchema,
})
export const deliverySchema = z.object({
  id,
  revision: z.number().int().positive(),
  outputId: id,
  fileName: z.string().min(1).max(250),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sources: z.array(z.string().regex(/^asset:[0-9a-f-]{36}$/i)).max(200),
  brand: z.object({ id, version: z.number().int().positive() }).nullable(),
  composition: compositionSchema,
  store: z
    .object({
      slideId: id,
      slideIds: z.array(id).max(30).optional(),
      targetId: id,
      locale: z.string().max(40),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  asset: z
    .string()
    .regex(/^asset:[0-9a-f-]{36}$/i)
    .optional(),
})

export const storySchema = z.object({
  id,
  headline: z.string().trim().min(1).max(300),
  supporting: z.string().max(300),
  source: sourceSchema,
  focus: focusRegionSchema,
})

/** Relationships and native documents; each renderer remains authoritative. */
const creativeSetV2Schema = z
  .object({
    version: z.literal(2),
    stories: z.array(storySchema).min(1).max(20),
    brand: z
      .object({ id, name: z.string().max(200), version: z.number().int().positive() })
      .nullable(),
    outputs: z.array(creativeOutputSchema).min(1).max(100),
    storeGroups: z.array(storeGroupSchema).max(20).default([]),
    deliveries: z.array(deliverySchema).max(1000).default([]),
  })
  .superRefine((set, context) => {
    if (
      new Set(set.outputs.map((output) => output.id)).size !== set.outputs.length ||
      new Set(set.stories.map((story) => story.id)).size !== set.stories.length
    ) {
      context.addIssue({ code: 'custom', message: 'Stories and outputs need unique IDs.' })
    }
    for (const story of set.stories) {
      const outputs = set.outputs.filter((output) => output.storyId === story.id)
      if (new Set(outputs.map((output) => output.format)).size !== outputs.length)
        context.addIssue({ code: 'custom', message: 'Each story has one output per format.' })
    }
    for (const output of set.outputs) {
      if (!set.stories.some((story) => story.id === output.storyId))
        context.addIssue({
          code: 'custom',
          message: 'Every output belongs to a story in this set.',
        })
      const ids = [output.bindings.headline, output.bindings.supporting, output.bindings.focus]
      if (new Set(ids).size !== ids.length)
        context.addIssue({ code: 'custom', message: 'Bindings need distinct layer IDs.' })
      for (const layers of [
        output.document.texts,
        output.document.elements,
        output.document.overlays,
        output.document.annotations,
        output.document.redactions,
      ]) {
        const layerIds = layers.map((layer) => layer.id).filter(Boolean)
        if (new Set(layerIds).size !== layerIds.length)
          context.addIssue({ code: 'custom', message: 'Layer IDs must be unique.' })
      }
    }
    if (new Set(set.storeGroups.map((group) => group.id)).size !== set.storeGroups.length)
      context.addIssue({ code: 'custom', message: 'Store groups need unique IDs.' })
    for (const group of set.storeGroups) {
      for (const binding of group.bindings) {
        const slide = group.document.slides.find((slide) => slide.id === binding.slideId)
        const layer = slide?.layers.find((layer) => layer.id === binding.layerId)
        if (
          !set.stories.some((story) => story.id === binding.storyId) ||
          (!binding.overridden && !layer)
        )
          context.addIssue({
            code: 'custom',
            message: 'A store binding must name an existing story and layer.',
          })
      }
    }
  })

/** Upgrade the single-story prototype losslessly; unknown future versions remain rejected. */
export const creativeSetDocumentSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
    return value
  const legacy = value as { story?: { id?: string }; outputs?: unknown[] }
  return {
    ...value,
    version: 2,
    stories: [legacy.story],
    outputs: legacy.outputs?.map((output) => ({
      ...(output as object),
      storyId: legacy.story?.id,
    })),
  }
}, creativeSetV2Schema)

export type CreativeSetDocument = z.infer<typeof creativeSetDocumentSchema>
export type Story = z.infer<typeof storySchema>
export type CreativeOutput = z.infer<typeof creativeOutputSchema>
export type StorySource = z.infer<typeof sourceSchema>
export type FocusRegion = z.infer<typeof focusRegionSchema>
export type Treatment = z.infer<typeof treatmentSchema>
export type ContentField = z.infer<typeof contentFieldSchema>
export type StoryFormat = z.infer<typeof authoredFormatSchema>

export const STORY_FORMATS = {
  wide: { name: 'Wide hero', width: 1600, height: 900 },
  square: { name: 'Square card', width: 1080, height: 1080 },
  portrait: { name: 'Portrait card', width: 1080, height: 1350 },
} as const
export const TREATMENTS: Record<Treatment, string> = {
  'product-hero': 'Product Hero',
  'editorial-split': 'Editorial Split',
  'detail-spotlight': 'Detail Spotlight',
  'product-closeup': 'Product Close-up',
}

export function outputDimensions(output: CreativeOutput) {
  return output.format === 'original'
    ? { name: 'Imported original', ...documentCanvasSize(output.document) }
    : STORY_FORMATS[output.format]
}

/** Resolve only linked content. Native geometry and local fields remain authoritative. */
export function materializeOutput(
  set: CreativeSetDocument,
  output: CreativeOutput
): DesignDocument {
  const story = storyForOutput(set, output)
  const document = structuredClone(output.document)
  for (const field of contentFieldSchema.options) {
    if (output.overrides[field]) continue
    const text = document.texts.find((text) => text.id === output.bindings[field])
    if (text) {
      text.text = story[field] || ' '
      text.visible = Boolean(story[field])
    }
  }
  if (!output.overrides.source) document.image.src = story.source.src
  if (!output.overrides.focus && !output.overrides.source) {
    const callout = document.elements.find((element) => element.id === output.bindings.focus)
    if (callout?.type === 'callout') {
      resolveFocus(document, story.source, story.focus, callout)
    }
  }
  return document
}

export function storyForOutput(
  set: CreativeSetDocument,
  output: Pick<CreativeOutput, 'storyId'>
): Story {
  const story = set.stories.find((story) => story.id === output.storyId)
  if (!story) throw new Error('The story for this format is missing.')
  return story
}

/** Copying into a set gives anonymous native layers durable identities. */
export function identifyLayers(
  document: DesignDocument,
  newId = () => crypto.randomUUID()
): DesignDocument {
  const copy = structuredClone(document)
  for (const layers of [
    copy.texts,
    copy.overlays,
    copy.annotations,
    copy.redactions,
    copy.devices?.mockups ?? [],
  ]) {
    for (const layer of layers) layer.id ??= newId()
  }
  return copy
}

/** Stable per creation intent, so a repeated request cannot create another set. */
export function newCreativeSetId(): string {
  return `c${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
}
