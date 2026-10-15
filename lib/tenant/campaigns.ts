import 'server-only'

import type { BackendCampaignStatus } from 'screenshot-studio-backend-sdk'
import { backendSDK, orNull, withDates } from '@/lib/backend/sdk'
import type { OrganizationAccess, TenantContext } from '@/lib/auth/access'
import type { CampaignApprovalDecision } from './campaign-status'
import type { CampaignCreateInput, CampaignPostScheduleInput } from './schemas'

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message)
    this.name = 'CampaignError'
  }
}

export async function listCampaigns(context: TenantContext) {
  return withDates((await backendSDK(context).listCampaigns()).campaigns)
}

export async function getCampaign(context: TenantContext, campaignId: string) {
  return withDates(await orNull(backendSDK(context).getCampaign(campaignId)))
}

export async function createCampaign(context: TenantContext, input: CampaignCreateInput) {
  for (const post of input.posts) {
    if (post.angleIndex !== undefined && post.angleIndex >= input.angles.length) {
      throw new CampaignError('A post references an angle that does not exist.', 400)
    }
  }
  // New campaigns start as DRAFT; the backend links the release and its surface.
  return withDates(await backendSDK(context).createCampaign(input))
}

/**
 * Move a campaign through its lifecycle. The backend checks the transition
 * table against the stored status and the caller's role, and applies the
 * write conditionally so two racing transitions cannot both apply.
 */
export async function transitionCampaign(
  access: OrganizationAccess,
  campaignId: string,
  to: BackendCampaignStatus
) {
  return backendSDK(access).transitionCampaign(campaignId, to)
}

export async function transitionCampaignPosts(
  context: TenantContext,
  campaignId: string,
  decision: CampaignApprovalDecision,
  postIds?: readonly string[],
  note?: string
) {
  return backendSDK(context).decideCampaignPosts(campaignId, { decision, note, postIds })
}

/** The backend creates the canonical scheduled post and starts its workflow. */
export async function scheduleCampaignPost(
  context: TenantContext,
  campaignId: string,
  postId: string,
  input: CampaignPostScheduleInput
) {
  return withDates(
    await backendSDK(context).scheduleCampaignPost(campaignId, postId, {
      channelConnectionId: input.channelConnectionId,
      scheduledAt: input.scheduledAt?.toISOString(),
    })
  )
}
