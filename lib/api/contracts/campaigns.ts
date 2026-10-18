import { z } from 'zod'
import { defineContract, mirrors, pageOf, timestampSchema } from '@/lib/api/contract'
import { idempotencyKeySchema } from '@/lib/api/contracts/releases'
import { scheduledPostStatusSchema } from '@/lib/api/contracts/scheduled-posts'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import type { createCampaign, getCampaign, listCampaigns } from '@/lib/tenant/campaigns'
import {
  campaignCreateSchema,
  campaignPostScheduleSchema,
  campaignTransitionSchema,
} from '@/lib/tenant/schemas'

/**
 * Campaign contracts (RFC 018, RFC 019, RFC 037). Every operation needs the
 * campaign workflow. API keys read with `artifact:read`, create drafts with
 * `release:create`, and schedule approved posts with `post:schedule`;
 * approving stays with a person.
 */

/** Lifecycle states of a campaign. */
export const campaignStatusSchema = z.enum(['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ARCHIVED'])

/** Review and delivery states of a campaign post (RFC 019). */
export const campaignPostStatusSchema = z.enum([
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_CHANGES',
  'SCHEDULED',
  'PUBLISHED',
])

/** The `{campaignId}` path parameter. */
export const campaignParamsSchema = z.object({ campaignId: z.string().cuid() })

/** A campaign as listed. */
export const campaignSummarySchema = mirrors<Awaited<ReturnType<typeof listCampaigns>>[number]>()(
  z.object({
    audience: z.string().nullable(),
    createdAt: timestampSchema,
    createdByUserId: z.string().nullable(),
    feature: z.string().nullable(),
    id: z.string(),
    messaging: z.string().nullable(),
    name: z.string(),
    objective: z.string(),
    organizationId: z.string(),
    productSurfaceId: z.string().nullable(),
    release: z.object({ id: z.string(), title: z.string() }).nullable(),
    releaseId: z.string().nullable(),
    status: campaignStatusSchema,
    updatedAt: timestampSchema,
  })
)

/** One channel post of a campaign, with its review and delivery state. */
export const campaignPostSchema = mirrors<
  NonNullable<Awaited<ReturnType<typeof getCampaign>>>['posts'][number]
>()(
  z.object({
    angleId: z.string().nullable(),
    approvedAt: timestampSchema.nullable(),
    approvedByUserId: z.string().nullable(),
    callToAction: z.string().nullable(),
    campaignId: z.string(),
    channel: z.string(),
    claims: z.array(z.record(z.string(), z.unknown())).nullable(),
    copy: z.string(),
    createdAt: timestampSchema,
    creativeVariantId: z.string().nullable(),
    id: z.string(),
    organizationId: z.string(),
    phase: z.string().nullable(),
    planItemKey: z.string().nullable(),
    planVersion: z.int().nullable(),
    reviewNote: z.string().nullable().describe('Why a reviewer rejected or asked for changes.'),
    scheduledAt: timestampSchema.nullable(),
    scheduledPostId: z.string().nullable(),
    scheduledPostStatus: scheduledPostStatusSchema
      .nullable()
      .describe('Delivery state of `scheduledPostId`.'),
    specVersion: z.int().nullable(),
    status: campaignPostStatusSchema,
    title: z.string().nullable(),
    updatedAt: timestampSchema,
  })
)

/** A content angle a campaign's posts draw on. */
export const campaignAngleSchema = mirrors<
  NonNullable<Awaited<ReturnType<typeof getCampaign>>>['angles'][number]
>()(
  z.object({
    campaignId: z.string(),
    createdAt: timestampSchema,
    hook: z.string(),
    id: z.string(),
    organizationId: z.string(),
    position: z.int(),
    title: z.string(),
    updatedAt: timestampSchema,
  })
)

/**
 * A media asset linked to a campaign. The storage key is internal and is
 * left out; sign a download URL for the bytes.
 */
export const campaignAssetSchema = z.object({
  asset: z.object({
    height: z.int().nullable(),
    id: z.string(),
    mediaType: z.string(),
    width: z.int().nullable(),
  }),
  assetId: z.string(),
  campaignId: z.string(),
  caption: z.string().nullable(),
  createdAt: timestampSchema,
  id: z.string(),
  kind: z.string(),
  organizationId: z.string(),
  planAssetKey: z.string().nullable(),
  planVersion: z.int().nullable(),
  variantLabel: z.string().nullable(),
})

