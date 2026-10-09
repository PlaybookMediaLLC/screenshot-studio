import 'server-only'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { critiqueDesign, exploreDesignDirections } from '@/lib/ai/agents/editor-assist'
import { designDocumentSchema } from '@/lib/design/document'
import { isDesignRendererReady } from '@/lib/design/renderer'
import { consumeWorkspaceQuota } from '@/lib/tenant/entitlements'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** Up to ~2 MB of base64 JPEG: a snapshot, never a full export. */
const snapshotSchema = z.string().max(2_800_000).nullable()

async function requireConfigured(needsRenderer = false) {
  if (!isCampaignStudioConfigured() || (needsRenderer && !(await isDesignRendererReady()))) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: needsRenderer
        ? 'Rendering variations is unavailable right now. Try again in a minute.'
        : 'AI is not configured for this environment.',
    })
  }
}

export const editorAiRouter = router({
  /** Which in-editor AI features this environment and workspace can use. */
  status: organizationProcedure('artifact:read').query(async () => ({
    copilot: isCampaignStudioConfigured(),
    directions: isCampaignStudioConfigured() && (await isDesignRendererReady()),
  })),
  critique: organizationProcedure('artifact:edit')
    .input(z.object({ document: designDocumentSchema, snapshot: snapshotSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireConfigured()
      await consumeWorkspaceQuota(ctx.access.organizationId, 'generation:monthly')
      return { suggestions: await critiqueDesign(input.document, input.snapshot) }
    }),
  explore: organizationProcedure('artifact:edit')
    .input(
      z.object({
        count: z.number().int().min(2).max(6).default(4),
        direction: z.string().trim().max(300).optional(),
        document: designDocumentSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireConfigured(true)
      if (!input.document.image.src?.startsWith('asset:')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Save the image to the workspace first.',
        })
      }
      await consumeWorkspaceQuota(ctx.access.organizationId, 'generation:monthly')
      return exploreDesignDirections(ctx.access, input.document, {
        count: input.count,
        direction: input.direction,
      })
    }),
})
