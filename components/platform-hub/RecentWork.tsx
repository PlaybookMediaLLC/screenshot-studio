'use client'

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
    <section aria-label="Continue working" className="space-y-4">
      <h2 className="text-lg font-medium">Continue working</h2>
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
        <ul className="divide-y rounded-xl border">
          {query.data.items.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              <SidebarLink
                className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50"
                href={item.href}
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.type} · {item.scope}
                  </span>
                </span>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={item.updatedAt.toISOString()}
                >
                  {item.updatedAt.toLocaleDateString()}
                </time>
              </SidebarLink>
            </li>
          ))}
        </ul>
      ) : query.data && !query.data.partial ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Your saved screenshots, canvases and drafts will appear here. Start something below.
        </p>
      ) : null}
      <SidebarLink
        href="/library?type=store"
        className="inline-block text-sm text-muted-foreground underline"
      >
        Find store projects saved on this browser
      </SidebarLink>
    </section>
  )
}
