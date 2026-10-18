'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { type CalendarPostWire, draftsApi } from '@/lib/content-drafts/client'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { cn } from '@/lib/utils'
import { ChannelIcon } from './channel-meta'
import { useHydrated } from './local-time'

/** The drag type a calendar post carries. */
const CALENDAR_DRAG = 'application/x-shots-calendar-post'

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * A week of draft posts: each day's posts in time order. A queued post drags
 * to another day and keeps its time of day; live posts stay put.
 */
export function DraftCalendar({
  canMove,
  posts,
  weekStart,
}: {
  canMove: boolean
  posts: CalendarPostWire[]
  /** The week's first day (Monday), as an ISO date. */
  weekStart: string
}) {
  const router = useRouter()
  // Which day a post falls on depends on the reader's zone, which the server
  // does not know: lay posts out once in the browser.
  const hydrated = useHydrated()
  const [over, setOver] = React.useState<string | null>(null)
  const start = new Date(`${weekStart}T00:00:00`)
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
  const shift = (weeks: number) => {
    const next = new Date(start)
    next.setDate(start.getDate() + weeks * 7)
    return next.toISOString().slice(0, 10)
  }
  const move = async (postId: string, day: Date) => {
    const post = posts.find((item) => item.id === postId)
    if (!post) return
    const from = new Date(post.scheduledFor)
    const to = new Date(day)
    to.setHours(from.getHours(), from.getMinutes(), 0, 0)
    if (dayKey(to) === dayKey(from)) return
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
  const today = dayKey(new Date())
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
        <h2 className="text-sm font-medium text-white">
          Week of {start.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
        </h2>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Link
            className="text-neutral-400 hover:text-white"
            href={`/drafts/calendar?week=${shift(-1)}`}
          >
            ← Previous
          </Link>
          <Link className="text-neutral-400 hover:text-white" href="/drafts/calendar">
            This week
          </Link>
          <Link
            className="text-neutral-400 hover:text-white"
            href={`/drafts/calendar?week=${shift(1)}`}
          >
            Next →
          </Link>
        </div>
      </header>
      {/* Local: the site-wide GlobalDropZone would otherwise force a "copy"
          dropEffect on every dragover, which a moved card refuses. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 divide-x divide-white/[0.05] overflow-y-auto"
        data-local-dropzone=""
      >
        {days.map((day) => {
          const key = dayKey(day)
          const dayPosts = hydrated
            ? posts.filter((post) => dayKey(new Date(post.scheduledFor)) === key)
            : []
          return (
            <section
              aria-label={day.toDateString()}
              className={cn(
                'flex min-h-64 flex-col gap-2 p-2',
                over === key && 'bg-sky-400/[0.06]'
              )}
              data-testid={`calendar-day-${day.getDate()}`}
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
              <p className={cn('text-xs', key === today ? 'text-sky-300' : 'text-neutral-500')}>
                {day.toLocaleDateString(undefined, { day: 'numeric', weekday: 'short' })}
              </p>
              {dayPosts.map((post) => {
                const channel = channelForPlatform(post.platform)
                const movable = canMove && post.status === 'SCHEDULED'
                return (
                  <Link
                    className={cn(
                      'block rounded-lg border p-2 text-xs',
                      post.status === 'PUBLISHED'
                        ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
                        : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20',
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
                    <span className="flex items-center gap-1 text-neutral-400">
                      {channel ? <ChannelIcon channel={channel} /> : null}
                      {new Date(post.scheduledFor).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {post.status === 'PUBLISHED' ? ' · live' : ''}
                    </span>
                    <span className="mt-1 line-clamp-3 block text-neutral-200">{post.caption}</span>
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
