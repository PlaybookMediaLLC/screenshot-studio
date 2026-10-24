import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { socialSetParamsSchema } from '@/lib/api/contracts/social-sets'

/**
 * Mentions (RFC 025): an account a post tags, looked up with the social
 * set's own account, so the lookup spends that account's provider limit.
 */
/** What a looked-up mention is: an X user or a LinkedIn organization. */
export const mentionKindSchema = z.enum(['person', 'organization'])

/** An account a post can tag, as its platform writes it in a post (RFC 025). */
export const socialMentionSchema = z.object({
  handle: z.string().optional(),
  image: z.string().optional(),
  kind: mentionKindSchema,
  label: z.string(),
  /** The X username, or a LinkedIn organization URN. */
  providerId: z.string(),
})

/** `GET /api/v1/social-sets/{id}/mentions` */
export const lookupMentionsContract = defineContract({
  // Each lookup spends the account's provider rate limit.
  access: { feature: 'content:drafts', permission: 'artifact:edit', quota: 'api:write:minute' },
  method: 'GET',
  name: 'social-sets.mentions',
  output: z.object({ items: z.array(socialMentionSchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/mentions',
  query: z.object({
    channel: z.enum(['x', 'linkedin']),
    q: z.string().trim().min(1).max(200),
  }),
  summary:
    "Look up a mention with the set's own account: an X user by exact username, or a LinkedIn company page by the name in its address",
})
