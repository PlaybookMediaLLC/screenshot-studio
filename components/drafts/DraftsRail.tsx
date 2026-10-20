'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Add01Icon } from 'hugeicons-react'
import { toast } from 'sonner'
import { draftsApi } from '@/lib/content-drafts/client'
import { SOCIAL_SET_COOKIE } from '@/lib/settings/appearance'
import { cn } from '@/lib/utils'
import { LocalTime, useHydrated } from './local-time'
import { Button } from '@/components/ui/button'

export type DraftListItem = {
  excerpt: string
  id: string
  /** Posts from the draft that are live. */
  publishedPosts: number
  status: 'draft' | 'scheduled' | 'archived'
  title: string
  updatedAt: string
}

/** A social set as the rail's switcher shows it. */
export type RailSocialSet = { color: string; id: string; name: string; needsAttention: boolean }

/** An upcoming post in the queue, with the draft it came from. */
export type QueueItem = {
  caption: string
  draftId: string
  id: string
  platform: string
  scheduledFor: string
}

/** The rail's tabs: drafts being written, the queue, what went live, the archive. */
type RailTab = 'draft' | 'queue' | 'posted' | 'archived'

const TABS: { label: string; tab: RailTab }[] = [
  { label: 'Drafts', tab: 'draft' },
  { label: 'Queue', tab: 'queue' },
  { label: 'Posted', tab: 'posted' },
  { label: 'Archived', tab: 'archived' },
]

function inTab(draft: DraftListItem, tab: RailTab): boolean {
  if (tab === 'posted') return draft.publishedPosts > 0
  if (tab === 'archived') return draft.status === 'archived'
  return draft.status === 'draft' || (draft.status === 'scheduled' && draft.publishedPosts === 0)
}

