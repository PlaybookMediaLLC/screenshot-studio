'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { call, type CalendarPostWire } from '@/lib/content-drafts/client'
import { postingTimeBuckets } from '@/lib/write/posting-times'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Source-backed timing charts; adding a slot uses the social set's optimistic version. */
export function PostingTimes({
  posts,
  initialSet,
  canEdit,
}: {
  posts: CalendarPostWire[]
  initialSet: {
    id: string
    version: number
    name: string
    timeZone: string
    postingSlots: { weekday: number; time: string }[]
  }
  canEdit: boolean
}) {
  const [set, setSet] = React.useState(initialSet)
  const [busy, setBusy] = React.useState(false)
  const days = postingTimeBuckets(posts, set.timeZone)
  const maximum = Math.max(1, ...days.flat().map((hour) => hour.average))
  const measured = days.flat().reduce((sum, hour) => sum + hour.count, 0)
  const add = async (weekday: number, hour: number) => {
    if (busy) return
    setBusy(true)
    const time = `${String(hour).padStart(2, '0')}:00`
    try {
      const current = await call<typeof initialSet>(
        `/api/v1/social-sets/${encodeURIComponent(set.id)}`
      )
      const exists = current.postingSlots.some(
        (slot) => slot.weekday === weekday && slot.time === time
      )
      if (exists) {
        setSet(current)
        toast.info('That slot is already in the posting schedule.')
        return
      }
      const updated = await call<typeof initialSet>(
        `/api/v1/social-sets/${encodeURIComponent(set.id)}`,
        {
          method: 'PATCH',
          body: {
            baseVersion: current.version,
            postingSlots: [...current.postingSlots, { weekday, time }],
          },
        }
      )
      setSet(updated)
      toast.success(`Added ${DAYS[weekday]} at ${time} to ${set.name}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The slot could not be added.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6" data-testid="posting-times">
      <header>
        <h1 className="text-xl font-semibold">Best times to post</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {set.name} · {set.timeZone} · last 90 days · {measured} measured posts
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Average recorded likes, reposts and replies per published post. Post ages and measurement
          times vary; these observations do not guarantee future engagement. Up to 500 calendar
          records are included.
        </p>
      </header>
      {!measured ? (
        <p role="status">
          No measured engagement yet. Published posts appear here after their engagement is read.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {days.map((hours, weekday) => {
          const best = hours
            .filter((hour) => hour.count > 0)
            .sort((a, b) => b.average - a.average || b.count - a.count || a.hour - b.hour)[0]
          const time = best ? `${String(best.hour).padStart(2, '0')}:00` : null
          const added = set.postingSlots.some(
            (slot) => slot.weekday === weekday && slot.time === time
          )
          return (
            <section
              className="rounded-xl border p-4"
              key={weekday}
              aria-label={`${DAYS[weekday]} engagement`}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{DAYS[weekday]}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || busy || !best || added}
                  aria-label={`Add ${DAYS[weekday]} suggested slot`}
                  onClick={() => best && void add(weekday, best.hour)}
                >
                  {added ? 'Added' : `+ ${time ?? 'No data'}`}
                </Button>
              </div>
              <svg
                viewBox="0 0 288 100"
                role="img"
                aria-label={`Average engagement by hour on ${DAYS[weekday]}`}
                className="mt-3 w-full"
              >
                {hours.map((hour) => (
                  <rect
                    key={hour.hour}
                    x={hour.hour * 12}
                    y={85 - (hour.average / maximum) * 80}
                    width="9"
                    height={hour.count ? Math.max(1, (hour.average / maximum) * 80) : 0}
                    className="fill-sky-500"
                  >
                    <title>{`${hour.hour}:00: ${hour.count ? `${hour.average.toFixed(1)} average from ${hour.count} posts` : 'not measured'}`}</title>
                  </rect>
                ))}
                <text x="0" y="98" className="fill-current text-[9px]">
                  00:00
                </text>
                <text x="132" y="98" className="fill-current text-[9px]">
                  12:00
                </text>
                <text x="258" y="98" className="fill-current text-[9px]">
                  23:00
                </text>
              </svg>
              <p className="mt-2 text-xs text-muted-foreground">
                {best
                  ? `${time}: ${best.average.toFixed(1)} average engagement across ${best.count} measured posts.`
                  : 'No measurements for this day.'}
              </p>
            </section>
          )
        })}
      </div>
    </main>
  )
}
