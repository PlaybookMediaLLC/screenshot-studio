import 'server-only'

import { z } from 'zod'
import {
  automationDefinitionSchema,
  automationHistoryItemSchema,
  automationIdentitySchema,
  automationOverviewSchema,
  automationPreviewInputSchema,
  automationPreviewSchema,
  automationRevisionSchema,
  automationRunDetailSchema,
  automationSaveSchema,
} from '@/lib/api/contracts/release-automation'
import {
  automationHistoryFilterSchema,
  automationSourceModeSchema,
  automationVersionSchema,
} from '@/lib/api/contracts/workflow-runs'
import { backendSDK } from '@/lib/backend/sdk'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** Governance is session-admin only; members can read their workspace's history. */
export const releaseAutomationRouter = router({
  overview: organizationProcedure('workspace:read')
    .output(automationOverviewSchema)
    .query(({ ctx }) => backendSDK(ctx.access).releaseAutomationOverview()),
  save: organizationProcedure('workspace:update')
    .input(automationSaveSchema)
    .output(automationDefinitionSchema)
    .mutation(({ ctx, input }) => backendSDK(ctx.access).saveReleaseAutomation(input)),
  activate: organizationProcedure('workspace:update')
    .input(automationRevisionSchema)
    .output(automationDefinitionSchema)
    .mutation(({ ctx, input }) =>
      backendSDK(ctx.access).activateReleaseAutomation(input.id, input.revision)
    ),
  disable: organizationProcedure('workspace:update')
    .input(automationRevisionSchema)
    .mutation(({ ctx, input }) =>
      backendSDK(ctx.access).disableReleaseAutomation(input.id, input.revision)
    ),
  sourceMode: organizationProcedure('workspace:update')
    .input(automationSourceModeSchema)
    .mutation(({ ctx, input }) =>
      backendSDK(ctx.access).setReleaseAutomationMode(
        input.id,
        input.enabled,
        input.collectUnmatched,
        input.branch
      )
    ),
  preview: organizationProcedure('workspace:update')
    .input(automationPreviewInputSchema)
    .output(automationPreviewSchema)
    .mutation(({ ctx, input }) => backendSDK(ctx.access).previewReleaseAutomation(input)),
  disconnectSource: organizationProcedure('workspace:update')
    .input(automationIdentitySchema)
    .mutation(({ ctx, input }) =>
      backendSDK(ctx.access).disconnectReleaseAutomationSource(input.id)
    ),
  history: organizationProcedure('workspace:read')
    .input(automationHistoryFilterSchema.optional())
    .output(z.object({ items: z.array(automationHistoryItemSchema) }))
    .query(({ ctx, input }) => backendSDK(ctx.access).listReleaseAutomationHistory(input)),
  versions: organizationProcedure('workspace:read')
    .input(automationIdentitySchema)
    .output(z.object({ items: z.array(automationVersionSchema) }))
    .query(({ ctx, input }) => backendSDK(ctx.access).listReleaseAutomationVersions(input.id)),
  run: organizationProcedure('workspace:read')
    .input(automationIdentitySchema)
    .output(automationRunDetailSchema)
    .query(({ ctx, input }) => backendSDK(ctx.access).getReleaseAutomationRun(input.id)),
  version: organizationProcedure('workspace:read')
    .input(automationIdentitySchema)
    .output(automationVersionSchema)
    .query(({ ctx, input }) => backendSDK(ctx.access).getReleaseAutomationVersion(input.id)),
  cancel: organizationProcedure('workspace:update')
    .input(automationIdentitySchema)
    .mutation(({ ctx, input }) => backendSDK(ctx.access).cancelReleaseAutomationRun(input.id)),
  retry: organizationProcedure('workspace:update')
    .input(automationIdentitySchema)
    .mutation(({ ctx, input }) => backendSDK(ctx.access).retryReleaseAutomationRun(input.id)),
})
