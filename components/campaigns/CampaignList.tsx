'use client'

import type { CampaignStatus } from '@/lib/tenant/campaign-status'
import { ArrowRight01Icon, Search01Icon } from 'hugeicons-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Group } from '@/components/platform-ui'
import { CAMPAIGN_STATUSES, CampaignStatusPill, campaignStatusLabel } from './CampaignStatusPill'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

export type CampaignListItem = {
  id: string
  name: string
  objective: string | null
  releaseTitle: string | null
  status: CampaignStatus
  updatedAt: string
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function updatedLabel(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  return Math.abs(days) < 7 ? RELATIVE.format(days, 'day') : new Date(iso).toLocaleDateString()
}

/** Polar-style list: a toolbar to narrow it down, then one quiet row per campaign. */
export function CampaignList({ campaigns }: { campaigns: CampaignListItem[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<CampaignStatus | 'ALL'>('ALL')

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase()
    return campaigns.filter(
      (campaign) =>
        (status === 'ALL' || campaign.status === status) &&
        (!search ||
          `${campaign.name} ${campaign.releaseTitle ?? ''} ${campaign.objective ?? ''}`
            .toLowerCase()
            .includes(search))
    )
  }, [campaigns, query, status])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Label className="relative block w-full md:max-w-64">
          <span className="sr-only">Search campaigns</span>
          <Search01Icon
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            size={15}
          />
          <Input
            className="h-9 w-full rounded-lg bg-foreground/[0.03] pr-3 pl-9 text-sm text-foreground ring-1 ring-foreground/[0.08] outline-none placeholder:text-muted-foreground/75 focus:ring-foreground/20"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={query}
          />
        </Label>
        <Label className="block w-full md:w-auto">
          <span className="sr-only">Filter by status</span>
          <Select
            onValueChange={(nextValue) => setStatus(nextValue as CampaignStatus | 'ALL')}
            value={status}
          >
            <SelectTrigger className="h-9 w-full rounded-lg bg-foreground/[0.03] px-3 text-sm text-foreground ring-1 ring-foreground/[0.08] outline-none md:w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {CAMPAIGN_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {campaignStatusLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No campaigns match.</p>
      ) : (
        <Group>
          {visible.map((campaign) => (
            <Link
              className="group flex items-center justify-between gap-6 px-5 py-4 transition-colors hover:bg-foreground/[0.025]"
              href={`/campaigns/${campaign.id}`}
              key={campaign.id}
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {campaign.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {campaign.releaseTitle
                      ? `Release · ${campaign.releaseTitle}`
                      : (campaign.objective ?? 'No release linked')}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-4 md:gap-6">
                <CampaignStatusPill status={campaign.status} />
                <span className="hidden w-24 text-right text-xs text-muted-foreground md:block">
                  {updatedLabel(campaign.updatedAt)}
                </span>
                <ArrowRight01Icon
                  className="text-muted-foreground/75 transition-colors group-hover:text-foreground/80"
                  size={16}
                />
              </span>
            </Link>
          ))}
        </Group>
      )}
    </div>
  )
}
