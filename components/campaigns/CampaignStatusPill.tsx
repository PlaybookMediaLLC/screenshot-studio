import type { CampaignStatus } from '@prisma/client'
import { Pill, type PillTone } from '@/components/platform-ui'

const STATUS: Record<CampaignStatus, { label: string; tone: PillTone }> = {
  APPROVED: { label: 'Approved', tone: 'green' },
  ARCHIVED: { label: 'Archived', tone: 'red' },
  DRAFT: { label: 'Draft', tone: 'gray' },
  READY_FOR_REVIEW: { label: 'In review', tone: 'yellow' },
}

export const CAMPAIGN_STATUSES = Object.keys(STATUS) as CampaignStatus[]

export function campaignStatusLabel(status: CampaignStatus): string {
  return STATUS[status].label
}

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  return <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>
}
