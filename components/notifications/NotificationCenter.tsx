'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { observeNotificationSummary } from '@/lib/notifications/visibility'

const countSchema = z.object({ unseenCount: z.number().int().nonnegative() })

function Summary({
  item,
  root,
  acknowledged,
  acknowledge,
}: {
  item: NotificationItem
  root: HTMLElement | null
  acknowledged: boolean
  acknowledge: (id: string) => Promise<void>
}) {
  const summary = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (acknowledged || !summary.current) return
    return observeNotificationSummary(summary.current, root, () => acknowledge(item.id))
  }, [acknowledge, acknowledged, item.id, root])
  return (
    <div ref={summary}>
      <p className="text-sm font-medium text-foreground">{item.description}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.workspaceName} ·{' '}
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
      </p>
    </div>
  )
}

function OpenInbox({
  identity,
  close,
}: {
  identity: ReturnType<typeof useNotificationIdentity>
  close: () => void
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [seen, setSeen] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const markAllKey = useRef<string | null>(null)
  const pending = useRef(new Map<string, Promise<void>>())
  const live = useRef(true)
  const countKey = [...identity.key, 'count']

  const confirmCount = useCallback(
    (unseenCount: number) => {
      if (!queryClient.getQueryState([...identity.key, 'count'])) return
      queryClient.setQueryData([...identity.key, 'count'], { unseenCount })
      void queryClient.invalidateQueries({ queryKey: [...identity.key, 'count'] })
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('workspace-notifications')
        channel.postMessage({ userId: identity.userId, workspaceId: identity.workspaceId })
        channel.close()
      }
    },
    [identity.key, identity.userId, identity.workspaceId, queryClient]
  )

  const load = useCallback(
    async (next = '', signal?: AbortSignal) => {
      setLoading(true)
      try {
        const page = await notificationRequest(
          identity,
          `/inbox?cursor=${encodeURIComponent(next)}`,
          notificationPageSchema,
          { signal }
        )
        if (!live.current) return
        setItems((current) => [
          ...current,
          ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
        ])
        setCursor(page.nextCursor)
        queryClient.setQueryData([...identity.key, 'count'], { unseenCount: page.unseenCount })
        setError('')
      } catch (failure) {
        if (live.current && !signal?.aborted)
          setError(failure instanceof Error ? failure.message : 'Notifications could not load.')
      } finally {
        if (live.current) setLoading(false)
      }
    },
    [identity, queryClient]
  )

  useEffect(() => {
    live.current = true
    const controller = new AbortController()
    void load('', controller.signal)
    return () => {
      live.current = false
      controller.abort()
    }
  }, [load])

  const acknowledge = useCallback(
    (id: string) => {
      const existing = pending.current.get(id)
      if (existing) return existing
      const request = notificationRequest(identity, '/seen', notificationSeenSchema, {
        method: 'POST',
        body: { ids: [id] },
      })
        .then((result) => {
          confirmCount(result.unseenCount)
          if (!live.current) return
          setSeen((current) => new Set([...current, id]))
          setError('')
        })
        .catch((failure: unknown) => {
          if (live.current)
            setError('Could not mark activity seen. Visible items will retry safely.')
          throw failure
        })
        .finally(() => {
          pending.current.delete(id)
        })
      pending.current.set(id, request)
      return request
    },
    [identity, confirmCount]
  )

  async function markAll() {
    markAllKey.current ??= crypto.randomUUID()
    setMarkingAll(true)
    try {
      const result = await notificationRequest(identity, '/seen', notificationSeenSchema, {
        method: 'POST',
        body: { all: true, key: markAllKey.current },
      })
      if (!live.current) return
      setSeen(new Set(items.map((item) => item.id)))
      markAllKey.current = null
      setError('')
      confirmCount(result.unseenCount)
    } catch (failure) {
      if (live.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Mark all failed. Retry uses the same action.'
        )
    } finally {
      if (live.current) setMarkingAll(false)
    }
  }

  async function openActivity(id: string) {
    try {
      const result = await notificationRequest(
        identity,
        `/resolve/${encodeURIComponent(id)}`,
        z.object({ href: z.string() })
      )
      if (!live.current) return
      if (!result.href) {
        setError('This activity is no longer available.')
        return
      }
      close()
      router.push(result.href)
    } catch {
      if (live.current) setError('This activity is no longer available.')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5">
        <Link
          className="text-sm text-muted-foreground underline underline-offset-4"
          href="/workspace/notifications"
          onClick={close}
        >
          Notification settings
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={markingAll || (loading && cursor === null)}
          onClick={() => void markAll()}
        >
          {markingAll ? 'Marking…' : 'Mark all seen'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6" ref={setRoot} aria-busy={loading}>
        {items.length === 0 && !loading && !error ? (
          <p className="py-12 text-center text-sm text-muted-foreground">You’re all caught up.</p>
        ) : null}
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li className="py-5" key={item.id} data-notification-id={item.id}>
              <Summary
                item={item}
                root={root}
                acknowledged={seen.has(item.id)}
                acknowledge={acknowledge}
              />
              <div className="mt-3 flex items-center gap-3">
                {item.href ? (
                  <Button variant="outline" size="sm" onClick={() => void openActivity(item.id)}>
                    Open activity
                  </Button>
                ) : null}
                {seen.has(item.id) ? (
                  <span className="text-xs text-muted-foreground">Seen</span>
                ) : (
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-4"
                    onClick={() => void acknowledge(item.id).catch(() => undefined)}
                    type="button"
                  >
                    Mark seen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {loading ? (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            Loading notifications…
          </p>
        ) : cursor ? (
          <Button className="mt-4 w-full" variant="outline" onClick={() => void load(cursor)}>
            Load older activity
          </Button>
        ) : null}
        {!loading && error && cursor === null ? (
          <Button variant="outline" onClick={() => void load()}>
            Retry loading
          </Button>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {queryClient.getQueryData<{ unseenCount: number }>(countKey)?.unseenCount ?? 0} unseen
        notifications
      </span>
    </>
  )
}

/** Accessible desktop and mobile entry point; retrieval never acknowledges activity. */
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
        void queryClient.invalidateQueries({ queryKey: [...identity.key, 'count'] })
    }
    return () => channel.close()
  }, [identity.key, identity.userId, identity.workspaceId, queryClient])
  if (!identity.ready) return null
  const n = count.data?.unseenCount ?? 0
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${n ? `, ${n} unseen` : ''}`}
          className={`relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground ${collapsed ? 'w-8 justify-center' : 'w-full'}`}
        >
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
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
              {n > 99 ? '99+' : n}
            </span>
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent className="w-full gap-4 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>
            Activity for you in this workspace. Seen items leave your inbox when you close it.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <OpenInbox
            key={`${identity.userId}:${identity.workspaceId}`}
            identity={identity}
            close={() => setOpen(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
