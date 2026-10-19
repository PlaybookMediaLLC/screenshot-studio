import { z } from 'zod'
import { creativeSetDocumentSchema } from './document'

/**
 * Shared shapes for cloud creativeSets: the tRPC inputs the server validates and
 * the closed sets the editor and library switch on.
 */

/** How a creativeSet version came to be. Autosaves are pruned; the rest are kept. */
export const creativeSetVersionKindSchema = z.enum(['autosave', 'named', 'restore', 'duplicate'])
/** One of {@link creativeSetVersionKindSchema}. */
export type CreativeSetVersionKind = z.infer<typeof creativeSetVersionKindSchema>

/** Library order: last edited first, or by name. */
export const creativeSetSortSchema = z.enum(['updated', 'name'])
/** One of {@link creativeSetSortSchema}. */
export type CreativeSetSort = z.infer<typeof creativeSetSortSchema>

/**
 * Where the open creativeSet's autosave is. `offline` keeps changes on this
 * device and retries; `error` is a save the server refused for good.
 */
export const creativeSetSaveStatusSchema = z.enum([
  'loading',
  'saved',
  'unsaved',
  'saving',
  'offline',
  'conflict',
  'error',
])
/** One of {@link creativeSetSaveStatusSchema}. */
export type CreativeSetSaveStatus = z.infer<typeof creativeSetSaveStatusSchema>

/** A creativeSet or version id (the backend issues cuids). */
export const creativeSetIdSchema = z.string().cuid()

/** A creativeSet name, as the backend accepts it. */
export const creativeSetNameSchema = z.string().trim().min(1, 'Enter a name.').max(200)

/** A version name, as the backend accepts it. */
export const creativeSetVersionNameSchema = z.string().trim().min(1, 'Enter a name.').max(120)

/** A creativeSet revision; every document write names the one it was based on. */
export const creativeSetRevisionSchema = z.number().int().min(1)

/** Input of `creativeSet.list`. */
export const creativeSetListInputSchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  sort: creativeSetSortSchema.optional(),
})
/** One of {@link creativeSetListInputSchema}. */
export type CreativeSetListInput = z.infer<typeof creativeSetListInputSchema>

/** Input of `creativeSet.create`. The document is checked by `parseDesignDocument`. */
export const creativeSetCreateInputSchema = z.object({
  id: creativeSetIdSchema,
  document: creativeSetDocumentSchema,
  name: creativeSetNameSchema,
})

/** Input naming one creativeSet. */
export const creativeSetRefInputSchema = z.object({ creativeSetId: creativeSetIdSchema })

/** Input of `creativeSet.rename`. */
export const creativeSetRenameInputSchema = creativeSetRefInputSchema.extend({
  name: creativeSetNameSchema,
})

/** Input of `creativeSet.updateDocument`. */
export const creativeSetDocumentInputSchema = creativeSetRefInputSchema.extend({
  baseRevision: creativeSetRevisionSchema,
  document: creativeSetDocumentSchema,
})

/** Input of `creativeSet.duplicate`. */
export const creativeSetDuplicateInputSchema = creativeSetRefInputSchema.extend({
  name: creativeSetNameSchema.optional(),
})

/** Input naming one version of a creativeSet. */
export const creativeSetVersionRefInputSchema = creativeSetRefInputSchema.extend({
  versionId: creativeSetIdSchema,
})

/** Input of `creativeSet.createVersion`. */
export const creativeSetVersionCreateInputSchema = creativeSetRefInputSchema.extend({
  name: creativeSetVersionNameSchema,
  baseRevision: creativeSetRevisionSchema.optional(),
})

/** Input of `creativeSet.restoreVersion`. */
export const creativeSetRestoreInputSchema = creativeSetVersionRefInputSchema.extend({
  baseRevision: creativeSetRevisionSchema,
})

/** Attach one delivered file to an existing campaign as a new review candidate. */
export const creativeSetHandoffSchema = creativeSetRefInputSchema.extend({
  baseRevision: creativeSetRevisionSchema,
  deliveryId: z.string().min(1).max(80),
  campaignId: z.string().cuid(),
  channel: z.enum(['x', 'linkedin', 'instagram']),
  copy: z.string().trim().min(1).max(4000),
})
