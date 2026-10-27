import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { socialSetParamsSchema } from './social-sets'

/** A community identity returned by X. */
export const socialCommunitySchema = z.object({
  id: z.string().regex(/^\d{1,19}$/),
  name: z.string(),
})

/** Search communities using the selected social set's authorized X connection. */
export const searchCommunitiesContract = defineContract({
  access: { feature: 'content:drafts', permission: 'artifact:edit', quota: 'api:write:minute' },
  method: 'GET',
  name: 'social-sets.communities',
  output: z.object({ items: z.array(socialCommunitySchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/communities',
  query: z.object({ q: z.string().trim().min(1).max(200) }),
  summary: 'Search X communities',
})
