import 'server-only'

import { z } from 'zod'
import { onboardingStartBodySchema } from '@/lib/api/contracts/onboarding-runs'
import { startFirstCampaign } from '@/lib/onboarding/first-campaign'
import {
  cancelOnboardingRun,
  getLatestOnboardingRun,
  getOnboardingRun,
  listOnboardingEnrichment,
  rerunOnboardingRun,
  startOnboardingRun,
} from '@/lib/tenant/onboarding-runs'
import { productProfileValuesSchema } from '@/lib/tenant/product-profile-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

const runInput = z.object({ runId: z.string().min(1).max(64) })

/**
 * Onboarding's product step (docs/rfcs/032-background-onboarding-agent.md):
 * the Go backend reads the site into drafts within ten seconds and a
 * background run deepens them; the confirmed profile starts the first campaign.
 */
export const onboardingRouter = router({
  /** The fast path: drafts within ten seconds, then the background run. */
  start: organizationProcedure('workspace:update')
    .input(onboardingStartBodySchema)
    .mutation(async ({ ctx, input }) => startOnboardingRun(ctx.access, input)),
  /** A run's status and live progress, polled by the review screen. */
  run: organizationProcedure('workspace:read')
    .input(runInput)
    .query(async ({ ctx, input }) => ({ run: await getOnboardingRun(ctx.access, input.runId) })),
  /** The newest run, so the review screen can resume one in progress. */
  latest: organizationProcedure('workspace:read').query(async ({ ctx }) => ({
    run: await getLatestOnboardingRun(ctx.access),
  })),
  cancel: organizationProcedure('workspace:update')
    .input(runInput)
    .mutation(async ({ ctx, input }) => ({
      run: await cancelOnboardingRun(ctx.access, input.runId),
    })),
  rerun: organizationProcedure('workspace:update')
    .input(runInput)
    .mutation(async ({ ctx, input }) => rerunOnboardingRun(ctx.access, input.runId)),
  /** What enrichment found for the run's site. */
  enrichment: organizationProcedure('workspace:read')
    .input(runInput)
    .query(async ({ ctx, input }) => ({
      enrichment: await listOnboardingEnrichment(ctx.access, input.runId),
    })),
  /** Create the product surface, release brief, and campaign the first posts come from. */
  startCampaign: organizationProcedure('brand:manage')
    .input(z.object({ pages: z.array(productProfileValuesSchema.shape.url).max(10).default([]) }))
    .mutation(async ({ ctx, input }) => startFirstCampaign(ctx.access, input.pages)),
})
