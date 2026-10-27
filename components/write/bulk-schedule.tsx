'use client'

import { useState } from 'react'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { call, draftsApi } from '@/lib/content-drafts/client'
import type { contentDraftScheduleSchema } from '@/lib/api/contracts/content-drafts'
import { zonedDayKey } from '@/lib/settings/zoned-time'
import { useWrite, useWriteRouter } from './write-context'

type Row = {
  id: string
  title: string
  at: string
  input: z.input<typeof contentDraftScheduleSchema>
  status: string
  error?: string
}

/** Preflight every selected draft; submit valid rows through ordinary scheduling. */
export function BulkScheduleDialog({
  selected,
  onClose,
}: {
  selected: string[]
  onClose: () => void
}) {
  const { data, beforeLeaveRef } = useWrite()
  const router = useWriteRouter()
  const set = data.activeSet
  const [mode, setMode] = useState<'queue' | 'spread'>('queue')
  const [start, setStart] = useState(
    `${zonedDayKey(new Date(Date.now() + 86400_000), set?.timeZone ?? 'UTC')}T09:00`
  )
  const [perDay, setPerDay] = useState(2)
  const [spacing, setSpacing] = useState(240)
  const [shift, setShift] = useState(0)
  const [seed] = useState(() => crypto.randomUUID())
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = async () => {
    if (!set) return
    setBusy(true)
    setError('')
    try {
      await beforeLeaveRef.current?.()
      const { times } = await call<{ times: string[] }>('/api/v1/content-draft-batch/times', {
        method: 'POST',
        body: {
          socialSetId: set.id,
          count: selected.length,
          mode,
          localTime: start,
          postsPerDay: perDay,
          spacingMinutes: spacing,
          shiftMinutes: shift,
          seed,
        },
      })
      const result: Row[] = []
      for (const [index, id] of selected.entries()) {
        const row: Row = {
          id,
          title: data.library.find((draft) => draft.id === id)?.title ?? id,
          at: times[index],
          input: { channelConnectionIds: [], version: 1 },
          status: 'Blocked',
        }
        try {
          const draft = await draftsApi.get(id)
          if (draft.socialSetId !== set.id) throw new Error('Use one publishing brand per batch.')
          row.input = {
            channelConnectionIds: draft.channelConnectionIds,
            version: draft.version,
            naturalPostingTime: false,
            ...(mode === 'queue'
              ? { queue: true, expectedQueueSlot: times[index] }
              : { scheduledFor: times[index] }),
          }
          await call(`/api/v1/content-drafts/${id}/schedule/validate`, {
            method: 'POST',
            body: row.input,
          })
          row.status = 'Ready'
        } catch (error) {
          row.error = error instanceof Error ? error.message : 'Validation failed.'
        }
        result.push(row)
      }
      if (mode === 'queue' && result.some((row) => row.status === 'Ready')) {
        const ready = result.filter((row) => row.status === 'Ready')
        const replanned = await call<{ times: string[] }>('/api/v1/content-draft-batch/times', {
          method: 'POST',
          body: { socialSetId: set.id, count: ready.length, mode, seed },
        })
        ready.forEach((row, index) => {
          row.at = replanned.times[index]
          row.input.expectedQueueSlot = row.at
        })
      }
      setRows(result)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The batch could not be prepared.')
    } finally {
      setBusy(false)
    }
  }
  const schedule = async () => {
    if (!rows) return
    setBusy(true)
    const next = [...rows]
    for (const [index, row] of next.entries()) {
      if (row.status !== 'Ready' && row.status !== 'Retry same request') continue
      try {
        await draftsApi.schedule(row.id, row.input)
        next[index] = { ...row, status: 'Scheduled', error: undefined }
      } catch (error) {
        next[index] = {
          ...row,
          status: 'Retry same request',
          error: error instanceof Error ? error.message : 'No confirmation received.',
        }
      }
      setRows([...next])
    }
    setBusy(false)
    router.refresh()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule {selected.length} drafts</DialogTitle>
          <DialogDescription>
            Preview all times in {set?.timeZone}. Drafts needing approval remain blocked. Each
            scheduled destination uses the normal publishing quota.
          </DialogDescription>
        </DialogHeader>
        {!rows ? (
          <>
            <label>
              Mode{' '}
              <select
                aria-label="Batch mode"
                className="rounded border bg-background p-2"
                value={mode}
                disabled={busy}
                onChange={(event) => setMode(event.target.value as 'queue' | 'spread')}
              >
                <option value="queue">Fill the queue</option>
                <option value="spread">Spread</option>
              </select>
            </label>
            {mode === 'spread' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  Start
                  <Input
                    type="datetime-local"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <label>
                  Posts per day
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={perDay}
                    onChange={(event) => setPerDay(Number(event.target.value))}
                  />
                </label>
                <label>
                  Spacing in minutes
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={spacing}
                    onChange={(event) => setSpacing(Number(event.target.value))}
                  />
                </label>
                <label>
                  Random shift in minutes
                  <Input
                    type="number"
                    min={0}
                    max={55}
                    step={5}
                    value={shift}
                    onChange={(event) => setShift(Number(event.target.value))}
                  />
                </label>
              </div>
            )}
            <Button disabled={busy || selected.length > 50} onClick={() => void preview()}>
              {busy ? 'Checking drafts…' : 'Preview and validate'}
            </Button>
            {selected.length > 50 && <p role="alert">Select at most 50 drafts.</p>}
          </>
        ) : (
          <>
            <ol className="grid gap-2 text-sm">
              {rows.map((row, index) => (
                <li className="rounded border p-3" key={row.id}>
                  <strong>
                    {index + 1}. {row.title}
                  </strong>
                  <p>
                    {new Date(row.at).toLocaleString(undefined, { timeZone: set?.timeZone })} ·{' '}
                    {row.status}
                  </p>
                  {row.error && <p role="alert">{row.error}</p>}
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">
              A changed queue or draft is rejected. Retrying keeps the original version and request,
              so it cannot create a duplicate. Close and preview again only after checking the
              result.
            </p>
            <Button
              disabled={
                busy ||
                !rows.some((row) => row.status === 'Ready' || row.status === 'Retry same request')
              }
              onClick={() => void schedule()}
            >
              {busy
                ? 'Scheduling…'
                : rows.some((row) => row.status === 'Retry same request')
                  ? 'Retry unconfirmed rows'
                  : 'Schedule valid drafts'}
            </Button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
