'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
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
import { Textarea } from '@/components/ui/textarea'
import { serializeDraft } from '@/lib/content-drafts/serialize'
import {
  DEFAULT_AUTOMATION,
  durationLabel,
  PLUG_WINDOW_HOURS,
  retweetAt,
  ruleLabel,
} from '@/lib/write/automation'
import { CAPABILITIES } from '@/lib/write/capabilities'
import { writeApi } from '@/lib/write/client'
import type { Automation, RetweetRule } from '@/lib/write/document'
import { offsetLabel } from '@/lib/write/zoned-time'
import { useWrite, type WriteSet } from '../write-context'

/**
 * X follow-ups (RFC 041), set per draft on its X version: Auto-RT reposts
 * at set times and can remove each repost later; Auto-Plug replies once
 * when the post reaches a like or repost count; Auto-DM is shown off, with
 * the reason. Nothing here runs until the post is live.
 */
export function AutomationControls({
  automation,
  onChange,
  publishAt,
  readOnly,
  setId,
  timeZone,
}: {
  automation: Automation | undefined
  onChange: (automation: Automation | undefined) => void
  /** When the post would go out, for the projected repost times. */
  publishAt: Date
  readOnly?: boolean
  setId: string | null
  timeZone: string
}) {
  const [editing, setEditing] = React.useState<'retweet' | 'plug' | null>(null)
  const { data } = useWrite()
  const defaults = data.sets.find((set) => set.id === setId)?.preferences.automation
  const retweeting = (automation?.retweets?.length ?? 0) > 0
  const plugging = (automation?.plugAtLikes ?? 0) > 0
  const update = (next: Automation) => {
    const empty =
      !next.retweets?.length && !next.plugAtLikes && !next.repostAtLikes && !next.quoteAfterHours
    onChange(empty ? undefined : next)
  }
  return (
    <div className="grid gap-1.5 pl-7" data-testid="automation-controls">
      <Row
        detail={
          retweeting
            ? `${automation?.retweets?.map(ruleLabel).join('; ')}${automation?.unretweetAfterMinutes ? ` · removed after ${durationLabel(automation.unretweetAfterMinutes)}` : ''}`
            : 'Repost at set times after publishing'
        }
        label="Auto-RT"
        on={retweeting}
        onEdit={readOnly ? undefined : () => setEditing('retweet')}
        onToggle={
          readOnly
            ? undefined
            : (on) =>
                on
                  ? setEditing('retweet')
                  : update({ ...automation, retweets: undefined, unretweetAfterMinutes: undefined })
        }
      />
      <Row
        detail={
          plugging
            ? `At ${automation?.plugAtLikes} ${automation?.plugMetric === 'reposts' ? 'reposts' : 'likes'}: “${automation?.plugText ?? ''}”`
            : 'Reply once when the post takes off'
        }
        label="Auto-Plug"
        on={plugging}
        onEdit={readOnly ? undefined : () => setEditing('plug')}
        onToggle={
          readOnly
            ? undefined
            : (on) =>
                on
                  ? setEditing('plug')
                  : update({
                      ...automation,
                      plugAtLikes: undefined,
                      plugMetric: undefined,
                      plugText: undefined,
                    })
        }
      />
      <Row
        detail={
          CAPABILITIES.x.automation.directMessage.available
            ? ''
            : CAPABILITIES.x.automation.directMessage.reason
        }
        label="Auto-DM"
        on={false}
      />
      {editing === 'retweet' ? (
        <RetweetDialog
          automation={automation}
          defaults={defaults}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            update(next)
            setEditing(null)
          }}
          publishAt={publishAt}
          setId={setId}
          timeZone={timeZone}
        />
      ) : null}
      {editing === 'plug' ? (
        <PlugDialog
          automation={automation}
          defaults={defaults}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            update(next)
            setEditing(null)
          }}
          setId={setId}
        />
      ) : null}
    </div>
  )
}

function Row({
  detail,
  label,
  on,
  onEdit,
  onToggle,
}: {
  detail: string
  label: string
  on: boolean
  onEdit?: () => void
  onToggle?: (on: boolean) => void
}) {
  return (
    <div
      className="flex items-start gap-3 text-xs"
      data-testid={`automation-${label.toLowerCase()}`}
    >
      <span className="min-w-0 flex-1">
        <span className="text-neutral-200">{label}</span>
        <span className="block text-neutral-500">{detail}</span>
      </span>
      {on && onEdit ? (
        <Button
          className="h-6 px-2 text-xs"
          onClick={onEdit}
          size={null}
          type="button"
          variant="ghost"
        >
          Edit
        </Button>
      ) : null}
      <Switch
        aria-label={label}
        checked={on}
        disabled={!onToggle}
        onCheckedChange={(checked) => onToggle?.(checked === true)}
      />
    </div>
  )
}

