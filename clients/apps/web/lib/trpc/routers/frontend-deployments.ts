import 'server-only'
import { z } from 'zod'
import {
  frontendDecisionSchema,
  frontendEvidenceSchema,
  frontendPreviewSchema,
  frontendSourceInputSchema,
  frontendSourceSchema,
} from 'screenshot-studio-backend-sdk'
import { backendSDK } from '@/lib/backend/sdk'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** Session-admin configuration and tenant-authorized deployment evidence. */
export const frontendDeploymentsRouter = router({
  sources: organizationProcedure('workspace:read')
    .output(z.object({ sources: z.array(frontendSourceSchema) }))
    .query(({ ctx }) => backendSDK(ctx.access).frontendSources()),
  save: organizationProcedure('workspace:update')
    .input(frontendSourceInputSchema)
    .output(frontendSourceSchema)
    .mutation(({ ctx, input }) => backendSDK(ctx.access).saveFrontendSource(input)),
  history: organizationProcedure('workspace:read')
    .input(z.object({ id: z.string().min(1).max(100) }))
    .output(z.object({ items: z.array(frontendEvidenceSchema) }))
    .query(({ ctx, input }) => backendSDK(ctx.access).frontendHistory(input.id)),
  preview: organizationProcedure('workspace:read')
    .input(frontendPreviewSchema)
    .output(frontendDecisionSchema)
    .mutation(({ ctx, input }) => backendSDK(ctx.access).previewFrontend(input)),
})
