import { z } from 'zod'

/**
 * The product profile's editable fields and their limits, shared by the
 * settings form, onboarding, and the tRPC router. The limits match the Go
 * backend's (services/internal/product/product_profile.go).
 */

/** A product profile field name; provenance is kept per field. */
export const productProfileFieldSchema = z.enum([
  'name',
  'url',
  'summary',
  'problem',
  'audience',
  'capabilities',
  'proofPoints',
  'pricingNote',
  'competitors',
])

/** One of {@link productProfileFieldSchema}. */
export type ProductProfileFieldName = z.infer<typeof productProfileFieldSchema>

/**
 * Who changed a field: a person (which locks it), an automated read of the
 * product's site, or third-party enrichment, which ranks below both.
 */
export const productProfileSourceSchema = z.enum(['manual', 'automated', 'enrichment'])

/** One of {@link productProfileSourceSchema}. */
export type ProductProfileSource = z.infer<typeof productProfileSourceSchema>

const profileUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an http(s) URL.')

/** A claim about the product and the page it came from. */
export const productProofPointSchema = z.object({
  claim: z.string().trim().min(1).max(500),
  sourceUrl: profileUrlSchema.optional(),
})

/** The profile's values, every field bounded as the backend bounds it. */
export const productProfileValuesSchema = z.object({
  audience: z.string().trim().max(1_000),
  capabilities: z.array(z.string().trim().min(1).max(300)).max(30),
  competitors: z.array(z.string().trim().min(1).max(100)).max(20),
  name: z.string().trim().min(1).max(160),
  pricingNote: z.string().trim().max(500),
  problem: z.string().trim().max(2_000),
  proofPoints: z.array(productProofPointSchema).max(30),
  summary: z.string().trim().max(2_000),
  url: profileUrlSchema,
})

/** One of {@link productProfileValuesSchema}. */
export type ProductProfileValues = z.infer<typeof productProfileValuesSchema>

/**
 * A person's change: only the fields given change, and each one changed is
 * locked against automated updates. `unlockFields` lets automated updates
 * change those fields again; `acceptFields` locks fields as they are.
 */
export const productProfileUpsertSchema = productProfileValuesSchema.partial().extend({
  acceptFields: z.array(productProfileFieldSchema).max(9).optional(),
  unlockFields: z.array(productProfileFieldSchema).max(9).optional(),
})

/** One of {@link productProfileUpsertSchema}. */
export type ProductProfileUpsertInput = z.infer<typeof productProfileUpsertSchema>