/** Save follow-ups as the set's defaults for new drafts, keeping its other preferences. */
async function saveDefaults(
  setId: string | null,
  preferences: WriteSet['preferences'] | undefined,
  automation: Automation,
  refresh: () => void
) {
  if (!setId) return
  try {
    await writeApi.updateSet(setId, {
      preferences: { ...preferences, automation: { ...preferences?.automation, ...automation } },
    })
    toast.success('Saved as the default for new drafts in this set.')
    refresh()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'The defaults did not save.')
  }
}

type RuleDraft = {
  amount: string
  at: string
  days: string
  kind: 'after' | 'dayAt'
  unit: 'hours' | 'days'
}

function toDraft(rule: RetweetRule): RuleDraft {
  if ('afterMinutes' in rule) {
    const days = rule.afterMinutes % 1_440 === 0
    return {
      amount: String(days ? rule.afterMinutes / 1_440 : rule.afterMinutes / 60),
      at: '10:30',
      days: '1',
      kind: 'after',
      unit: days ? 'days' : 'hours',
    }
  }
  return { amount: '6', at: rule.at, days: String(rule.days), kind: 'dayAt', unit: 'hours' }
}

function fromDraft(draft: RuleDraft, timeZone: string): RetweetRule | null {
  if (draft.kind === 'after') {
    const amount = Number(draft.amount)
    const minutes = Math.round(amount * (draft.unit === 'days' ? 1_440 : 60))
    return minutes >= 1 && minutes <= 43_200 ? { afterMinutes: minutes } : null
  }
  const days = Number(draft.days)
  return Number.isInteger(days) && days >= 0 && days <= 30 && /^\d{2}:\d{2}$/.test(draft.at)
    ? { at: draft.at, days, timeZone }
    : null
}

