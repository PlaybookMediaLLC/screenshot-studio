import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { socialSetParamsSchema } from '@/lib/api/contracts/social-sets'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'

/**
 * Mentions (RFC 025): an account a post tags, looked up with the social
 * set's own account, so the lookup spends that account's provider limit.
 */
/** What a looked-up mention is: an X user, LinkedIn organization or eligible Page follower. */
export const mentionKindSchema = z.enum(['person', 'organization'])

/** An account a post can tag, as its platform writes it in a post (RFC 025). */
export const socialMentionSchema = z.object({
  handle: z.string().optional(),
  image: z.string().optional(),
  kind: mentionKindSchema,
  label: z.string(),
  /** The native numeric X user ID, or a LinkedIn person/organization URN. */
  providerId: z.string(),
})

/** `GET /api/v1/social-sets/{id}/mentions` */
export const lookupMentionsContract = defineContract({
  // Each lookup spends the account's provider rate limit.
  access: {
    apiKeyScope: 'artifact:read',
    feature: 'content:drafts',
    permission: 'artifact:edit',
    quota: 'api:write:minute',
  },
  docs: workspaceDocs({
    operationId: 'lookupSocialSetMentions',
    description:
      'Looks up an exact X username or LinkedIn company vanity name/URL using the selected social set’s connected account. Returns provider-authoritative identifiers for structured mentions. Does not search LinkedIn people or publish anything. API keys cannot access private sets. Provider permission failures and rate limits are returned without inventing results.',
    extensions: { 'x-shots-entitlement': { feature: 'content:drafts', quota: 'api:write:minute' } },
    responses: {
      '200': 'Matched provider identities.',
      '404': 'Social set unavailable.',
      '409': 'Connect a compatible account first.',
    },
    tag: 'Workspace',
  }),
  method: 'GET',
  name: 'social-sets.mentions',
  output: z.object({ items: z.array(socialMentionSchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/mentions',
  query: z.object({
    channel: z.enum(['x', 'linkedin']),
    kind: mentionKindSchema.optional(),
    q: z.string().trim().max(200),
  }),
  summary:
    "Look up a mention with the set's own account: an X user by exact username, a LinkedIn company page, or eligible LinkedIn Page followers with approved People Typeahead access",
})
