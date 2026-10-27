'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Row } from '@/components/platform-ui'
import { SaveStatus, useSaveState } from '@/components/settings/controls'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { TimeZonePicker } from '@/components/settings/TimeZonePicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { type SocialSetRecord, useSaveSocialSet } from './api'

type Slot = SocialSetRecord['postingSlots'][number]

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Every time of day in 15-minute steps, as HH:MM. */
const QUARTER_HOURS = Array.from({ length: 96 }, (_, index) => {
  const hours = String(Math.floor(index / 4)).padStart(2, '0')
  const minutes = String((index % 4) * 15).padStart(2, '0')
  return `${hours}:${minutes}`
})

/** A time as people read it, such as 5:00 PM. */
function readableTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** The weekly count: every enabled day and time, not just the rows. */
export function weeklySlotCount(slots: Slot[]): number {
  return new Set(slots.map((slot) => `${slot.weekday} ${slot.time}`)).size
}

/**
 * A set's schedule (RFC 024): its time zone, the weekly grid of posting times
 * the queue fills, and natural posting times. The grid is a template: changing
 * it never moves a post that is already scheduled.
 */
export function SchedulingPage({ canManage, set }: { canManage: boolean; set: SocialSetRecord }) {
  const save = useSaveSocialSet(set.id)
  const weekStart = usePreferences().preferences?.weekStart ?? 'monday'
  const days = weekStart === 'monday' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  const [slots, setSlots] = useState<Slot[]>(set.postingSlots)
  const pending = useRef(0)
  const [gridState, runGrid] = useSaveState()
  const [zoneState, runZone] = useSaveState()
  const [naturalState, runNatural] = useSaveState()
  const [adding, setAdding] = useState('')

  // A save confirmed elsewhere, or a reload, brings the server's grid back.
  useEffect(() => {
    if (pending.current === 0) setSlots(set.postingSlots)
  }, [set.postingSlots])

  const times = useMemo(() => [...new Set(slots.map((slot) => slot.time))].sort(), [slots])
  const enabled = (weekday: number, time: string) => slots.some((slot) => slot.weekday === weekday && slot.time === time)

  const commit = (next: Slot[]) => {
    setSlots(next)
    pending.current += 1
    void runGrid(async () => {
      const result = await save({ postingSlots: next })
      pending.current -= 1
      if (!result.ok && pending.current === 0) setSlots(set.postingSlots)
      return result
    })
  }

  const toggle = (weekday: number, time: string, on: boolean) =>
    commit(on ? [...slots, { time, weekday }] : slots.filter((slot) => !(slot.weekday === weekday && slot.time === time)))
  const removeTime = (time: string) => commit(slots.filter((slot) => slot.time !== time))
  const addTime = () => {
    if (!adding || times.includes(adding)) return
    commit([...slots, ...[1, 2, 3, 4, 5].map((weekday) => ({ time: adding, weekday }))])
    setAdding('')
  }

  return (
    <div className="grid gap-6">
      <Group>
        <Row
          description="The time zone this publishing brand's queue, slots and calendar use. It is separate from your display time zone."
          label={
            <span className="flex items-center gap-2">
              Scheduling time zone <SaveStatus state={zoneState} />
            </span>
          }
          layout="stacked"
        >
          <TimeZonePicker
            disabled={!canManage}
            label="Scheduling time zone"
            onChange={(timeZone) => void runZone(() => save({ timeZone }))}
            value={set.timeZone}
          />
        </Row>
      </Group>

      <Group>
        <Row
          description="Add to queue takes the next free time here. Editing the schedule does not change posts already scheduled."
          label={
            <span className="flex items-center gap-2">
              Weekly posting times <SaveStatus state={gridState} />
            </span>
          }
          layout="stacked"
        >
          <div className="grid w-full min-w-0 gap-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">Posting times by weekday in {set.timeZone}</caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-2 text-left font-medium" scope="col">
                      Time
                    </th>
                    {days.map((day) => (
                      <th className="py-2 text-center font-medium" key={day} scope="col">
                        <abbr title={DAY_NAMES[day]}>{DAY_NAMES[day]!.slice(0, 3)}</abbr>
                      </th>
                    ))}
                    <th className="sr-only" scope="col">
                      Remove
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {times.length === 0 ? (
                    <tr>
                      <td className="py-4 text-muted-foreground" colSpan={9}>
                        No posting times yet. The queue has nowhere to place drafts until you add one.
                      </td>
                    </tr>
                  ) : null}
                  {times.map((time) => (
                    <tr className="border-t border-border" key={time}>
                      <th className="py-2 text-left font-medium text-foreground" scope="row">
                        {readableTime(time)}
                      </th>
                      {days.map((day) => (
                        <td className="py-2 text-center" key={day}>
                          <Checkbox
                            aria-label={`${DAY_NAMES[day]} at ${readableTime(time)}`}
                            checked={enabled(day, time)}
                            disabled={!canManage}
                            onCheckedChange={(checked) => toggle(day, time, checked === true)}
                          />
                        </td>
                      ))}
                      <td className="py-2 text-right">
                        <Button
                          aria-label={`Remove ${readableTime(time)}`}
                          disabled={!canManage}
                          onClick={() => removeTime(time)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  addTime()
                }}
              >
                <Select disabled={!canManage} onValueChange={setAdding} value={adding}>
                  <SelectTrigger aria-label="Time to add" className="w-36 bg-card">
                    <SelectValue placeholder="Choose a time…" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUARTER_HOURS.filter((time) => !times.includes(time)).map((time) => (
                      <SelectItem key={time} value={time}>
                        {readableTime(time)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button disabled={!canManage || !adding} type="submit" variant="outline">
                  Add time
                </Button>
              </form>
              <p aria-live="polite" className="text-sm text-foreground" data-testid="weekly-slot-count">
                {weeklySlotCount(slots)} weekly posting slots
              </p>
            </div>
          </div>
        </Row>
      </Group>

      <Group>
        <Row
          description="New drafts start with posts going out up to four minutes either side of the slot, so they read less like a timer. The offset is chosen once and kept, and you can turn it off for one draft when you schedule it."
          label="Natural posting times"
        >
          <div className="flex items-center gap-3">
            <SaveStatus state={naturalState} />
            <Switch
              aria-label="Natural posting times for new drafts"
              checked={set.naturalPostingTimes}
              disabled={!canManage}
              onCheckedChange={(naturalPostingTimes) => void runNatural(() => save({ naturalPostingTimes }))}
            />
          </div>
        </Row>
      </Group>
    </div>
  )
}