/** "5m", "3h", "2d", then a date: how long ago a draft was touched. */
function since(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 60 / 24)}d`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** A saved draft's line; its live post count stays as the list had it. */
type SavedDraft = Omit<DraftListItem, 'publishedPosts'>

const RailUpdate = React.createContext<(draft: SavedDraft) => void>(() => {})

/** Lets the open draft keep its line in the list current as it is saved. */
export function useShowInRail() {
  return React.useContext(RailUpdate)
}

/**
 * The drafts page frame: the list of drafts on the left and the open draft,
 * or a hint, filling the rest. Writing stays one click from every draft.
 */
export function DraftsFrame({
  activeId,
  canEdit,
  children,
  drafts,
  queue,
  selectedSet,
  sets = [],
}: {
  activeId?: string
  canEdit: boolean
  children: React.ReactNode
  drafts: DraftListItem[]
  /** Upcoming posts, soonest first. */
  queue: QueueItem[]
  /** The social set the pages show (RFC 043). */
  selectedSet?: string
  sets?: RailSocialSet[]
}) {
  const [saved, setSaved] = React.useState<SavedDraft | null>(null)
  const shown = saved
    ? [
        {
          ...saved,
          publishedPosts: drafts.find((draft) => draft.id === saved.id)?.publishedPosts ?? 0,
        },
        ...drafts.filter((draft) => draft.id !== saved.id),
      ]
    : drafts
  return (
    <div className="flex h-[100dvh] min-h-0 md:h-[calc(100vh-1rem-2px)]">
      <DraftsRail
        activeId={activeId}
        canEdit={canEdit}
        drafts={shown}
        queue={queue}
        selectedSet={selectedSet}
        sets={sets}
      />
      {/* On a phone the list is the page until a draft is open. */}
      <div
        className={cn('relative min-w-0 flex-1 overflow-y-auto', !activeId && 'hidden md:block')}
      >
        <RailUpdate.Provider value={setSaved}>{children}</RailUpdate.Provider>
      </div>
    </div>
  )
}

function DraftsRail({
  activeId,
  canEdit,
  drafts,
  queue,
  selectedSet,
  sets,
}: {
  activeId?: string
  canEdit: boolean
  drafts: DraftListItem[]
  queue: QueueItem[]
  selectedSet?: string
  sets: RailSocialSet[]
}) {
  const router = useRouter()
  // "now" at the server render can be "1m" by hydration: count in the browser.
  const hydrated = useHydrated()
  const active = drafts.find((draft) => draft.id === activeId)
  const [tab, setTab] = React.useState<RailTab>(
    active?.status === 'archived' ? 'archived' : 'draft'
  )
  const [creating, setCreating] = React.useState(false)
  const create = async () => {
    setCreating(true)
    try {
      // A new draft starts with its social set's defaults.
      const draft = await draftsApi.create(selectedSet ? { socialSetId: selectedSet } : {})
      router.push(`/drafts/${draft.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The draft could not be created.')
      setCreating(false)
    }
  }
  const shown = drafts.filter((draft) => inTab(draft, tab))

  return (
    <aside
      aria-label="Drafts"
      className={cn(
        'w-full shrink-0 flex-col border-foreground/[0.06] md:flex md:w-72 md:border-r',
        activeId ? 'hidden' : 'flex'
      )}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h1 className="text-sm font-medium text-foreground">Drafts</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link
            className="hover:text-foreground"
            href={selectedSet ? `/drafts/calendar?socialSet=${encodeURIComponent(selectedSet)}` : '/drafts/calendar'}
          >
            Calendar
          </Link>
          <Link
            className="hover:text-foreground"
            href={selectedSet ? `/workspace/social-sets/${encodeURIComponent(selectedSet)}/scheduling` : '/drafts/settings'}
          >
            Settings
          </Link>
        </div>
      </div>
      {sets.length > 0 ? (
        <div className="px-3 pb-3">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Social set</span>
            <select
              className="h-8 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              onChange={(event) => {
                const id = event.target.value
                document.cookie = `${SOCIAL_SET_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
                router.push(`/drafts?socialSet=${encodeURIComponent(id)}`)
              }}
              value={selectedSet ?? ''}
            >
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                  {set.needsAttention ? ' · needs attention' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="px-3" role="tablist">
        <div className="grid grid-cols-4 rounded-lg bg-foreground/[0.04] p-0.5">
          {TABS.map((item) => {
            const count =
              item.tab === 'queue'
                ? queue.length
                : drafts.filter((draft) => inTab(draft, item.tab)).length
            return (
              <Button variant="custom" size={null}
                aria-selected={tab === item.tab}
                className={cn(
                  'rounded-md px-1 py-1 text-[11px] transition-colors',
                  tab === item.tab
                    ? 'bg-foreground/[0.08] text-foreground'
                    : 'text-muted-foreground hover:text-foreground/80'
                )}
                key={item.tab}
                onClick={() => setTab(item.tab)}
                role="tab"
                type="button"
              >
                {item.label}
                {count > 0 ? <span className="ml-1 text-muted-foreground">{count}</span> : null}
              </Button>
            )
          })}
        </div>
      </div>
      {canEdit ? (
        <Button variant="custom" size={null}
          className="mx-3 mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-50"
          disabled={creating}
          onClick={create}
          type="button"
        >
          <Add01Icon aria-hidden className="size-4" />
          New draft
        </Button>
      ) : null}
      <nav className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-foreground/[0.06]">
        {tab === 'queue' ? (
          queue.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted-foreground">
              Nothing queued. Schedule a draft, or add it to the queue.
            </p>
          ) : (
            queue.map((item) => (
              <Link
                className="block border-b border-b-white/[0.04] px-4 py-3 hover:bg-foreground/[0.02]"
                data-testid="queue-item"
                href={`/drafts/${item.draftId}`}
                key={item.id}
              >
                <p className="text-[11px] text-sky-700 dark:text-sky-300">
                  <LocalTime
                    options={{
                      hour: 'numeric',
                      minute: '2-digit',
                      month: 'short',
                      day: 'numeric',
                      weekday: 'short',
                    }}
                    value={item.scheduledFor}
                  />{' '}
                  · {item.platform}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-foreground">
                  {item.caption}
                </p>
              </Link>
            ))
          )
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            {
              {
                archived: 'Nothing archived.',
                draft: 'No drafts. Start one above.',
                posted: 'Nothing posted yet.',
                queue: '',
              }[tab]
            }
          </p>
        ) : (
          shown.map((draft) => (
            <Link
              aria-current={draft.id === activeId ? 'page' : undefined}
              className={cn(
                'block border-b border-l-2 border-b-white/[0.04] px-4 py-3 transition-colors',
                draft.id === activeId
                  ? 'border-l-sky-400 bg-foreground/[0.04]'
                  : 'border-l-transparent hover:bg-foreground/[0.02]'
              )}
              href={`/drafts/${draft.id}`}
              key={draft.id}
            >
              <p className="line-clamp-2 text-[13px] leading-snug text-foreground">
                {draft.excerpt || <span className="text-muted-foreground">Empty draft</span>}
              </p>
              <p className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{draft.title}</span>
                <span className="shrink-0">
                  {tab === 'posted' ? `${draft.publishedPosts} live · ` : ''}
                  {hydrated ? since(draft.updatedAt) : null}
                </span>
              </p>
            </Link>
          ))
        )}
      </nav>
    </aside>
  )
}
