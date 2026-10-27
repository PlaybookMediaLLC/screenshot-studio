import { z } from 'zod'
import {
  creativeSetIdSchema,
  creativeSetNameSchema,
  creativeSetRevisionSchema,
  creativeSetSortSchema,
  creativeSetVersionNameSchema,
} from '@/lib/creative-sets/schema'
import { canvasDocumentSchema } from './document'

/**
 * The canvas API's inputs. A canvas is stored as a creative set of kind
 * `canvas`, so IDs, names, revisions and versions follow the same rules.
 */

/** A canvas or version id (the backend issues cuids). */
export const canvasIdSchema = creativeSetIdSchema

/** Input naming one canvas. */
export const canvasRefInputSchema = z.object({ canvasId: canvasIdSchema })

/** Archive a canvas or return it to the active library. */
export const canvasArchiveInputSchema = canvasRefInputSchema.extend({
  archived: z.boolean().default(true),
})

/** Input of `canvas.list`. */
export const canvasListInputSchema = z.object({
  archived: z.boolean().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  sort: creativeSetSortSchema.optional(),
})
/** One of {@link canvasListInputSchema}. */
export type CanvasListInput = z.infer<typeof canvasListInputSchema>

/** Input of `canvas.create`; the client picks the id so a retried request cannot create two. */
export const canvasCreateInputSchema = z.object({
  id: canvasIdSchema,
  document: canvasDocumentSchema,
  name: creativeSetNameSchema,
})

/** Input of `canvas.rename`. */
export const canvasRenameInputSchema = canvasRefInputSchema.extend({ name: creativeSetNameSchema })

/** Input of `canvas.updateDocument`: a write based on the revision it started from. */
export const canvasDocumentInputSchema = canvasRefInputSchema.extend({
  baseRevision: creativeSetRevisionSchema,
  document: canvasDocumentSchema,
})

/** Input of `canvas.duplicate`. */
export const canvasDuplicateInputSchema = canvasRefInputSchema.extend({
  name: creativeSetNameSchema.optional(),
})

/** Input naming one version of a canvas. */
export const canvasVersionRefInputSchema = canvasRefInputSchema.extend({
  versionId: canvasIdSchema,
})

/** Input of `canvas.createVersion`. */
export const canvasVersionCreateInputSchema = canvasRefInputSchema.extend({
  name: creativeSetVersionNameSchema,
  baseRevision: creativeSetRevisionSchema.optional(),
})

/** Input of `canvas.restoreVersion`. */
export const canvasRestoreInputSchema = canvasVersionRefInputSchema.extend({
  baseRevision: creativeSetRevisionSchema,
})

/** Attach one delivered artboard to a campaign as a new review candidate. */
export const canvasHandoffSchema = canvasRefInputSchema.extend({
  baseRevision: creativeSetRevisionSchema,
  deliveryId: z.string().min(1).max(80),
  campaignId: z.string().cuid(),
  channel: z.enum(['x', 'linkedin', 'instagram']),
  copy: z.string().trim().min(1).max(4000),
})
/** One of {@link canvasHandoffSchema}. */
export type CanvasHandoffInput = z.infer<typeof canvasHandoffSchema>
