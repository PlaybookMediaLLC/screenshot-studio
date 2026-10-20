'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CHANNEL_META, ChannelIcon } from '@/components/drafts/channel-meta'
import { LocalTime } from '@/components/drafts/local-time'
import {
  DraftRequestError,
  type DraftWire,
  draftsApi,
  type SettingsWire,
} from '@/lib/content-drafts/client'
import type { BlockImages } from '@/lib/content-drafts/serialize'
import { followUpLines } from '@/lib/write/automation'
import { writeApi } from '@/lib/write/client'
import type { Automation } from '@/lib/write/document'
import { offsetLabel, readWhen, resolveLocalTime, wallTime } from '@/lib/write/zoned-time'
import { cn } from '@/lib/utils'
import { AutomationControls } from './automation'
import type { PreviewItem } from './preview'
import { healthLabel, SetDot } from '../sets'
import { useWrite } from '../write-context'

/** Quarter hours of a day as HH:MM. */
const QUARTERS = Array.from(
  { length: 96 },
  (_, index) =>
    `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`
)

/** A date's YYYY-MM-DD in a zone. */
function dayIn(at: Date, zone: string): string {
  return wallTime(at, zone).slice(0, 10)
}

/** What scheduling needs from the composer. */
export type ScheduleContext = {
  /** Every destination with its publication, to check before anything is queued. */
  items: PreviewItem[]
  approved: boolean
  canPublish: boolean
  draft: DraftWire
  flush: () => Promise<void>
  onDone: (result: { draft: DraftWire }) => void
  onToggle: (accountId: string, on: boolean) => void
  requireApproval: boolean
  setTimeZone: string | null
  versionRef: React.MutableRefObject<number>
  /** Render the draft's tables and math as uploaded images, in body order. */
  renderBlocks: () => Promise<BlockImages>
  /** The X version's follow-ups, and how to change them on the draft. */
  automation: Automation | undefined
  onAutomation?: (automation: Automation | undefined) => void
}

/** Problems that block every destination, collected for the dialogs. */
function blocking(context: ScheduleContext): string[] {
  const problems: string[] = []
  if (context.items.length === 0) problems.push('Turn on at least one platform.')
  for (const item of context.items) {
    if (item.account.health !== 'connected') {
      problems.push(`${CHANNEL_META[item.account.channel].label}: reconnect the account first.`)
    }
    for (const problem of item.publication.problems)
      problems.push(`${CHANNEL_META[item.account.channel].label}: ${problem}`)
  }
  if (context.requireApproval && !context.approved) {
    problems.push('This workspace approves drafts before they publish. Ask for review first.')
  }
  if (!context.canPublish) problems.push('Only owners, admins and publishers schedule and publish.')
  return problems
}

/**
 * Schedule or plan a draft (RFC 042). A planned time only puts the draft on
 * the calendar; Confirm makes it publish. Times are chosen in the set's zone
 * and resolved by the backend, which refuses a time the clocks skip and asks
 * which of two a repeated time means.
 */
