'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { type CalendarPostWire, draftsApi } from '@/lib/content-drafts/client'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { addDays, zonedDayKey, zonedInstant, zonedParts } from '@/lib/settings/zoned-time'
import { cn } from '@/lib/utils'
import { ChannelIcon } from './channel-meta'

/** The drag type a calendar post carries. */
const CALENDAR_DRAG = 'application/x-shots-calendar-post'

/** A YYYY-MM-DD day as people read it, without moving it to another zone. */
function readableDay(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })
}

/**
 * A week of draft posts in the social set's scheduling time zone (RFC 043):
 * each day's posts in time order, the same for every reader. A queued post
 * drags to another day and keeps its time of day there; live posts stay put.
 * Moving the view's first weekday changes only how the week is drawn.
 */
export function DraftCalendar({
  canMove,
  planned = [],
  posts,
  socialSetId,
  timeZone,
  weekStart,
}: {
  canMove: boolean
  /** Drafts placed on a day without scheduling (an experiment). */
  planned?: { id: string; plannedFor: string; title: string }[]
  posts: CalendarPostWire[]
  /** The set the calendar shows, kept when moving between weeks. */
  socialSetId?: string
  /** The set's scheduling time zone; days are laid out in it. */
  timeZone: string
  /** The week's first day, as YYYY-MM-DD in `timeZone`. */
  weekStart: string
}) {
  const router = useRouter()
  const [over, setOver] = React.useState<string | null>(null)
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const weekHref = (weeks: number | null) => {
    const params = new URLSearchParams(socialSetId ? { socialSet: socialSetId } : {})
    if (weeks !== null) params.set('week', addDays(weekStart, weeks * 7))
    const query = params.toString()
    return `/drafts/calendar${query ? `?${query}` : ''}`
  }
  const move = async (postId: string, day: string) => {
    const post = posts.find((item) => item.id === postId)
    if (!post) return
    const from = new Date(post.scheduledFor)
    if (zonedDayKey(from, timeZone) === day) return
    const clock = zonedParts(from, timeZone)
    const to = zonedInstant(day, clock.hour, clock.minute, timeZone)
    if (to.getTime() <= Date.now()) {
      toast.error('That day has passed; pick a later one.')
      return
    }
    try {
      await draftsApi.movePost(postId, to)
      toast.success(`Moved to ${to.toLocaleString()}.`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The post could not move.')
    }
  }
  const today = zonedDayKey(new Date(), timeZone)
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <h2 className="text-sm font-medium text-foreground">
          Week of {readableDay(weekStart, { day: 'numeric', month: 'long' })}
        </h2>
        <span className="text-xs text-muted-foreground">{timeZone.replaceAll('_', ' ')}</span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Link className="text-foreground/65 hover:text-foreground" href={weekHref(-1)}>
            ← Previous
          </Link>
          <Link className="text-foreground/65 hover:text-foreground" href={weekHref(null)}>
            This week
          </Link>
          <Link className="text-foreground/65 hover:text-foreground" href={weekHref(1)}>
            Next →
          </Link>
        </div>
      </header>
      {/* Local: the site-wide GlobalDropZone would otherwise force a "copy"
          dropEffect on every dragover, which a moved card refuses. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 divide-x divide-foreground/[0.05] overflow-y-auto"
        data-local-dropzone=""
      >
        {days.map((day) => {
          const key = day
          const dayPosts = posts.filter((post) => zonedDayKey(new Date(post.scheduledFor), timeZone) === key)
          const dayPlanned = planned.filter((item) => zonedDayKey(new Date(item.plannedFor), timeZone) === key)
          return (
            <section
              aria-label={readableDay(day, { day: 'numeric', month: 'long', weekday: 'long', year: 'numeric' })}
              className={cn(
                'flex min-h-64 flex-col gap-2 p-2',
                over === key && 'bg-sky-400/[0.06]'
              )}
              data-testid={`calendar-day-${Number(day.slice(8))}`}
              key={key}
              onDragLeave={() => setOver(null)}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(CALENDAR_DRAG)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setOver(key)
              }}
              onDrop={(event) => {
                setOver(null)
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
              {dayPlanned.map((item) => (
                <Link
                  className="block rounded-lg border border-dashed border-foreground/20 p-2 text-xs"
                  data-testid="calendar-planned"
                  href={`/drafts/${item.id}`}
                  key={`planned-${item.id}`}
                >
                  <span className="text-muted-foreground">
                    Planned ·{' '}
                    {new Date(item.plannedFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-foreground">{item.title}</span>
                </Link>
              ))}
              {dayPosts.map((post) => {
                const channel = channelForPlatform(post.platform)
                const movable = canMove && post.status === 'SCHEDULED'
                return (
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
                    href={`/drafts/${post.draftId}`}
                    key={post.id}
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
                    <span className="mt-1 line-clamp-3 block text-foreground">{post.caption}</span>
                  </Link>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
