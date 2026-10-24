import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { assistantInputSchema, refineInputSchema } from '@/lib/write/refine-actions'

/**
 * AI in the Write composer (RFC 025): Refine and the writing assistant.
 * Signed-in members who edit drafts use them; each call is charged to the
 * workspace's AI credits. Neither changes a draft: the composer applies a
 * refinement only when the writer accepts it.
 */

/** `POST /api/v1/content-drafts/refine` */
export const refineContract = defineContract({
  body: refineInputSchema,
  method: 'POST',
  name: 'content-drafts.refine',
  output: z.object({ texts: z.array(z.string()).min(1) }),
  path: '/api/v1/content-drafts/refine',
  summary: 'Refine texts of a draft with AI, one answer per text',
})

/** `POST /api/v1/content-drafts/assistant` */
export const assistantContract = defineContract({
  body: assistantInputSchema,
  method: 'POST',
  name: 'content-drafts.assistant',
  output: z.object({ reply: z.string() }),
  path: '/api/v1/content-drafts/assistant',
  summary: "Ask the writing assistant about a draft, in the set's voice",
})
