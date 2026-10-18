import { z } from 'zod'
import { defineContract, mirrors, pageOf } from '@/lib/api/contract'
import {
  campaignParamsSchema,
  campaignPostSchema,
  campaignPostStatusSchema,
  campaignStatusSchema,
} from '@/lib/api/contracts/campaigns'
import { memberDocs, workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import type { listPendingApprovals } from '@/lib/tenant/campaigns'
import { campaignApprovalSchema } from '@/lib/tenant/schemas'

/**
 * Approval contracts (RFC 019). Reading the review queue and asking for
 * review are open to API keys; approving, rejecting, and requesting changes
 * are a person's decisions and refuse API keys.
 */

/** A post waiting for review, with the campaign it belongs to. */
export const pendingApprovalSchema = mirrors<
  Awaited<ReturnType<typeof listPendingApprovals>>['items'][number]
>()(
  z.object({
    campaign: z.object({ id: z.string(), name: z.string(), status: campaignStatusSchema }),
    post: campaignPostSchema,
  })
)

/** Query of `GET /api/v1/approvals`. */
export const approvalListQuerySchema = z.object({
  /** Opaque cursor from the previous page's `pagination.nextCursor`. */
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** The posts a decision or review request moved, and the status they reached. */
export const postTransitionSchema = z.object({
  postIds: z.array(z.string()),
  status: campaignPostStatusSchema,
})

/** Decisions a reviewer makes; `submit` is a review request, not a decision. */
export const reviewDecisionSchema = campaignApprovalSchema.shape.decision.exclude(['submit'])

const campaignNotFound = 'No campaign with that ID exists in this workspace.'

/** `GET /api/v1/approvals` */
export const listApprovalsContract = defineContract({
  access: {
    apiKeyScope: 'artifact:read',
    feature: 'campaign:workflow',
    permission: 'artifact:read',
  },
  docs: workspaceDocs({
    description:
      'Lists the review queue: campaign posts in `READY_FOR_REVIEW`, oldest first, each with its campaign. Requires the `artifact:read` scope.',
    operationId: 'listApprovals',
    outputName: 'ApprovalListResponse',
    responses: { '200': 'Posts waiting for review.', '400': 'The list query is invalid.' },
    tag: 'Approvals',
  }),
  method: 'GET',
  name: 'approvals.list',
  output: pageOf(pendingApprovalSchema),
  path: '/api/v1/approvals',
  query: approvalListQuerySchema,
  summary: 'List posts waiting for review',
})

/** `POST /api/v1/campaigns/{campaignId}/approvals` */
export const decideCampaignApprovalContract = defineContract({
  access: { feature: 'campaign:workflow', permission: 'release:approve' },
  body: campaignApprovalSchema.extend({ decision: reviewDecisionSchema }).strict(),
  docs: memberDocs({
    bodyName: 'CampaignApprovalRequest',
    description:
      'Approves, rejects, or requests changes on posts in `READY_FOR_REVIEW`. Without `postIds` the decision applies to every post waiting for review; with `postIds` it applies to exactly those, and if any is not waiting the whole call fails and nothing changes. A note on a rejection or change request guides the next draft. One audit record covers the batch. A repeated decision returns `409`. Requires a signed-in approver; API keys and agents can never approve.',
    operationId: 'decideCampaignApproval',
    responses: {
      '200': 'The posts moved to the decided status.',
      '400': 'The decision input is invalid.',
      '404': campaignNotFound,
      '409': 'No post, or not every listed post, is waiting for review.',
    },
    tag: 'Approvals',
  }),
  method: 'POST',
  name: 'approvals.decide',
  output: postTransitionSchema,
  params: campaignParamsSchema,
  path: '/api/v1/campaigns/{campaignId}/approvals',
  summary: 'Decide on posts waiting for review',
})

/** `POST /api/v1/campaigns/{campaignId}/review-requests` */
export const requestCampaignReviewContract = defineContract({
  access: {
    apiKeyScope: 'release:create',
    feature: 'campaign:workflow',
    permission: 'release:create',
    quota: 'api:write:minute',
  },
  body: z.object({ postIds: campaignApprovalSchema.shape.postIds }).strict(),
  docs: workspaceDocs({
    bodyName: 'CampaignReviewRequest',
    description:
      'Submits draft and needs-changes posts for review, moving them to `READY_FOR_REVIEW` and notifying approvers. Without `postIds` every eligible post is submitted; with `postIds` exactly those, or nothing when any is not eligible. A repeated request returns `409`. Requires the `release:create` scope. Only a person can approve what is submitted.',
    operationId: 'requestCampaignReview',
    responses: {
      '200': 'The posts are waiting for review.',
      '400': 'The post identifiers are invalid.',
      '404': campaignNotFound,
      '409': 'No post, or not every listed post, is a draft or needs changes.',
      '429': 'The workspace write quota is exhausted.',
    },
    tag: 'Approvals',
  }),
  method: 'POST',
  name: 'approvals.request-review',
  output: postTransitionSchema,
  params: campaignParamsSchema,
  path: '/api/v1/campaigns/{campaignId}/review-requests',
  summary: 'Submit posts for review',
})
