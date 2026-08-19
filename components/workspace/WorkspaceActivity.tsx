'use client'

import { TRPCClientError } from '@trpc/client'
import { useEffect, useState } from 'react'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

/**
 * The work a workspace has in flight: releases, campaigns,
 * announcements, and scheduled posts.
 *
 * These domains had list procedures with no screen, so a team could
 * create work through the API and then had nowhere to see it. This page
 * is read-only on purpose: creation flows are workflow features with
 * their own RFCs, and a visible list is the smallest step that makes
 * the platform legible.
 */

type TRPC = ReturnType<typeof useTRPCClient>

type Row = { id: string; meta: string; status: string; title: string }

type Section = {
  empty: string
  key: string
  load: (trpc: TRPC) => Promise<Row[]>
  title: string
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString()
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const SECTIONS: Section[] = [
  {
    empty: 'Releases arrive through the API or a repository webhook.',
    key: 'releases',
    load: async (trpc) => {
      const { releases } = await trpc.release.list.query()
      return releases.map((release) => ({
        id: release.id,
        meta: `Updated ${formatDate(release.updatedAt)}`,
        status: release.status,
        title: release.title,
      }))
    },
    title: 'Releases',
  },
  {
    empty: 'Campaigns are created through the API.',
    key: 'campaigns',
    load: async (trpc) => {
      const { campaigns } = await trpc.campaign.list.query()
      return campaigns.map((campaign) => ({
        id: campaign.id,
        meta: `${truncate(campaign.objective)} · ${formatDate(campaign.createdAt)}`,
        status: campaign.status,
        title: campaign.name,
      }))
    },
    title: 'Campaigns',
  },
  {
    empty: 'Announcements are scheduled through the API.',
    key: 'announcements',
    load: async (trpc) => {
      const { announcements } = await trpc.announcement.list.query()
      return announcements.map((announcement) => ({
        id: announcement.id,
        meta: `${announcement._count.recipients} recipients · ${formatDate(
          announcement.scheduledFor ?? announcement.createdAt
        )}`,
        status: announcement.status,
        title: announcement.releaseDocument?.release.title ?? 'Announcement',
      }))
    },
    title: 'Announcements',
  },
  {
    empty: 'Posts are scheduled through the API once a channel is connected.',
    key: 'scheduled-posts',
    load: async (trpc) => {
      const { scheduledPosts } = await trpc.scheduledPost.list.query()
      return scheduledPosts.map((post) => ({
        id: post.id,
        meta: `${post.channelConnection.platform} · ${formatDate(post.scheduledFor)}`,
        status: post.status,
        title: truncate(post.caption),
      }))
    },
    title: 'Scheduled posts',
  },
]

type SectionState = { error: string | null; forbidden: boolean; rows: Row[] | null }

function ActivitySection({ section }: { section: Section }) {
  const trpcClient = useTRPCClient()
  const [state, setState] = useState<SectionState>({ error: null, forbidden: false, rows: null })

  useEffect(() => {
    let active = true
    section
      .load(trpcClient)
      .then((rows) => active && setState({ error: null, forbidden: false, rows }))
      .catch((error: unknown) => {
        if (!active) return
        const forbidden = error instanceof TRPCClientError && error.data?.code === 'FORBIDDEN'
        setState({ error: getErrorMessage(error), forbidden, rows: null })
      })
    return () => {
      active = false
    }
  }, [section, trpcClient])

  return (
    <section>
      <h2 className="text-base font-semibold">{section.title}</h2>
      <div className="mt-3">
        {state.rows === null && state.error === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : state.forbidden ? (
          <p className="text-sm text-muted-foreground">
            Your role does not have access to {section.title.toLowerCase()}.
          </p>
        ) : state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : state.rows && state.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6">
            <p className="text-sm text-muted-foreground">Nothing here yet. {section.empty}</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {state.rows?.map((row) => (
              <li className="flex items-center justify-between gap-4 p-4" key={row.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.meta}</p>
                </div>
                <span className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {row.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export function WorkspaceActivity() {
  return (
    <div className="space-y-10">
      {SECTIONS.map((section) => (
        <ActivitySection key={section.key} section={section} />
      ))}
    </div>
  )
}
