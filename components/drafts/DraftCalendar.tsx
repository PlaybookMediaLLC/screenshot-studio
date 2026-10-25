'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { type CalendarPostWire, draftsApi, call } from '@/lib/content-drafts/client'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { addDays, zonedDayKey, zonedParts } from '@/lib/settings/zoned-time'
import { availableDaySlots, shiftCalendar } from '@/lib/write/calendar'
import { resolveLocalTime } from '@/lib/write/zoned-time'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CalendarDraftPicker } from './CalendarDraftPicker'
import { socialSetHref } from '@/components/workspace/settings-sections'
import { ChannelIcon } from './channel-meta'

/** The drag type a calendar post carries. */
const CALENDAR_DRAG = 'application/x-shots-calendar-post'
const DRAFT_DRAG = 'application/x-shots-library-draft'

/** A YYYY-MM-DD day as people read it, without moving it to another zone. */
function readableDay(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })
}

/** A draft planned for a time: on the calendar, never published by itself. */
export type PlannedDraft = {
  at: string
  caption: string
  draftId: string
  title: string
  socialSetId?: string
  tagIds?: string[]
  platforms?: string[]
}

/**
 * A week of draft posts in the social set's scheduling time zone (RFC 043):
 * each day's posts in time order, the same for every reader. A queued post
 * drags to another day and keeps its time of day there; live posts stay put.
 * Moving the view's first weekday changes only how the week is drawn.
 * Planned drafts show dashed: they hold a time but publish nothing until
 * scheduled (RFC 042).
 */
