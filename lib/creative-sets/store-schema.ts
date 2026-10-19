import { z } from 'zod'
import {
  storeDocumentSchema,
  themeSchema,
  imageLayerSchema,
} from '@/lib/store-screenshots/document/schema'

const id = z.string().min(1).max(80)
export const storeBindingSchema = z.object({
  storyId: id,
  slideId: id,
  layerId: id,
  field: z.enum(['headline', 'supporting', 'source', 'focus']),
  assetId: id.optional(),
  overridden: z.boolean(),
})

/** Native store IDs stay stable; only this mapping points to workspace storage. */
export const storeGroupSchema = z.object({
  id,
  kind: z.literal('store'),
  name: z.string().min(1).max(120),
  document: storeDocumentSchema,
  assetMap: z.record(z.string(), z.string().regex(/^asset:[0-9a-f-]{36}$/i)),
  bindings: z.array(storeBindingSchema).max(500),
  review: z.object({ source: z.boolean(), wording: z.boolean() }),
  brandAssignment: z
    .object({
      theme: themeSchema,
      logoAssetId: id.optional(),
      logos: z.array(z.object({ slideId: id, layer: imageLayerSchema })),
    })
    .optional(),
  origin: z
    .object({
      id,
      revision: z.number().int().nonnegative(),
      copiedAt: z.string().datetime(),
      documentHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
})
export type StoreGroup = z.infer<typeof storeGroupSchema>