export function ScheduleDialog({
  context,
  initialQueue,
  onClose,
}: {
  context: ScheduleContext
  initialQueue?: boolean
  onClose: () => void
}) {
  const { data } = useWrite()
  const [settings, setSettings] = React.useState<SettingsWire | null>(null)
  const zone = context.setTimeZone ?? settings?.timeZone ?? 'UTC'
  const now = new Date()
  const [day, setDay] = React.useState(() => dayIn(new Date(now.getTime() + 86_400_000), zone))
  const [time, setTime] = React.useState('09:00')
  const [queue, setQueue] = React.useState(Boolean(initialQueue))
  // The draft's own choice, copied from its set when it was created (RFC 043).
  const [natural, setNatural] = React.useState(context.draft.naturalPostingTime)
  const [when, setWhen] = React.useState('')
  const [disambiguation, setDisambiguation] = React.useState<'earlier' | 'later' | null>(null)
  const [bestTimes, setBestTimes] = React.useState<{ at: string; reason: string }[]>([])
  const [browsing, setBrowsing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    void draftsApi
      .settings()
      .then(setSettings)
      .catch(() => setSettings(null))
    void draftsApi
      .bestTimes()
      .then(({ items }) => setBestTimes(items))
      .catch(() => setBestTimes([]))
  }, [])
  const local = `${day}T${time}`
  const resolution = resolveLocalTime(local, zone)
  const instant =
    resolution.kind === 'exact'
      ? resolution.at
      : resolution.kind === 'ambiguous' && disambiguation
        ? resolution[disambiguation]
        : null
  const past = instant !== null && instant.getTime() <= Date.now()
  const problems = blocking(context)
  const today = dayIn(now, zone)
  const setInstant = (at: Date) => {
    // The picker works in quarter hours; a typed time rounds up to the next.
    const wall = wallTime(nextQuarter(at), zone)
    setDay(wall.slice(0, 10))
    setTime(wall.slice(11))
    setQueue(false)
    setDisambiguation(null)
  }
  const slots = upcomingSlots(
    settings,
    zone,
    data.queue.map((item) => item.at)
  )
  const schedule = async () => {
    setBusy(true)
    try {
      await context.flush()
      const result = await draftsApi.schedule(context.draft.id, {
        blockImages: await context.renderBlocks(),
        channelConnectionIds: context.items.map((item) => item.account.id),
        ...(queue
          ? { queue: true }
          : { disambiguation: disambiguation ?? undefined, localTime: local, timeZone: zone }),
        naturalPostingTime: natural,
        version: context.versionRef.current,
      })
      context.versionRef.current = result.draft.version
      context.onDone(result)
      const first = result.posts[0]
      toast.success(
        result.created
          ? `Scheduled ${result.posts.length} post${result.posts.length === 1 ? '' : 's'}${first ? ` for ${new Date(first.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone })} (${zone})` : ''}.`
          : 'Already scheduled: nothing new was queued.'
      )
      onClose()
    } catch (error) {
      toast.error(
        error instanceof DraftRequestError ? error.message : 'The draft could not be scheduled.'
      )
    } finally {
      setBusy(false)
    }
  }
  const plan = async (clear = false) => {
    setBusy(true)
    try {
      await context.flush()
      const saved = await writeApi.plan(context.draft.id, {
        plannedFor: clear || !instant ? null : instant.toISOString(),
        timeZone: zone,
      })
      context.onDone({ draft: saved })
      toast.success(
        clear ? 'Plan cleared.' : 'Planned. It is on the calendar and will not publish by itself.'
      )
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The draft could not be planned.')
    } finally {
      setBusy(false)
    }
  }
  const summary = queue
    ? 'At the next free queue slot'
    : instant
      ? `${instant.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: zone })} · ${zone} (${offsetLabel(instant, zone)})`
      : resolution.kind === 'gap'
        ? 'That time does not exist here: the clocks skip it.'
        : 'Choose which of the two times you mean.'
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="max-h-[92dvh] max-w-xl gap-4 overflow-y-auto"
        data-testid="schedule-dialog"
      >
        <DialogHeader>
          <DialogTitle>Schedule</DialogTitle>
          <DialogDescription>
            Times are in {zone} ({offsetLabel(instant ?? now, zone)}). Save as planned keeps it on
            the calendar without publishing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {[
            { at: nextQuarter(new Date(Date.now() + 15 * 60_000)), label: 'Today' },
            { at: atNine(1, zone), label: 'Tomorrow 9:00' },
            { at: atNine(nextMondayOffset(zone), zone), label: 'Later: Monday 9:00' },
          ].map((option) => (
            <Button
              className="rounded-full"
              key={option.label}
              onClick={() => setInstant(option.at)}
              size="sm"
              type="button"
              variant="outline"
            >
              {option.label}
            </Button>
          ))}
          <Button
            aria-pressed={queue}
            className={cn('rounded-full', queue && 'border-sky-400/60 text-sky-200')}
            onClick={() => setQueue(!queue)}
            size="sm"
            type="button"
            variant="outline"
          >
            Next free slot
          </Button>
          <Button
            className="rounded-full"
            onClick={() => setBrowsing(!browsing)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {browsing ? 'Hide queue' : 'Browse queue'}
          </Button>
        </div>
        {browsing ? (
          <ul
            className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-white/[0.06] p-2 text-xs"
            data-testid="queue-slots"
          >
            {slots.length === 0 ? (
              <li className="text-neutral-500">No weekly slots: add them in Write settings.</li>
            ) : null}
            {slots.map((slot) => (
              <li className="flex items-center justify-between" key={slot.at.toISOString()}>
                <LocalTime
                  options={{
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    month: 'short',
                    weekday: 'short',
                  }}
                  value={slot.at.toISOString()}
                />
                {slot.busy ? (
                  <span className="text-neutral-500">taken</span>
                ) : (
                  <Button
                    onClick={() => setInstant(slot.at)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Schedule here
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          aria-label="When, in words"
          onChange={(event) => {
            setWhen(event.target.value)
            const wall = readWhen(event.target.value, zone)
            if (wall) {
              setDay(wall.slice(0, 10))
              setTime(wall.slice(11))
              setQueue(false)
              setDisambiguation(null)
            }
          }}
          placeholder='Type a time: "tomorrow 9am", "in 3 hours", "fri 2pm"'
          value={when}
        />
        {when ? (
          <p className="text-xs text-neutral-500" data-testid="when-reading">
            {readWhen(when, zone) ? `→ ${summary}` : 'Not a time this reads yet.'}
          </p>
        ) : null}
        {queue ? null : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="grid content-start gap-1 text-xs text-neutral-400">
              Day
              <Input
                aria-label="Day"
                min={today}
                onChange={(event) => event.target.value >= today && setDay(event.target.value)}
                type="date"
                value={day}
              />
            </Label>
            <div className="grid content-start gap-2">
              <Label className="grid gap-1 text-xs text-neutral-400">
                Time
                <select
                  aria-label="Time"
                  className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm"
                  onChange={(event) => setTime(event.target.value)}
                  value={time}
                >
                  {QUARTERS.map((quarter) => {
                    const candidate = resolveLocalTime(`${day}T${quarter}`, zone)
                    const passed =
                      candidate.kind === 'exact' && candidate.at.getTime() <= Date.now()
                    return (
                      <option disabled={passed} key={quarter} value={quarter}>
                        {quarter}
                      </option>
                    )
                  })}
                </select>
              </Label>
              <Label className="grid gap-1 text-xs text-neutral-400">
                Or type a time
                <Input
                  aria-label="Exact time"
                  onChange={(event) =>
                    /^\d{2}:\d{2}$/.test(event.target.value) && setTime(event.target.value)
                  }
                  type="time"
                  value={time}
                />
              </Label>
              {resolution.kind === 'ambiguous' ? (
                <fieldset className="grid gap-1 text-xs" data-testid="ambiguous-time">
                  <legend className="text-amber-300">
                    {time} happens twice that day. Which one?
                  </legend>
                  {(['earlier', 'later'] as const).map((option) => (
                    <label className="flex items-center gap-2" key={option}>
                      <input
                        checked={disambiguation === option}
                        name="disambiguation"
                        onChange={() => setDisambiguation(option)}
                        type="radio"
                      />
                      {option === 'earlier' ? 'The first' : 'The second'} (
                      {resolution[option].toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short',
                      })}
                      )
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {resolution.kind === 'gap' ? (
                <p className="text-xs text-red-300" role="alert">
                  {time} does not exist on that day in {zone}: the clocks skip it. Pick another
                  time.
                </p>
              ) : null}
            </div>
          </div>
        )}
        {bestTimes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-neutral-500">Best times</span>
            {bestTimes.map((best) => (
              <Button
                className="rounded-full border-emerald-400/30 text-emerald-200"
                key={best.at}
                onClick={() => setInstant(new Date(best.at))}
                size="sm"
                title={best.reason}
                type="button"
                variant="outline"
              >
                {new Date(best.at).toLocaleString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: zone,
                  weekday: 'short',
                })}
              </Button>
            ))}
          </div>
        ) : null}
        <Destinations context={context} publishAt={instant ?? now} timeZone={zone} />
        <Label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Natural posting time
            <span className="block text-[11px] text-neutral-500">
              Shifts this post by up to four minutes either way so it does not land on the minute; a
              retry keeps the same time.
            </span>
          </span>
          <Switch
            aria-label="Natural posting time"
            checked={natural}
            onCheckedChange={(checked) => setNatural(checked === true)}
          />
        </Label>
        <p
          className="rounded-md bg-white/[0.03] px-3 py-2 text-sm text-white"
          data-testid="schedule-summary"
        >
          {summary}
          {natural && instant ? <span className="text-neutral-400"> ± up to 4 minutes</span> : null}
        </p>
        {past && !queue ? <p className="text-xs text-red-300">That time has passed.</p> : null}
        <Problems problems={problems} />
        <DialogFooter className="flex-wrap gap-2">
          {data.experiments.planning && context.draft.plannedFor ? (
            <Button
              className="mr-auto"
              disabled={busy}
              onClick={() => void plan(true)}
              type="button"
              variant="ghost"
            >
              Clear planned time
            </Button>
          ) : null}
          {/* Planning is an experiment (RFC 043): shown only when it is on. */}
          {data.experiments.planning ? (
            <Button
              disabled={busy || queue || !instant || past}
              onClick={() => void plan()}
              type="button"
              variant="outline"
            >
              Save as planned
            </Button>
          ) : null}
          <Button
            disabled={busy || problems.length > 0 || (!queue && (!instant || past))}
            onClick={() => void schedule()}
            type="button"
          >
            {busy ? 'Scheduling…' : queue ? 'Confirm: next free slot' : 'Confirm schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The next quarter hour at or after an instant. */
function nextQuarter(at: Date): Date {
  const next = new Date(at)
  next.setSeconds(0, 0)
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15)
  return next
}

/** 9:00 in a zone, some days from today. */
function atNine(days: number, zone: string): Date {
  const day = dayIn(new Date(Date.now() + days * 86_400_000), zone)
  const resolved = resolveLocalTime(`${day}T09:00`, zone)
  return resolved.kind === 'exact'
    ? resolved.at
    : resolved.kind === 'ambiguous'
      ? resolved.earlier
      : new Date(Date.now() + days * 86_400_000)
}

/** Days until next Monday in a zone (7 on a Monday). */
function nextMondayOffset(zone: string): number {
  const weekday = new Date(`${dayIn(new Date(), zone)}T12:00:00Z`).getUTCDay()
  return (8 - weekday) % 7 || 7
}

/** The next weekly slots in the zone, marking those a queued post already takes. */
function upcomingSlots(
  settings: SettingsWire | null,
  zone: string,
  taken: string[]
): { at: Date; busy: boolean }[] {
  if (!settings) return []
  const out: { at: Date; busy: boolean }[] = []
  for (let days = 0; days < 21 && out.length < 12; days += 1) {
    const day = dayIn(new Date(Date.now() + days * 86_400_000), zone)
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
    for (const slot of settings.postingSlots.filter((item) => item.weekday === weekday)) {
      const resolved = resolveLocalTime(`${day}T${slot.time}`, zone)
      if (resolved.kind !== 'exact' || resolved.at.getTime() <= Date.now()) continue
      out.push({
        at: resolved.at,
        busy: taken.some(
          (item) => Math.abs(new Date(item).getTime() - resolved.at.getTime()) < 5 * 60_000
        ),
      })
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 12)
}

/** The destinations with their switches, accounts and health. */
function Destinations({
  context,
  publishAt,
  timeZone,
}: {
  context: ScheduleContext
  publishAt: Date
  timeZone: string
}) {
  const { data } = useWrite()
  const setId =
    context.draft.socialSetId ?? data.sets.find((set) => set.visibility === 'WORKSPACE')?.id
  const set = data.sets.find((item) => item.id === setId)
  if (!set) return null
  const on = new Set(context.items.map((item) => item.account.id))
  return (
    <fieldset className="grid gap-1" data-testid="destinations">
      <legend className="mb-1 flex items-center gap-1.5 text-sm">
        <SetDot color={set.color} /> {set.name}
      </legend>
      {set.accounts.map((account) => (
        <Label className="flex items-center gap-3 rounded-md px-1 py-1 text-sm" key={account.id}>
          <ChannelIcon channel={account.channel} className="size-4 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate">
            {account.displayName ?? account.handle ?? CHANNEL_META[account.channel].label}
            {account.handle ? (
              <span className="ml-1.5 text-neutral-500">@{account.handle}</span>
            ) : null}
            {account.health !== 'connected' ? (
              <span className="ml-1.5 text-amber-300">
                {healthLabel(account.health).toLowerCase()}
              </span>
            ) : null}
          </span>
          <Switch
            aria-label={`Publish to ${CHANNEL_META[account.channel].label}`}
            checked={on.has(account.id)}
            onCheckedChange={(checked) => context.onToggle(account.id, checked === true)}
          />
        </Label>
      ))}
      {context.items.some((item) => item.account.channel === 'x') ? (
        <AutomationControls
          automation={context.automation}
          onChange={(next) => context.onAutomation?.(next)}
          publishAt={publishAt}
          readOnly={!context.onAutomation}
          setId={set.id}
          timeZone={timeZone}
        />
      ) : null}
    </fieldset>
  )
}

/** A list of blocking problems, or nothing. */
function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="grid gap-0.5" data-testid="blocking-problems" role="alert">
      {problems.map((problem) => (
        <li className="text-xs text-red-300" key={problem}>
          {problem}
        </li>
      ))}
    </ul>
  )
}

/**
 * The final review before publishing now (RFC 042): the set, each exact
 * account, what each will post, how many posts, media, audience and labels,
 * follow-ups, who may publish and the approval state. Only Publish now
 * publishes, once: the same version and accounts replay rather than repeat.
 */
export function PublishReview({
  context,
  onClose,
  onPreview,
}: {
  context: ScheduleContext
  onClose: () => void
  onPreview: () => void
}) {
  const { data } = useWrite()
  const [busy, setBusy] = React.useState(false)
  const problems = blocking(context)
  const set = data.sets.find(
    (item) =>
      item.id ===
      (context.draft.socialSetId ?? data.sets.find((entry) => entry.visibility === 'WORKSPACE')?.id)
  )
  const followUps = context.items.flatMap(({ account, publication }) =>
    followUpLines(
      publication.target.autoActions,
      publication.target.options?.firstComment,
      CHANNEL_META[account.channel].label
    )
  )
  const publish = async () => {
    setBusy(true)
    try {
      await context.flush()
      const result = await draftsApi.schedule(context.draft.id, {
        blockImages: await context.renderBlocks(),
        channelConnectionIds: context.items.map((item) => item.account.id),
        publishNow: true,
        version: context.versionRef.current,
      })
      context.versionRef.current = result.draft.version
      context.onDone(result)
      toast.success(
        result.created
          ? 'Publishing now. Each destination reports its own result below.'
          : 'Already published at this version: nothing new was sent.'
      )
      onClose()
    } catch (error) {
      toast.error(
        error instanceof DraftRequestError ? error.message : 'The draft could not be published.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="max-h-[92dvh] max-w-xl gap-4 overflow-y-auto"
        data-testid="publish-review"
      >
        <DialogHeader>
          <DialogTitle>Publish now</DialogTitle>
          <DialogDescription>
            Check exactly what goes where. Nothing is sent until you confirm.
          </DialogDescription>
        </DialogHeader>
        {set ? (
          <p className="flex items-center gap-1.5 text-sm">
            <SetDot color={set.color} /> Publishing as{' '}
            <span className="font-medium text-white">{set.name}</span>
          </p>
        ) : null}
        <ul className="grid gap-2">
          {context.items.map(({ account, publication }) => {
            const posts = publication.serialized.posts
            const media = posts.reduce((total, post) => total + post.images, 0)
            const first = publication.target.options
            return (
              <li
                className="rounded-lg border border-white/[0.06] p-3 text-sm"
                data-testid="review-destination"
                key={account.id}
              >
                <p className="flex items-center gap-1.5 text-white">
                  <ChannelIcon channel={account.channel} />
                  {account.displayName ?? CHANNEL_META[account.channel].label}
                  {account.handle ? (
                    <span className="text-neutral-500">@{account.handle}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {posts.length > 1 ? `A thread of ${posts.length} posts` : 'One post'}
                  {media > 0 ? ` · ${media} media` : ''}
                  {publication.target.poll ? ' · a poll' : ''}
                  {first?.documentAssetId ? ' · a PDF document' : ''}
                  {first?.communityId ? ` · to community ${first.communityId}` : ''}
                  {first?.visibility === 'CONNECTIONS' ? ' · connections only' : ''}
                  {first?.replySettings ? ` · replies: ${first.replySettings}` : ''}
                  {first?.madeWithAi ? ' · labelled made with AI' : ''}
                  {first?.paidPartnership ? ' · labelled paid partnership' : ''}
                  {publication.target.replyTo ? ' · a reply' : ''}
                  {first?.quoteRemoteId ? ' · a quote' : ''}
                </p>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-neutral-200">
                  {posts[0]?.caption}
                </p>
                {publication.problems.map((problem) => (
                  <p className="mt-1 text-xs text-red-300" key={problem}>
                    {problem}
                  </p>
                ))}
              </li>
            )
          })}
        </ul>
        {context.items.some((item) => item.account.channel === 'x') ? (
          <AutomationControls
            automation={context.automation}
            onChange={(next) => context.onAutomation?.(next)}
            publishAt={new Date()}
            readOnly={!context.onAutomation}
            setId={set?.id ?? null}
            timeZone={context.setTimeZone ?? 'UTC'}
          />
        ) : null}
        {followUps.length > 0 ? (
          <div className="text-xs text-neutral-400">
            <p className="text-neutral-300">After it is live</p>
            <ul className="list-inside list-disc">
              {followUps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-neutral-500">
          {context.requireApproval
            ? context.approved
              ? 'Approved at this version.'
              : 'Not approved at this version.'
            : 'This workspace does not require approval.'}{' '}
          {context.canPublish ? 'You can publish.' : 'You cannot publish.'}
        </p>
        <Problems problems={problems} />
        <DialogFooter>
          <Button onClick={onPreview} type="button" variant="ghost">
            Preview
          </Button>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={busy || problems.length > 0}
            onClick={() => void publish()}
            type="button"
          >
            {busy ? 'Publishing…' : 'Publish now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
