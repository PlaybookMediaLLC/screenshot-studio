import type { CampaignPostStatus, CampaignStatus } from '@prisma/client'
import type { Permission } from '@/lib/auth/permissions'

export type CampaignApprovalDecision = 'submit' | 'approve' | 'reject' | 'request_changes'

export type CampaignPostTransition = {
  from: readonly CampaignPostStatus[]
  permission: Permission
  to: CampaignPostStatus
}

export const campaignPostTransitions: Record<CampaignApprovalDecision, CampaignPostTransition> = {
  approve: { from: ['READY_FOR_REVIEW'], permission: 'release:approve', to: 'APPROVED' },
  reject: { from: ['READY_FOR_REVIEW'], permission: 'release:approve', to: 'REJECTED' },
  request_changes: {
    from: ['READY_FOR_REVIEW'],
    permission: 'release:approve',
    to: 'NEEDS_CHANGES',
  },
  submit: {
    from: ['DRAFT', 'NEEDS_CHANGES'],
    permission: 'release:create',
    to: 'READY_FOR_REVIEW',
  },
}

export function canTransitionCampaignPost(
  decision: CampaignApprovalDecision,
  status: CampaignPostStatus
): boolean {
  return campaignPostTransitions[decision].from.includes(status)
}

/**
 * Campaign lifecycle. Status is always set explicitly through this table and
 * never inferred from which fields happen to be filled in. Generation and
 * publishing are job states, not campaign states, so they do not appear here.
 */
export const campaignStatusTransitions: Record<
  CampaignStatus,
  Partial<Record<CampaignStatus, Permission>>
> = {
  APPROVED: { ARCHIVED: 'release:create', DRAFT: 'release:create' },
  ARCHIVED: { DRAFT: 'release:create' },
  DRAFT: { ARCHIVED: 'release:create', READY_FOR_REVIEW: 'release:create' },
  READY_FOR_REVIEW: {
    APPROVED: 'release:approve',
    ARCHIVED: 'release:create',
    DRAFT: 'release:create',
  },
}

export function getCampaignTransitionPermission(
  from: CampaignStatus,
  to: CampaignStatus
): Permission | null {
  return campaignStatusTransitions[from][to] ?? null
}
