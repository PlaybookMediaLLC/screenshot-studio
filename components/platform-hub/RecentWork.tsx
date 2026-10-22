'use client'

import { PiArrowUpRight as ArrowUpRight, PiClock as Clock3, PiFileText as FileText, PiImage as Image, PiStack as Layers } from 'react-icons/pi'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useTRPCClient } from '@/lib/trpc/react'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { Button } from '@/components/ui/button'
import { draftHref } from '@/components/write/write-context'

const draftPage = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      socialSetId: z.string().nullable(),
      updatedAt: z.coerce.date(),
    })
  ),
  pinned: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      socialSetId: z.string().nullable(),
      updatedAt: z.coerce.date(),
    })
  ),
})

type Item = {
  id: string
  href: string
  title: string
  type: string
  scope: string
  updatedAt: Date
}

/** Bounded reads from existing tenant-authorized collections; failures stay visible. */
export function RecentWork({
  draftsEnabled,
  organizationId,
}: {
  draftsEnabled: boolean
  organizationId: string
}) {
  const client = useTRPCClient()
  const query = useQuery({
    queryKey: ['platform', 'recent-work', organizationId, draftsEnabled],
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.allSettled([
        client.project.list.query({ limit: 5, sort: 'updated' }).then(({ items }): Item[] =>
          items.map((item) => ({
            id: item.id,
            href: `/?project=${encodeURIComponent(item.id)}`,
            title: item.name,
            type: 'Screenshot',
            scope: 'Workspace',
            updatedAt: new Date(item.updatedAt),
          }))
        ),
        client.canvas.list.query({ limit: 5, sort: 'updated' }).then(({ items }): Item[] =>
          items.map((item) => ({
            id: item.id,
            href: `/canvas/${item.id}`,
            title: item.name,
            type: 'Canvas',
            scope: 'Workspace',
            updatedAt: new Date(item.updatedAt),
          }))
        ),
        draftsEnabled
          ? fetch('/api/v1/content-drafts?limit=5&sort=updated_desc').then(
              async (response): Promise<Item[]> => {
                if (!response.ok) throw new Error('Drafts could not load.')
                const page = draftPage.parse(await response.json())
                return [...page.pinned, ...page.items].slice(0, 5).map((item) => ({
                  id: item.id,
                  href: draftHref(item.id, item.socialSetId),
                  title: item.title || 'Untitled draft',
                  type: 'Post',
                  scope: 'Publishing brand',
                  updatedAt: item.updatedAt,
                }))
              }
            )
          : Promise.resolve([] as Item[]),
      ])
      return {
        partial: results.some((result) => result.status === 'rejected'),
        items: results
          .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, 9),
      }
    },
  })
  return (
    <section aria-label="Continue working" className="home-recent space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Continue working</h2>
          <p className="mt-1 text-xs text-muted-foreground">Your most recently updated work.</p>
        </div>
        <SidebarLink
          href="/library"
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          View library <ArrowUpRight size={14} aria-hidden="true" />
        </SidebarLink>
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading recent work…
        </p>
      ) : null}
      {query.isError || query.data?.partial ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
        >
          <p>Some recent work could not load.</p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {query.data?.items.length ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-background/30">
          {query.data.items.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              <SidebarLink
                className="group flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
                href={item.href}
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/60 bg-card text-muted-foreground"
                >
                  {item.type === 'Post' ? (
                    <FileText size={18} />
                  ) : item.type === 'Canvas' ? (
                    <Layers size={18} />
                  ) : (
                    <Image size={18} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.type} · {item.scope}
                  </span>
                </span>
                <time
                  className="shrink-0 text-[11px] text-muted-foreground"
                  dateTime={item.updatedAt.toISOString()}
                >
                  {item.updatedAt.toLocaleDateString()}
                </time>
              </SidebarLink>
            </li>
          ))}
        </ul>
      ) : query.data && !query.data.partial ? (
        <div className="home-empty">
          <span className="home-empty-icon">
            <Clock3 size={20} aria-hidden="true" />
          </span>
          <div className="home-empty-copy">
            <p className="text-sm font-medium">Your work will appear here</p>
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Save a screenshot, canvas, or post to keep everything close at hand.
            </p>
            <SidebarLink
              href="/create"
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create your first visual <ArrowUpRight size={13} aria-hidden="true" />
            </SidebarLink>
          </div>
        </div>
      ) : null}
      <SidebarLink
        href="/library?type=store"
        className="inline-block text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Find store projects saved on this browser
      </SidebarLink>
    </section>
  )
}