function RetweetDialog({
  automation,
  defaults,
  onClose,
  onSave,
  publishAt,
  setId,
  timeZone,
}: {
  automation: Automation | undefined
  defaults: Automation | undefined
  onClose: () => void
  onSave: (automation: Automation) => void
  publishAt: Date
  setId: string | null
  timeZone: string
}) {
  const router = useRouter()
  const { canManageSets, data } = useWrite()
  const preferences = data.sets.find((item) => item.id === setId)?.preferences
  const start = automation?.retweets?.length
    ? automation
    : defaults?.retweets?.length
      ? defaults
      : DEFAULT_AUTOMATION
  const [rules, setRules] = React.useState<RuleDraft[]>(() => (start.retweets ?? []).map(toDraft))
  const [removeAfter, setRemoveAfter] = React.useState(
    start.unretweetAfterMinutes ? String(start.unretweetAfterMinutes / 60) : ''
  )
  const parsed = rules.map((rule) => fromDraft(rule, timeZone))
  const removal = removeAfter ? Math.round(Number(removeAfter) * 60) : 0
  const valid = parsed.length > 0 && parsed.every(Boolean) && removal >= 0 && removal <= 10_080
  const next: Automation = {
    ...automation,
    retweets: parsed.filter((rule): rule is RetweetRule => rule !== null),
    unretweetAfterMinutes: removal || undefined,
  }
  const set = (index: number, change: Partial<RuleDraft>) =>
    setRules((current) => current.map((rule, at) => (at === index ? { ...rule, ...change } : rule)))
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-w-lg" data-testid="auto-rt-dialog">
        <DialogHeader>
          <DialogTitle>Auto-RT</DialogTitle>
          <DialogDescription>
            Repost from the same account at each time below, after the post is live. Times of day
            are in {timeZone} ({offsetLabel(publishAt, timeZone)}).
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {rules.map((rule, index) => {
            const at = parsed[index] ? retweetAt(parsed[index], publishAt) : null
            return (
              <li
                className="grid gap-1.5 rounded-md border border-white/[0.06] p-2 text-sm"
                data-testid="retweet-rule"
                key={index}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Rule type"
                    className="h-8 rounded-md border border-white/10 bg-transparent px-2 text-sm"
                    onChange={(event) =>
                      set(index, { kind: event.target.value === 'dayAt' ? 'dayAt' : 'after' })
                    }
                    value={rule.kind}
                  >
                    <option value="after">After</option>
                    <option value="dayAt">Days later at</option>
                  </select>
                  {rule.kind === 'after' ? (
                    <>
                      <Input
                        aria-label="Amount"
                        className="h-8 w-20"
                        min={1}
                        onChange={(event) => set(index, { amount: event.target.value })}
                        type="number"
                        value={rule.amount}
                      />
                      <select
                        aria-label="Unit"
                        className="h-8 rounded-md border border-white/10 bg-transparent px-2 text-sm"
                        onChange={(event) =>
                          set(index, { unit: event.target.value === 'days' ? 'days' : 'hours' })
                        }
                        value={rule.unit}
                      >
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <Input
                        aria-label="Days later"
                        className="h-8 w-20"
                        max={30}
                        min={0}
                        onChange={(event) => set(index, { days: event.target.value })}
                        type="number"
                        value={rule.days}
                      />
                      <Input
                        aria-label="Time of day"
                        className="h-8 w-28"
                        onChange={(event) => set(index, { at: event.target.value })}
                        type="time"
                        value={rule.at}
                      />
                    </>
                  )}
                  <Button
                    aria-label={`Remove repost ${index + 1}`}
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={() => setRules((current) => current.filter((_, at) => at !== index))}
                    size={null}
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </div>
                <p className="text-xs text-neutral-500" data-testid="retweet-projection">
                  {at
                    ? `If published ${publishAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone })}: reposts ${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone })}`
                    : 'Set a time between one minute and 30 days after publishing.'}
                </p>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={rules.length >= 5}
            onClick={() => setRules((current) => [...current, toDraft({ afterMinutes: 1_440 })])}
            size="sm"
            type="button"
            variant="outline"
          >
            Add a repost
          </Button>
          <Button
            onClick={() => {
              const reset = defaults?.retweets?.length ? defaults : DEFAULT_AUTOMATION
              setRules((reset.retweets ?? []).map(toDraft))
              setRemoveAfter(
                reset.unretweetAfterMinutes ? String(reset.unretweetAfterMinutes / 60) : ''
              )
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Reset to defaults
          </Button>
        </div>
        <Label className="flex items-center gap-2 text-sm">
          Remove each repost after
          <Input
            aria-label="Remove after hours"
            className="h-8 w-20"
            max={168}
            min={0}
            onChange={(event) => setRemoveAfter(event.target.value)}
            placeholder="never"
            type="number"
            value={removeAfter}
          />
          hours
        </Label>
        <DialogFooter className="gap-2 sm:justify-between">
          {canManageSets ? (
            <Button
              disabled={!valid || !setId}
              onClick={() =>
                void saveDefaults(
                  setId,
                  preferences,
                  { retweets: next.retweets, unretweetAfterMinutes: next.unretweetAfterMinutes },
                  router.refresh
                )
              }
              type="button"
              variant="ghost"
            >
              Save as default
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!valid} onClick={() => onSave(next)} type="button">
              Enable Auto-RT
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlugDialog({
  automation,
  defaults,
  onClose,
  onSave,
  setId,
}: {
  automation: Automation | undefined
  defaults: Automation | undefined
  onClose: () => void
  onSave: (automation: Automation) => void
  setId: string | null
}) {
  const router = useRouter()
  const { canManageSets, data } = useWrite()
  const preferences = data.sets.find((item) => item.id === setId)?.preferences
  const start = automation?.plugAtLikes ? automation : defaults?.plugAtLikes ? defaults : undefined
  const [threshold, setThreshold] = React.useState(String(start?.plugAtLikes ?? 100))
  const [metric, setMetric] = React.useState<'likes' | 'reposts'>(start?.plugMetric ?? 'likes')
  const [text, setText] = React.useState(start?.plugText ?? '')
  const length = serializeDraft([{ children: [{ text }], type: 'p' }], 'x').length
  const count = Number(threshold)
  const valid =
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 1_000_000 &&
    text.trim() !== '' &&
    length <= 280
  const plug = { plugAtLikes: count, plugMetric: metric, plugText: text.trim() }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-w-lg" data-testid="auto-plug-dialog">
        <DialogHeader>
          <DialogTitle>Auto-Plug</DialogTitle>
          <DialogDescription>
            When the post reaches the count below, reply under it once. Checked every 15 minutes for
            six hours, then hourly, for {PLUG_WINDOW_HOURS} hours; it never replies twice.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          At
          <Input
            aria-label="Threshold"
            className="h-8 w-24"
            min={1}
            onChange={(event) => setThreshold(event.target.value)}
            type="number"
            value={threshold}
          />
          <select
            aria-label="Metric"
            className="h-8 rounded-md border border-white/10 bg-transparent px-2 text-sm"
            onChange={(event) => setMetric(event.target.value === 'reposts' ? 'reposts' : 'likes')}
            value={metric}
          >
            <option value="likes">likes</option>
            <option value="reposts">reposts</option>
          </select>
        </div>
        <Label className="grid gap-1 text-xs text-neutral-400">
          Reply
          <Textarea
            aria-label="Plug reply"
            onChange={(event) => setText(event.target.value)}
            placeholder="If this helped, the full guide is here: …"
            rows={4}
            value={text}
          />
          <span className={length > 280 ? 'text-red-300' : ''} data-testid="plug-count">
            {length} / 280
          </span>
        </Label>
        {text.trim() ? (
          <div
            className="rounded-lg border border-white/[0.06] p-3 text-sm"
            data-testid="plug-preview"
          >
            <p className="text-xs text-neutral-500">Reply preview — not published</p>
            <p className="mt-1 whitespace-pre-wrap text-neutral-200">{text}</p>
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          {canManageSets ? (
            <Button
              disabled={!valid || !setId}
              onClick={() => void saveDefaults(setId, preferences, plug, router.refresh)}
              type="button"
              variant="ghost"
            >
              Save as default
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!valid}
              onClick={() => onSave({ ...automation, ...plug })}
              type="button"
            >
              Enable Auto-Plug
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
