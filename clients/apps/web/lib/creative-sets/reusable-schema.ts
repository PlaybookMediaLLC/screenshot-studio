import { z } from 'zod'
import { designDocumentSchema } from '@/lib/design/document'

export const reusableScopeSchema = z.enum(['composition', 'headline', 'proof-detail'])
export const reusableDefinitionSchema = z.object({
  kind: z.literal('story-reusable'),
  version: z.literal(1),
  scope: reusableScopeSchema,
  format: z.enum(['wide', 'square', 'portrait', 'original']),
  slots: z.object({ headline: z.string(), supporting: z.string(), focus: z.string() }),
  document: designDocumentSchema,
})
export const reusableReferenceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().max(100),
  version: z.number().int().positive(),
  scope: reusableScopeSchema,
  ids: z.record(z.string(), z.string()),
  assigned: designDocumentSchema,
})
export type ReusableDefinition = z.infer<typeof reusableDefinitionSchema>
export type ReusableReference = z.infer<typeof reusableReferenceSchema>
