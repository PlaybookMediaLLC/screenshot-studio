'use client'

import type { CampaignStatus } from '@prisma/client'
import { ArrowRight01Icon, Search01Icon } from 'hugeicons-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Group } from '@/components/platform-ui'
import { CAMPAIGN_STATUSES, CampaignStatusPill, campaignStatusLabel } from './CampaignStatusPill'

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
        <label className="relative block w-full md:max-w-64">
          <span className="sr-only">Search campaigns</span>
          <Search01Icon
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500"
            size={15}
          />
          <input
            className="h-9 w-full rounded-lg bg-white/[0.03] pr-3 pl-9 text-sm text-white ring-1 ring-white/[0.08] outline-none placeholder:text-neutral-600 focus:ring-white/20"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={query}
          />
        </label>
        <label className="w-full md:w-auto">
          <span className="sr-only">Filter by status</span>
          <select
            className="h-9 w-full rounded-lg bg-white/[0.03] px-3 text-sm text-neutral-200 ring-1 ring-white/[0.08] outline-none md:w-auto"
            onChange={(event) => setStatus(event.target.value as CampaignStatus | 'ALL')}
            value={status}
          >
            <option value="ALL">All statuses</option>
            {CAMPAIGN_STATUSES.map((value) => (
              <option key={value} value={value}>
                {campaignStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">No campaigns match.</p>
      ) : (
        <Group>
          {visible.map((campaign) => (
            <Link
              className="group flex items-center justify-between gap-6 px-5 py-4 transition-colors hover:bg-white/[0.025]"
              href={`/campaigns/${campaign.id}`}
              key={campaign.id}
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">
                    {campaign.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">
                    {campaign.releaseTitle
                      ? `Release · ${campaign.releaseTitle}`
                      : (campaign.objective ?? 'No release linked')}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-4 md:gap-6">
                <CampaignStatusPill status={campaign.status} />
                <span className="hidden w-24 text-right text-xs text-neutral-500 md:block">
                  {updatedLabel(campaign.updatedAt)}
                </span>
                <ArrowRight01Icon
                  className="text-neutral-600 transition-colors group-hover:text-neutral-300"
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
