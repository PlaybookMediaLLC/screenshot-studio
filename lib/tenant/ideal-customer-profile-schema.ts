import { z } from 'zod'

/**
 * The ideal customer profile's editable fields and their limits, shared by
 * the settings form, onboarding, and the tRPC router. The limits match the Go
 * backend's (services/internal/product/ideal_customer_profile.go).
 */

/** An ideal customer profile field name; provenance is kept per field. */
export const idealCustomerProfileFieldSchema = z.enum([
  'personas',
  'pains',
  'jobs',
  'buyingTriggers',
  'objections',
  'channels',
])

/** One of {@link idealCustomerProfileFieldSchema}. */
export type IdealCustomerProfileFieldName = z.infer<typeof idealCustomerProfileFieldSchema>

/** One kind of buyer: a role, and optionally how senior and how big their team is. */
export const idealCustomerPersonaSchema = z.object({
  role: z.string().trim().min(1).max(120),
  seniority: z.string().trim().max(60).optional(),
  teamSize: z.string().trim().max(60).optional(),
})

/** One of {@link idealCustomerPersonaSchema}. */
export type IdealCustomerPersona = z.infer<typeof idealCustomerPersonaSchema>

const items = z.array(z.string().trim().min(1).max(300)).max(12)

/** The ICP's values, every field bounded as the backend bounds it. */
export const idealCustomerProfileValuesSchema = z.object({
  buyingTriggers: items,
  channels: items,
  jobs: items,
  objections: items,
  pains: items,
  personas: z.array(idealCustomerPersonaSchema).max(8),
})

/** One of {@link idealCustomerProfileValuesSchema}. */
export type IdealCustomerProfileValues = z.infer<typeof idealCustomerProfileValuesSchema>

/**
 * A person's change: only the fields given change, and each one changed is
 * locked against automated updates. `unlockFields` lets automated updates
 * change those fields again; `acceptFields` locks fields as they are.
 */
export const idealCustomerProfileUpsertSchema = idealCustomerProfileValuesSchema.partial().extend({
  acceptFields: z.array(idealCustomerProfileFieldSchema).max(6).optional(),
  unlockFields: z.array(idealCustomerProfileFieldSchema).max(6).optional(),
})

/** One of {@link idealCustomerProfileUpsertSchema}. */
export type IdealCustomerProfileUpsertInput = z.infer<typeof idealCustomerProfileUpsertSchema>