/** A campaign with its angles, posts, assets, product page, and release. */
export const campaignDetailSchema = campaignSummarySchema.omit({ release: true }).extend({
  angles: z.array(campaignAngleSchema),
  assets: z.array(campaignAssetSchema),
  posts: z.array(campaignPostSchema),
  productSurface: mirrors<NonNullable<Awaited<ReturnType<typeof getCampaign>>>['productSurface']>()(
    z
      .object({ environment: z.string(), id: z.string(), name: z.string(), url: z.string() })
      .nullable()
  ),
  release: mirrors<NonNullable<Awaited<ReturnType<typeof getCampaign>>>['release']>()(
    z
      .object({
        audience: z.string().nullable(),
        benefitStatement: z.string(),
        description: z.string().nullable(),
        id: z.string(),
        sourceUrls: z.array(z.string()),
        status: z.string(),
        title: z.string(),
        updatedAt: timestampSchema,
      })
      .nullable()
  ),
})

const campaignNotFound = 'No campaign with that ID exists in this workspace.'

/** `GET /api/v1/campaigns` */
export const listCampaignsContract = defineContract({
  access: {
    apiKeyScope: 'artifact:read',
    feature: 'campaign:workflow',
    permission: 'artifact:read',
  },
  docs: workspaceDocs({
    description:
      'Lists every campaign in the workspace, newest first. Requires the `artifact:read` scope.',
    operationId: 'listCampaigns',
    outputName: 'CampaignListResponse',
    responses: { '200': 'Workspace campaigns.' },
    tag: 'Campaigns',
  }),
  method: 'GET',
  name: 'campaigns.list',
  output: pageOf(campaignSummarySchema),
  path: '/api/v1/campaigns',
  summary: 'List campaigns',
})

/** `GET /api/v1/campaigns/{campaignId}` */
export const getCampaignContract = defineContract({
  access: {
    apiKeyScope: 'artifact:read',
    feature: 'campaign:workflow',
    permission: 'artifact:read',
  },
  docs: workspaceDocs({
    description:
      'Returns a campaign with its angles, channel posts, linked assets, product page, and release. Each post carries its review status and, once scheduled, its delivery status. Requires the `artifact:read` scope.',
    operationId: 'getCampaign',
    outputName: 'CampaignDetail',
    responses: {
      '200': 'The campaign.',
      '400': 'The campaign identifier is invalid.',
      '404': campaignNotFound,
    },
    tag: 'Campaigns',
  }),
  method: 'GET',
  name: 'campaigns.get',
  output: campaignDetailSchema,
  params: campaignParamsSchema,
  path: '/api/v1/campaigns/{campaignId}',
  summary: 'Get a campaign',
})

/** `POST /api/v1/campaigns` */
export const createCampaignContract = defineContract({
  access: {
    apiKeyScope: 'release:create',
    feature: 'campaign:workflow',
    permission: 'release:create',
    quota: 'api:write:minute',
  },
  body: campaignCreateSchema.strict(),
  docs: workspaceDocs({
    bodyName: 'CampaignCreateRequest',
    description:
      'Creates a draft campaign with its angles and channel posts. Every post starts as `DRAFT`; nothing is reviewed, scheduled, or published. Copy is checked against the brand profile. Accepts `Idempotency-Key`: a retry with the same key returns the first campaign with `200`. Requires the `release:create` scope.',
    operationId: 'createCampaign',
    responses: {
      '200': 'An earlier request with this idempotency key created the campaign.',
      '201': 'Campaign created.',
      '400': 'The campaign input is invalid.',
      '404': 'The release or product page is not in this workspace.',
      '409': 'A post uses a term the brand profile prohibits.',
      '429': 'The workspace write quota is exhausted.',
    },
    tag: 'Campaigns',
  }),
  headers: z.object({ 'idempotency-key': idempotencyKeySchema.optional() }),
  method: 'POST',
  name: 'campaigns.create',
  output: z.object({
    campaign: campaignDetailSchema,
    created: mirrors<Awaited<ReturnType<typeof createCampaign>>['created']>()(z.boolean()),
  }),
  path: '/api/v1/campaigns',
  status: 201,
  summary: 'Create a draft campaign',
})

