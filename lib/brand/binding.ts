import { z } from 'zod'

/**
 * The brand kit a design follows and the value the kit set for each property
 * path, so applying a kit again can tell the user's overrides from the kit's
 * own values. See `applyBrandKit`.
 */
export const brandBindingSchema = z.object({
  applied: z.record(z.string().max(200), z.json()).default({}),
  kitId: z.string().max(40),
  name: z.string().max(100),
  version: z.number().int().min(1),
})
/** A design's brand binding. */
export type BrandBinding = z.infer<typeof brandBindingSchema>
