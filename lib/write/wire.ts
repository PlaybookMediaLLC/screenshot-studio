import { z } from 'zod'
import { timestampSchema } from '@/lib/api/contract'
import {
  articleSchema,
  draftChannelSchema,
  draftKindSchema,
  draftTargetSchema,
  platformVersionsSchema,
} from '@/lib/write/document'

/**
 * What Write (RFC 041) adds to a content draft on the wire: the fields a
 * draft returns, the fields it is written with, and how lists are filtered.
 * The draft contracts extend their schemas with these shapes.
 */

/** The Write fields a draft returns. */
export const draftWriteFieldsSchema = z.object({
  /** An X article's title and cover, for an article draft. */
  article: articleSchema.nullable(),
  /** Posts that failed or whose outcome is unknown (lists only). */
  attentionPosts: z.number().int(),
  kind: draftKindSchema,
  /** When the next queued post goes out (lists only). */
  nextPostAt: timestampSchema.nullable(),
  pinnedAt: timestampSchema.nullable(),
  /** A planned time puts the draft on the calendar; nothing publishes from it. */
  plannedFor: timestampSchema.nullable(),
  planTimeZone: z.string().nullable(),
  /** Each platform's version beside the primary body. */
  platformVersions: platformVersionsSchema,
  /** The channel the body is written for. */
  primaryChannel: draftChannelSchema,
  /** Posts waiting to go out (lists only). */
  queuedPosts: z.number().int(),
  /** Internal notes; never part of a post. */
  scratchpad: z.string(),
  /** The draft's social set; null is the workspace's default set. */
  socialSetId: z.string().nullable(),
  /** The draft it was duplicated, copied or recovered from. */
  sourceDraftId: z.string().nullable(),
  tagIds: z.array(z.string()),
  /** The post a reply answers, a quote embeds, or a repurposed draft came from. */
  target: draftTargetSchema.nullable(),
})

/** The Write fields a draft is created or updated with. */
export const draftWriteInputSchema = z.object({
  /** An X article's title and cover, for an article draft. */
  article: articleSchema.optional(),
  /** Each platform's version beside the primary body. */
  platformVersions: platformVersionsSchema.optional(),
  /** The channel the body is written for. */
  primaryChannel: draftChannelSchema.optional(),
  /** The post a reply answers or a quote embeds. */
  target: draftTargetSchema.optional(),
})

/** How a draft list is ordered. */
export const contentDraftSortSchema = z.enum([
  'updated_desc',
  'updated_asc',
  'created_desc',
  'created_asc',
])

/** One of {@link contentDraftSortSchema}. */
export type ContentDraftSort = z.infer<typeof contentDraftSortSchema>

/** A lifecycle tab: not yet live, something went live, or archived. */
export const contentDraftViewSchema = z.enum(['drafts', 'posted', 'archived'])

/** One of {@link contentDraftViewSchema}. */
export type ContentDraftView = z.infer<typeof contentDraftViewSchema>
