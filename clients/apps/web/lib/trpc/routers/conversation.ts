import 'server-only'

import { z } from 'zod'
import { cancelTurn, getConversationView, retryStep, runTurn } from '@/lib/ai/conversation/turn'
import { backendSDK } from '@/lib/backend/sdk'
import { router } from '../init'
import { organizationProcedure } from '../procedures'
import { allowAiAction } from './launch'

/**
 * Conversations with the campaign agent (docs/rfcs/028-conversational-campaign-creation.md).
 * Any member reads, starts, and sends; what a turn may do is the sender's
 * role, enforced per tool, so a viewer's turn reads and creates nothing.
 * Conversations and runs are workspace-scoped: another workspace's id is a 404.
 */

const conversationId = z.string().cuid()
const runId = z.string().cuid()

export const conversationRouter = router({
  /** Start a conversation, optionally about an existing campaign. */
  create: organizationProcedure('workspace:read')
    .input(
      z.object({
        campaignId: z.string().cuid().optional(),
        title: z.string().trim().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => ({
      conversation: await backendSDK(ctx.access).createConversation(input),
    })),

  /** The workspace's active conversations, most recently active first. */
  list: organizationProcedure('workspace:read')
    .input(z.object({ campaignId: z.string().cuid().optional() }))
    .query(async ({ ctx, input }) => backendSDK(ctx.access).listConversations(input)),

  /** Messages, plus the status and steps of each run they reference. Poll while a run is RUNNING. */
  get: organizationProcedure('workspace:read')
    .input(z.object({ conversationId }))
    .query(async ({ ctx, input }) => getConversationView(ctx.access, input.conversationId)),

  /** Persist the message and start the turn; the agent answers in the background. */
  send: organizationProcedure('workspace:read')
    .input(z.object({ content: z.string().trim().min(1).max(4_000), conversationId }))
    .mutation(async ({ ctx, input }) => {
      await allowAiAction(ctx.access)
      return runTurn(ctx.access, input)
    }),

  /** Re-run one transiently failed step with its recorded input; appends a new step. */
  retryStep: organizationProcedure('workspace:read')
    .input(z.object({ conversationId, runId, stepId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await allowAiAction(ctx.access)
      return retryStep(ctx.access, input)
    }),

  /** Stop a running turn after its current tool call; what it made is kept. */
  cancel: organizationProcedure('workspace:read')
    .input(z.object({ runId }))
    .mutation(async ({ ctx, input }) => cancelTurn(ctx.access, input.runId)),
})