export function DraftCalendar({
  view = 'week',
  anchor,
  daysCount = 7,
  allSets = false,
  socialSets = [],
  tags = [],
  canMove,
  canPlan = false,
  postingSlots = [],
  planned = [],
  posts,
  socialSetId,
  timeZone,
  weekStart,
}: {
  view?: 'week' | 'month' | 'queue'
  anchor?: string
  daysCount?: number
  allSets?: boolean
  socialSets?: { id: string; name: string; platforms?: string[] }[]
  tags?: { id: string; name: string; socialSetId: string }[]
  canMove: boolean
  canPlan?: boolean
  postingSlots?: { weekday: number; time: string }[]
  /** Drafts placed on a day without scheduling. */
  planned?: PlannedDraft[]
  posts: CalendarPostWire[]
  /** The set the calendar shows, kept when moving between weeks. */
  socialSetId?: string
  /** The set's scheduling time zone; days are laid out in it. */
  timeZone: string
  /** The week's first day, as YYYY-MM-DD in `timeZone`. */
  weekStart: string
}) {
  const router = useRouter()
  const [picking, setPicking] = React.useState<{ day: string; time?: string } | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [over, setOver] = React.useState<string | null>(null)
  const params = useSearchParams()
  const channelFilter = params.get('channel') ?? 'all'
  const statusFilter = params.get('status') ?? 'all'
  const setFilter = params.get('brand') ?? 'all'
  const tagFilter = params.get('tag') ?? 'all'
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    window.history.replaceState(null, '', `${window.location.pathname}?${next}`)
  }
  const setChannelFilter = (value: string) => filter('channel', value)
  const setStatusFilter = (value: string) => filter('status', value)
  const setSetFilter = (value: string) => filter('brand', value)
  const setTagFilter = (value: string) => filter('tag', value)
  const [editing, setEditing] = React.useState<CalendarPostWire | null>(null)
  const [localTime, setLocalTime] = React.useState('')
  const [moving, setMoving] = React.useState(false)
  const days = Array.from({ length: daysCount }, (_, index) => addDays(weekStart, index))
  const weekHref = (weeks: number | null, nextView = view, nextAll = allSets) => {
    const params = new URLSearchParams(socialSetId ? { set: socialSetId } : {})
    params.set('view', nextView)
    if (channelFilter !== 'all') params.set('channel', channelFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (nextAll && setFilter !== 'all') params.set('brand', setFilter)
    if (tagFilter !== 'all') params.set('tag', tagFilter)
    if (nextAll) params.set('all', 'true')
    if (weeks !== null) params.set('week', shiftCalendar(anchor ?? weekStart, view, weeks))
    const query = params.toString()
    return `/write/plan${query ? `?${query}` : ''}`
  }
  const move = async (postId: string, day: string, time?: string) => {
    const post = posts.find((item) => item.id === postId)
    if (!post) return
    const from = new Date(post.scheduledFor)
    if (!time && zonedDayKey(from, timeZone) === day) return
    const clock = zonedParts(from, timeZone)
    const local = `${day}T${time ?? `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`}`
    const resolved = resolveLocalTime(local, timeZone)
    if (resolved.kind !== 'exact') {
      toast.error(
        'This time is skipped or repeated by daylight saving. Choose an unambiguous time.'
      )
      return
    }
    const to = resolved.at
    if (to.getTime() <= Date.now()) {
      toast.error('That day has passed; pick a later one.')
      return
    }
    setMoving(true)
    try {
      await draftsApi.movePost(postId, to)
      toast.success(`Moved to ${to.toLocaleString(undefined, { timeZone })} (${timeZone}).`)
      setEditing(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The post could not move.')
    } finally {
      setMoving(false)
    }
  }
  const swap = async (first: string, second: string) => {
    if (moving || first === second) return
    setMoving(true)
    try {
      await call('/api/v1/content-draft-posts/swap', { method: 'POST', body: { first, second } })
      toast.success('Queue positions exchanged.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'These posts could not exchange times.')
    } finally {
      setMoving(false)
    }
  }
  const reviewDraft = (id: string, day: string, time?: string) => {
    const query = new URLSearchParams({
      panel: 'schedule',
      day,
      ...(time ? { time } : {}),
      ...(socialSetId ? { set: socialSetId } : {}),
    })
    router.push(`/write/${id}?${query}`)
  }
  const dropDraft = async (id: string, day: string, time?: string) => {
    if (!canPlan || day < today) return
    try {
      const draft = await draftsApi.get(id)
      if (draft.queuedPosts > 0 || draft.status !== 'draft')
        throw new Error('Choose an unscheduled draft, or move its scheduled card.')
      if (socialSetId && draft.socialSetId !== socialSetId)
        throw new Error('Choose the draft’s social set before placing it.')
      reviewDraft(id, day, time)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'This draft is unavailable.')
    }
  }
  const plan = async (day: string, time?: string) => {
    if (creating) return
    setCreating(true)
    try {
      const draft = await draftsApi.create({ socialSetId })
      const query = new URLSearchParams({
        panel: 'schedule',
        day,
        ...(time ? { time } : {}),
        ...(socialSetId ? { set: socialSetId } : {}),
      })
      router.push(`/write/${draft.id}?${query}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The draft could not be created.')
      setCreating(false)
    }
  }
  const today = zonedDayKey(new Date(), timeZone)
  return (
    <div
      className="flex h-full flex-col"
      tabIndex={0}
      aria-label="Publishing calendar"
      onKeyDown={(event) => {
        if (
          !event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (event.target instanceof HTMLElement &&
            event.target.closest('input,textarea,select,[contenteditable="true"]'))
        )
          return
        if (
          event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key.toLowerCase() === 't'
        ) {
          event.preventDefault()
          router.push(
            weekHref(event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null)
          )
        }
      }}
    >
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 py-2 border-b border-foreground/[0.06] px-4">
        <h2 className="text-sm font-medium text-foreground">
          {view === 'month'
            ? readableDay(anchor ?? weekStart, { month: 'long', year: 'numeric' })
            : `Week of ${readableDay(weekStart, { day: 'numeric', month: 'long' })}`}
        </h2>
        <span className="text-xs text-muted-foreground">{timeZone.replaceAll('_', ' ')}</span>
        <Link href={weekHref(0, view === 'month' ? 'week' : 'month')}>
          {view === 'month' ? 'Week view' : 'Month view'}
        </Link>
        <Link href={weekHref(0, view === 'queue' ? 'week' : 'queue')}>
          {view === 'queue' ? 'Calendar view' : 'Queue board'}
        </Link>
        <Link
          href={socialSetId ? socialSetHref(socialSetId, 'scheduling') : '/workspace/social-sets'}
        >
          Posting settings
        </Link>
        <Link href={weekHref(0, view, !allSets)}>
          {allSets ? 'Selected social set' : 'All social sets'}
        </Link>
        <select
          aria-label="Filter by channel"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="rounded border bg-background p-1 text-xs"
        >
          <option value="all">All channels</option>
          {[
            ...new Set([
              ...posts.map((p) => p.platform),
              ...planned.flatMap((item) => item.platforms ?? []),
              ...socialSets.flatMap((set) => set.platforms ?? []),
            ]),
          ]
            .sort()
            .map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
        </select>
        {allSets && (
          <select
            aria-label="Filter by publishing brand"
            value={setFilter}
            onChange={(event) => setSetFilter(event.target.value)}
            className="rounded border bg-background p-1 text-xs"
          >
            <option value="all">All brands</option>
            {socialSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        )}
        {tags.length > 0 && (
          <select
            aria-label="Filter calendar by tag"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="rounded border bg-background p-1 text-xs"
          >
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {allSets
                  ? `${socialSets.find((set) => set.id === tag.socialSetId)?.name ?? 'Brand'} · `
                  : ''}
                {tag.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border bg-background p-1 text-xs"
        >
          <option value="all">All statuses</option>
          {['PLANNED', 'SCHEDULED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'UNKNOWN_DELIVERY'].map(
            (status) => (
              <option key={status} value={status}>
                {status.toLowerCase().replaceAll('_', ' ')}
              </option>
            )
          )}
        </select>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Link
            className="text-foreground/65 hover:text-foreground"
            href={weekHref(-1)}
            title="Previous period (Alt+Left)"
          >
            ← Previous
          </Link>
          <Link
            className="text-foreground/65 hover:text-foreground"
            href={weekHref(null)}
            title="Today (Alt+T)"
          >
            Today
          </Link>
          <Link
            className="text-foreground/65 hover:text-foreground"
            href={weekHref(1)}
            title="Next period (Alt+Right)"
          >
            Next →
          </Link>
        </div>
      </header>
      {/* Local: the site-wide GlobalDropZone would otherwise force a "copy"
          dropEffect on every dragover, which a moved card refuses. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 divide-x divide-foreground/[0.05] overflow-auto',
          view === 'queue' ? 'grid-flow-col auto-cols-[minmax(240px,1fr)]' : 'grid-cols-7'
        )}
        aria-label={view === 'queue' ? 'Weekly queue board' : 'Calendar'}
        data-local-dropzone=""
      >
        {days.map((day) => {
          const key = day
          const dayPosts = posts.filter(
            (post) =>
              zonedDayKey(new Date(post.scheduledFor), timeZone) === key &&
              (channelFilter === 'all' || post.platform === channelFilter) &&
              (!allSets || setFilter === 'all' || post.socialSetId === setFilter) &&
              (tagFilter === 'all' || post.tagIds.includes(tagFilter)) &&
              (statusFilter === 'all' || post.status === statusFilter)
          )
          const dayPlanned = planned.filter(
            (item) =>
              zonedDayKey(new Date(item.at), timeZone) === key &&
              (channelFilter === 'all' || (item.platforms ?? []).includes(channelFilter)) &&
              (!allSets || setFilter === 'all' || item.socialSetId === setFilter) &&
              (tagFilter === 'all' || (item.tagIds ?? []).includes(tagFilter)) &&
              (statusFilter === 'all' || statusFilter === 'PLANNED')
          )
          return (
            <section
              aria-label={readableDay(day, {
                day: 'numeric',
                month: 'long',
                weekday: 'long',
                year: 'numeric',
              })}
              className={cn(
                'flex min-h-64 min-w-0 flex-col gap-2 p-2',
                over === key && 'bg-sky-400/[0.06]'
              )}
              data-testid={`calendar-day-${Number(day.slice(8))}`}
              key={key}
              onDragLeave={() => setOver(null)}
              onDragOver={(event) => {
                if (
                  !event.dataTransfer.types.includes(CALENDAR_DRAG) &&
                  !(canPlan && event.dataTransfer.types.includes(DRAFT_DRAG))
                )
                  return
                event.preventDefault()
                event.dataTransfer.dropEffect = event.dataTransfer.types.includes(DRAFT_DRAG)
                  ? 'copy'
                  : 'move'
                setOver(key)
              }}
              onDrop={(event) => {
                setOver(null)
                const draftId = event.dataTransfer.getData(DRAFT_DRAG)
                if (draftId) {
                  event.preventDefault()
                  void dropDraft(draftId, day)
                  return
                }
                const postId = event.dataTransfer.getData(CALENDAR_DRAG)
                if (!postId) return
                // Do not follow the dragged link.
                event.preventDefault()
                void move(postId, day)
              }}
            >
              <p
                className={cn(
                  'text-xs',
                  key === today ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground'
                )}
              >
                {readableDay(day, { day: 'numeric', weekday: 'short' })}
              </p>
              {canPlan && day >= today ? (
                <div className="grid gap-1">
                  <Button
                    className="h-auto min-h-8 whitespace-normal px-1 text-xs"
                    disabled={creating}
                    size="sm"
                    variant="outline"
                    onClick={() => void plan(day)}
                  >
                    Plan a post
                  </Button>
                  {availableDaySlots(day, timeZone, postingSlots, [
                    ...posts.map((post) => post.scheduledFor),
                    ...planned.map((item) => item.at),
                  ]).map((time) => (
                    <Button
                      className="h-auto min-h-8 whitespace-normal px-1 text-xs"
                      key={time}
                      disabled={creating}
                      size="sm"
                      variant="ghost"
                      onDragOver={(event) => {
                        if (
                          (canMove && event.dataTransfer.types.includes(CALENDAR_DRAG)) ||
                          (canPlan && event.dataTransfer.types.includes(DRAFT_DRAG))
                        )
                          event.preventDefault()
                      }}
                      onDrop={(event) => {
                        const draftId = event.dataTransfer.getData(DRAFT_DRAG)
                        if (draftId && canPlan) {
                          event.preventDefault()
                          event.stopPropagation()
                          void dropDraft(draftId, day, time)
                          return
                        }
                        if (!canMove) return
                        event.preventDefault()
                        event.stopPropagation()
                        void move(event.dataTransfer.getData(CALENDAR_DRAG), day, time)
                      }}
                      onClick={() => setPicking({ day, time })}
                    >
                      Available · {time}
                    </Button>
                  ))}
                </div>
              ) : null}
              {dayPlanned.map((item) => (
                <Link
                  className="block rounded-lg border border-dashed border-foreground/20 p-2 text-xs"
                  data-testid="calendar-planned"
                  href={`/write/${item.draftId}`}
                  key={`planned-${item.draftId}`}
                >
                  <span className="text-muted-foreground">
                    Planned ·{' '}
                    {new Date(item.at).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone,
                    })}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-foreground">
                    {item.title || item.caption}
                  </span>
                  {allSets && (
                    <span className="mt-1 block text-muted-foreground">
                      {socialSets.find((set) => set.id === item.socialSetId)?.name ??
                        'Unassigned brand'}
                    </span>
                  )}
                  {tags
                    .filter((tag) => (item.tagIds ?? []).includes(tag.id))
                    .map((tag) => (
                      <span className="mr-1 text-muted-foreground" key={tag.id}>
                        #{tag.name}
                      </span>
                    ))}
                </Link>
              ))}
              {dayPosts.map((post) => {
                const channel = channelForPlatform(post.platform)
                const movable = canMove && post.status === 'SCHEDULED'
                return (
                  <div key={post.id}>
                    <Link
                      className={cn(
                        'block rounded-lg border p-2 text-xs',
                        post.status === 'PUBLISHED'
                          ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
                          : 'border-foreground/[0.08] bg-foreground/[0.02] hover:border-foreground/20',
                        movable && 'cursor-grab'
                      )}
                      data-testid="calendar-post"
                      draggable={movable}
                      href={`/write/${post.draftId}`}
                      key={post.id}
                      onDragOver={(event) => {
                        if (movable && event.dataTransfer.types.includes(CALENDAR_DRAG)) {
                          event.preventDefault()
                          event.stopPropagation()
                          event.dataTransfer.dropEffect = 'move'
                        }
                      }}
                      onDrop={(event) => {
                        if (!movable) return
                        const from = event.dataTransfer.getData(CALENDAR_DRAG)
                        if (!from) return
                        event.preventDefault()
                        event.stopPropagation()
                        void swap(from, post.id)
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(CALENDAR_DRAG, post.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                    >
                      <span className="flex items-center gap-1 text-foreground/65">
                        {channel ? <ChannelIcon channel={channel} /> : null}
                        {new Date(post.scheduledFor).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone,
                        })}
                        {post.status === 'PUBLISHED' ? ' · live' : ''}
                      </span>
                      <span className="mt-1 line-clamp-3 block text-foreground">
                        {post.caption}
                      </span>
                      {allSets && (
                        <span className="mt-1 block text-muted-foreground">
                          {socialSets.find((set) => set.id === post.socialSetId)?.name ??
                            'Unassigned brand'}
                        </span>
                      )}
                      {tags
                        .filter((tag) => post.tagIds.includes(tag.id))
                        .map((tag) => (
                          <span className="mr-1 text-muted-foreground" key={tag.id}>
                            #{tag.name}
                          </span>
                        ))}
                    </Link>
                    {movable ? (
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setEditing(post)
                            const clock = zonedParts(new Date(post.scheduledFor), timeZone)
                            setLocalTime(
                              `${day}T${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
                            )
                          }}
                        >
                          Change time
                        </Button>
                        <select
                          aria-label={`Swap queue position for ${post.caption}`}
                          value=""
                          disabled={moving}
                          className="w-full bg-background text-xs"
                          onChange={(event) => {
                            if (event.target.value) void swap(post.id, event.target.value)
                          }}
                        >
                          <option value="">Swap with…</option>
                          {posts
                            .filter(
                              (other) =>
                                other.id !== post.id &&
                                other.status === 'SCHEDULED' &&
                                other.socialSetId === post.socialSetId
                            )
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.caption.slice(0, 40)} ·{' '}
                                {new Date(other.scheduledFor).toLocaleString(undefined, {
                                  timeZone,
                                })}
                              </option>
                            ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
      {picking ? (
        <CalendarDraftPicker
          socialSetId={socialSetId}
          onClose={() => setPicking(null)}
          onChoose={(id) => reviewDraft(id, picking.day, picking.time)}
          onNew={() => {
            const slot = picking
            setPicking(null)
            void plan(slot.day, slot.time)
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !moving) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change publication time</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{timeZone}</p>
          <label className="grid gap-2">
            Publication date and time
            <input
              type="datetime-local"
              value={localTime}
              onChange={(event) => setLocalTime(event.target.value)}
              className="rounded border bg-background p-2"
            />
          </label>
          <Button
            disabled={moving || !localTime}
            onClick={() => {
              if (editing) void move(editing.id, localTime.slice(0, 10), localTime.slice(11))
            }}
          >
            {moving ? 'Moving…' : 'Save time'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
