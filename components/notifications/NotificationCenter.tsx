'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, GitBranch, MessageSquare, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { RunStatusPill, relativeTime } from '@/components/workflows/workflow-ui'
import {
  notificationRequest,
  useNotificationIdentity,
  useNotificationPageVisible,
} from '@/lib/notifications/client'
import {
  notificationPageSchema,
  notificationSeenSchema,
  type NotificationItem,
} from '@/lib/notifications/schema'
import { groupNotifications, notificationTitle } from '@/lib/notifications/presentation'

const countSchema = z.object({ unseenCount: z.number().int().nonnegative() })

function NotificationRow({
  item,
  busy,
  change,
  open,
}: {
  item: NotificationItem
  busy: boolean
  change: (id: string, seen: boolean) => void
  open: (item: NotificationItem) => void
}) {
  const context = item.context
  const title = notificationTitle(item)
  const SourceIcon = context?.repository
    ? GitBranch
    : context?.source === 'workflows'
      ? Workflow
      : context?.source === 'comments' || context?.source === 'reviews'
        ? MessageSquare
        : Bell
  return (
    <li
      className={`min-w-0 py-4 ${item.seenAt ? 'text-muted-foreground' : 'text-foreground'}`}
      data-notification-id={item.id}
      aria-label={`${item.seenAt ? 'Seen' : 'Unseen'}: ${title}`}
    >
      <button
        type="button"
        disabled={!item.href || busy}
        onClick={() => open(item)}
        aria-label={`${item.seenAt ? 'Seen' : 'Unseen'}: ${title}. Open activity`}
        className="group flex w-full min-w-0 gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
      >
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <SourceIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {!item.seenAt ? (
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-violet-500 ring-2 ring-background" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">
          <span
            className={`block text-sm leading-5 ${item.seenAt ? 'font-normal' : 'font-semibold'}`}
          >
            {title}
          </span>
          {context?.repository ||
          context?.branch ||
          context?.tag ||
          context?.pullRequest ||
          context?.campaignName ||
          context?.storySetName ? (
            <span className="block text-xs text-muted-foreground">
              {[
                context.repository,
                context.branch,
                context.tag,
                context.pullRequest ? `PR #${context.pullRequest}` : null,
                context.campaignName,
                context.storySetName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
          {context?.message ? (
            <span
              className="line-clamp-2 block text-xs leading-5 text-muted-foreground"
              title={context.message}
            >
              {context.message}
            </span>
          ) : null}
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="capitalize">
              {context?.actorName || context?.source || item.workspaceName}
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>
              {relativeTime(item.createdAt)}
            </time>
          </span>
        </span>
      </button>
      <div className="ml-11 mt-3 flex flex-wrap items-center gap-2">
        {context?.status ? <RunStatusPill status={context.status} /> : null}
        {item.href ? (
          <button
            type="button"
            disabled={busy}
            className="text-xs font-medium underline underline-offset-4 disabled:opacity-50"
            onClick={() => open(item)}
          >
            Open activity
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="ml-auto text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
          onClick={() => change(item.id, !item.seenAt)}
        >
          {item.seenAt ? 'Mark as unseen' : 'Mark as seen'}
        </button>
      </div>
    </li>
  )
}

function OpenInbox({
  identity,
  close,
  unseenCount,
}: {
  identity: ReturnType<typeof useNotificationIdentity>
  close: () => void
  unseenCount: number
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | 'unseen'>('all')
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<{ key: string; count: number } | null>(null)
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [undo])
  const [, tick] = useState(0)
  const markAllKey = useRef<string | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    const timer = setInterval(() => tick((n) => n + 1), 60_000)
    return () => {
      live.current = false
      clearInterval(timer)
    }
  }, [])
  const inbox = useInfiniteQuery({
    queryKey: [...identity.key, 'inbox', filter],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      notificationRequest(
        identity,
        `/inbox?filter=${filter}&cursor=${encodeURIComponent(pageParam)}`,
        notificationPageSchema,
        { signal }
      ),
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  async function refresh(unseenCount: number) {
    queryClient.setQueryData([...identity.key, 'count'], { unseenCount })
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('workspace-notifications')
      channel.postMessage({ userId: identity.userId, workspaceId: identity.workspaceId })
      channel.close()
    }
    await queryClient.invalidateQueries({ queryKey: identity.key })
  }
  const mutation = useMutation({
    mutationFn: async (
      action: { id: string; seen: boolean } | { all: true; key: string; undo?: boolean }
    ) => {
      const single = 'id' in action
      const result = await notificationRequest(
        identity,
        single ? `/items/${encodeURIComponent(action.id)}` : '/seen',
        notificationSeenSchema,
        {
          method: single ? 'PATCH' : 'POST',
          body: single ? { seen: action.seen } : action,
        }
      )
      await refresh(result.unseenCount)
      return result
    },
    onSuccess: () => setError(''),
    onError: (failure) => {
      setError(failure.message)
      toast.error(failure.message)
    },
  })
  async function markAll() {
    markAllKey.current ??= crypto.randomUUID()
    const key = markAllKey.current
    try {
      const result = await mutation.mutateAsync({ all: true, key })
      markAllKey.current = null
      setUndo({ key, count: result.updated })
    } catch {
      /* Keep the same action key for a safe retry. */
    }
  }
  const [opening, setOpening] = useState(false)
  async function openActivity(item: NotificationItem) {
    setOpening(true)
    try {
      const result = await notificationRequest(
        identity,
        `/resolve/${encodeURIComponent(item.id)}`,
        z.object({ href: z.string() })
      )
      if (!live.current) return
      if (!result.href || !result.href.startsWith('/') || result.href.startsWith('//'))
        throw new Error('This activity is no longer available.')
      await mutation.mutateAsync({ id: item.id, seen: true })
      if (!live.current) return
      close()
      router.push(result.href)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'This activity is no longer available.')
    } finally {
      setOpening(false)
    }
  }
  const items = [
    ...new Map(
      (inbox.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])
    ).values(),
  ]
  const groups = groupNotifications(items)
  const busy = mutation.isPending || opening
  const row = (item: NotificationItem) => (
    <NotificationRow
      key={item.id}
      item={item}
      busy={busy}
      change={(id, seen) => mutation.mutate({ id, seen })}
      open={(item) => void openActivity(item)}
    />
  )
  return (
    <>
      {undo ? (
        <div
          role="status"
          className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-xs shadow-sm"
        >
          <span>{undo.count} notifications marked as seen</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              mutation.mutate(
                { all: true, key: undo.key, undo: true },
                { onSuccess: () => setUndo(null) }
              )
            }
          >
            Undo
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pb-4">
        <div
          role="group"
          aria-label="Filter notifications"
          className="flex gap-1 rounded-lg bg-muted p-1"
        >
          {(['all', 'unseen'] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All' : `Unseen (${unseenCount})`}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || unseenCount === 0}
          onClick={() => void markAll()}
        >
          Mark all as seen
        </Button>
      </div>
      {error || inbox.error ? (
        <p role="alert" className="px-5 text-sm text-destructive">
          {error || inbox.error?.message}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6" aria-busy={inbox.isFetching}>
        {!items.length && !inbox.isPending && !inbox.isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {filter === 'unseen' ? 'No unseen notifications' : 'No notifications'}
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="sticky top-0 z-10 bg-background py-3 text-xs font-medium text-muted-foreground">
              {group.label}
            </h3>
            <ul className="divide-y divide-border">
              {group.batches.map((batch) =>
                batch.items.length >= 3 ? (
                  <li key={batch.key}>
                    <details className="py-3">
                      <summary className="cursor-pointer rounded-md py-2 text-sm font-medium [overflow-wrap:anywhere]">
                        {batch.items[0].description}{' '}
                        <span className="text-muted-foreground">
                          · {batch.items.length} events
                          {batch.items.some((item) => !item.seenAt)
                            ? ` · ${batch.items.filter((item) => !item.seenAt).length} unseen`
                            : ' · Seen'}
                        </span>
                      </summary>
                      <ul className="divide-y divide-border">{batch.items.map(row)}</ul>
                    </details>
                  </li>
                ) : (
                  batch.items.map(row)
                )
              )}
            </ul>
          </section>
        ))}
        {inbox.isPending ? (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            Loading notifications…
          </p>
        ) : null}
        {inbox.hasNextPage ? (
          <Button
            className="mt-4 w-full"
            variant="outline"
            disabled={inbox.isFetching}
            onClick={() => void inbox.fetchNextPage()}
          >
            {inbox.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
          </Button>
        ) : null}
        {inbox.isError ? (
          <Button variant="outline" onClick={() => void inbox.refetch()}>
            Retry loading
          </Button>
        ) : null}
      </div>
      <Link
        className="border-t border-border px-5 py-4 text-xs text-muted-foreground underline underline-offset-4"
        href="/workspace/notifications"
        onClick={close}
      >
        Notification settings
      </Link>
    </>
  )
}

/** Shared, explicit notification state across desktop, mobile, and browser tabs. */
export function NotificationCenter({ collapsed = true }: { collapsed?: boolean }) {
  const identity = useNotificationIdentity()
  const visible = useNotificationPageVisible()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const count = useQuery({
    queryKey: [...identity.key, 'count'],
    queryFn: ({ signal }) => notificationRequest(identity, '/count', countSchema, { signal }),
    enabled: identity.ready && visible,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: visible ? 30_000 : false,
    refetchIntervalInBackground: false,
  })
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return
    const channel = new BroadcastChannel('workspace-notifications')
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = z.object({ userId: z.string(), workspaceId: z.string() }).safeParse(event.data)
      if (
        parsed.success &&
        parsed.data.userId === identity.userId &&
        parsed.data.workspaceId === identity.workspaceId
      )
        void queryClient.invalidateQueries({ queryKey: identity.key })
    }
    return () => channel.close()
  }, [identity.key, identity.userId, identity.workspaceId, queryClient])
  if (!identity.ready) return null
  const n = count.data?.unseenCount ?? 0
  const badge = n > 99 ? '99+' : n
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications, ${badge} unseen`}
          className={`relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground ${collapsed ? 'w-8 justify-center' : 'w-full'}`}
        >
          <Bell className="size-[17px] shrink-0" aria-hidden="true" />
          {!collapsed ? <span>Notifications</span> : null}
          {n > 0 ? (
            <span
              aria-hidden="true"
              className={
                collapsed
                  ? 'absolute -right-1 -top-1 min-w-4 rounded-full bg-violet-500 px-1 text-center text-[9px] text-white'
                  : 'ml-auto rounded-full bg-violet-500 px-1.5 text-xs text-white'
              }
            >
              {badge}
            </span>
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-hidden sm:max-w-lg">
        <SheetHeader className="px-5 pb-4 pt-6">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>
            <span aria-live="polite">{n} unseen</span> · Your workspace activity, kept in one place.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <OpenInbox
            key={`${identity.userId}:${identity.workspaceId}`}
            identity={identity}
            close={() => setOpen(false)}
            unseenCount={n}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
