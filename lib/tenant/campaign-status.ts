import type { CampaignPostStatus } from '@prisma/client'
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
