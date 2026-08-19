import 'server-only'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { campaignPostTransitions } from '@/lib/tenant/campaign-status'
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  scheduleCampaignPost,
  transitionCampaignPosts,
} from '@/lib/tenant/campaigns'
import {
  campaignApprovalSchema,
  campaignCreateSchema,
  campaignPostScheduleSchema,
} from '@/lib/tenant/schemas'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { router, publicProcedure } from '../init'
import { organizationProcedure } from '../procedures'

const campaignIdSchema = z.object({ campaignId: z.string().cuid() })

export const campaignRouter = router({
  list: organizationProcedure('artifact:read').query(async ({ ctx }) => {
    const campaigns = await listCampaigns(ctx.access.organizationId)
    return { campaigns }
  }),
  get: organizationProcedure('artifact:read')
    .input(campaignIdSchema)
    .query(async ({ ctx, input }) => {
      const campaign = await getCampaign(ctx.access.organizationId, input.campaignId)
      if (!campaign) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found.' })
      }
      return { campaign }
    }),
  create: organizationProcedure('release:create')
    .input(campaignCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const campaign = await createCampaign(ctx.access, input)
      return { campaign }
    }),
  decideApproval: publicProcedure
    .input(campaignApprovalSchema.extend({ campaignId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const access = await requireActiveOrganizationPermission(
        ctx.headers,
        campaignPostTransitions[input.decision].permission
      )
      return transitionCampaignPosts(access, input.campaignId, input.decision, input.postIds)
    }),
  schedulePost: organizationProcedure('publish:manage')
    .input(campaignPostScheduleSchema.extend({ campaignId: z.string().cuid(), postId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { campaignId, postId, ...schedule } = input
      const post = await scheduleCampaignPost(ctx.access, campaignId, postId, schedule)
      return { post }
    }),
})