/** `POST /api/v1/campaigns/{campaignId}/transitions` */
export const transitionCampaignContract = defineContract({
  access: {
    apiKeyScope: 'release:create',
    feature: 'campaign:workflow',
    // Membership only: the backend's transition table decides each role.
    permission: 'artifact:read',
    quota: 'api:write:minute',
  },
  body: campaignTransitionSchema.omit({ campaignId: true }).strict(),
  docs: workspaceDocs({
    bodyName: 'CampaignTransitionRequest',
    description:
      'Moves a campaign through its lifecycle: `DRAFT` to `READY_FOR_REVIEW` or `ARCHIVED`, back to `DRAFT`, or out of the archive. Moving to `APPROVED` needs a signed-in approver; an API key is refused. The transition applies only from the status the campaign has now, so a repeated request returns `409` and changes nothing. Requires the `release:create` scope.',
    operationId: 'transitionCampaign',
    responses: {
      '200': 'The campaign moved to the new status.',
      '400': 'The status is not a campaign status.',
      '403': 'Approving needs a signed-in approver, or the principal lacks the scope or plan.',
      '404': campaignNotFound,
      '409': 'The campaign cannot move to that status from its current one.',
      '429': 'The workspace write quota is exhausted.',
    },
    tag: 'Campaigns',
  }),
  method: 'POST',
  name: 'campaigns.transition',
  output: z.object({ id: z.string(), status: campaignStatusSchema }),
  params: campaignParamsSchema,
  path: '/api/v1/campaigns/{campaignId}/transitions',
  summary: 'Change a campaign status',
})

/** The `{campaignId}` and `{postId}` path parameters. */
export const campaignPostParamsSchema = campaignParamsSchema.extend({ postId: z.string().cuid() })

/** `POST /api/v1/campaigns/{campaignId}/posts/{postId}/schedule` */
export const scheduleCampaignPostContract = defineContract({
  access: {
    apiKeyScope: 'post:schedule',
    feature: 'campaign:workflow',
    permission: 'publish:manage',
    quota: 'api:write:minute',
  },
  body: campaignPostScheduleSchema
    .extend({
      scheduledAt: z.iso
        .datetime({ offset: true })
        .transform((value) => new Date(value))
        .refine((value) => value.getTime() > Date.now(), 'Scheduled time must be in the future.')
        .optional()
        .describe(
          'When to publish, as an RFC 3339 timestamp in the future. Defaults to the next default publish time in the workspace time zone.'
        ),
    })
    .strict(),
  docs: workspaceDocs({
    bodyName: 'CampaignPostScheduleRequest',
    description:
      'Schedules an approved campaign post on a channel connection that publishes its channel. The post must be `APPROVED` with an approved visual: the one it has, or `creativeVariantId`, an approved variant of this campaign’s designs. Scheduling never approves. The copy is checked again against the brand profile and the channel’s character limit, and every link in the post is read first: a link whose preview is broken stops the schedule unless `skipLinkCheck` is true. Each new post counts against the monthly posts allowance. Repeating the request on the same channel returns the post as scheduled; a cancelled or failed post can be scheduled again. Requires the `post:schedule` scope, or a member who manages publishing.',
    operationId: 'scheduleCampaignPost',
    responses: {
      '200': 'The post is scheduled.',
      '400': 'The input is invalid, or the channel connection cannot be used.',
      '404': 'The campaign, post, or variant is not in this workspace.',
      '409':
        'The post is not approved, has no approved visual, does not fit the channel, uses a prohibited term, has a link that would preview badly, or may already be live.',
      '429': 'The monthly posts allowance or the workspace write quota is exhausted.',
    },
    tag: 'Campaigns',
  }),
  method: 'POST',
  name: 'campaigns.schedule-post',
  output: campaignPostSchema,
  params: campaignPostParamsSchema,
  path: '/api/v1/campaigns/{campaignId}/posts/{postId}/schedule',
  summary: 'Schedule a campaign post',
})
