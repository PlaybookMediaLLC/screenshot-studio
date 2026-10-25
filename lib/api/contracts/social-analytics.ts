import { z } from 'zod'
import { socialObservationSchema } from 'screenshot-studio-backend-sdk'
import { defineContract } from '@/lib/api/contract'
import { contentDraftIdSchema } from './content-drafts'

/** Read observations for one visible social set and a bounded date range. */
export const socialAnalyticsContract = defineContract({
  method: 'GET',
  name: 'social-analytics.list',
  path: '/api/v1/social-analytics',
  query: z.object({
    socialSetId: contentDraftIdSchema,
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  }),
  output: z.object({ items: z.array(socialObservationSchema) }),
  summary: 'Read stored social analytics observations',
})
