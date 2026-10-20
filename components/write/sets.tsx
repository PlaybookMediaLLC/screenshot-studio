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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ChannelIcon } from '@/components/drafts/channel-meta'
import { socialSetColorSchema } from '@/lib/api/contracts/social-sets'
import { writeApi } from '@/lib/write/client'
import type { DraftChannel } from '@/lib/write/document'
import { cn } from '@/lib/utils'
import { rememberSet, useWrite, type WriteSet } from './write-context'

/** A set's colour as a dot. */
const DOTS: Record<WriteSet['color'], string> = {
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  gray: 'bg-neutral-400',
  indigo: 'bg-indigo-400',
  orange: 'bg-orange-400',
  pink: 'bg-pink-400',
  rose: 'bg-rose-400',
  sky: 'bg-sky-400',
  teal: 'bg-teal-400',
  violet: 'bg-violet-400',
}

/** A set's colour dot. */
export function SetDot({ color, className }: { color: WriteSet['color']; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', DOTS[color], className)}
    />
  )
}

/** Whether any account of a set needs attention. */
function needsAttention(set: WriteSet): boolean {
  return set.connections.some((connection) => connection.health !== 'healthy')
}

/**
 * The social set the library and composer write as. Sets with the same name
 * stay apart: each shows its accounts' handles, and the id is what is used.
 */
export function SocialSetSwitcher() {
  const { canManageSets, data, setQuery } = useWrite()
  const [managing, setManaging] = React.useState<WriteSet | 'new' | null>(null)
  const active = data.activeSet
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Social set: ${active?.name ?? 'none'}`}
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm text-white hover:bg-white/[0.05]"
            data-testid="social-set-switcher"
            size={null}
            type="button"
            variant="custom"
          >
            {active ? <SetDot color={active.color} /> : null}
            <span className="min-w-0 flex-1 truncate font-medium">
              {active?.name ?? 'No social set'}
            </span>
            {active ? <SetAccounts set={active} /> : null}
            {active && needsAttention(active) ? (
              <span className="text-xs text-amber-300" title="An account needs attention">
                ⚠
              </span>
            ) : null}
            <span aria-hidden className="text-neutral-500">
              ▾
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel>Social sets</DropdownMenuLabel>
          {data.sets.map((set) => (
            <DropdownMenuItem
              className="flex items-center gap-2"
              key={set.id}
              onSelect={() => {
                rememberSet(set.id)
                setQuery({ q: undefined, set: set.id, tag: undefined })
              }}
            >
              <SetDot color={set.color} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{set.name}</span>
                <span className="block truncate text-[11px] text-neutral-500">
                  {set.connections.length === 0
                    ? 'No accounts yet'
                    : set.connections
                        .map((connection) =>
                          connection.handle ? `@${connection.handle}` : connection.platform
                        )
                        .join(' · ')}
                </span>
              </span>
              {set.visibility === 'restricted' ? (
                <span
                  className="text-[10px] text-neutral-500"
                  title="Only its members, owners and admins see it"
                >
                  private
                </span>
              ) : null}
              {set.id === active?.id ? <span aria-label="Current set">✓</span> : null}
            </DropdownMenuItem>
          ))}
          {canManageSets ? (
            <>
              <DropdownMenuSeparator />
              {active ? (
                <DropdownMenuItem onSelect={() => setManaging(active)}>
                  Edit {active.name}…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setManaging('new')}>
                New social set…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {managing ? (
        <SetDialog onClose={() => setManaging(null)} set={managing === 'new' ? null : managing} />
      ) : null}
    </>
  )
}

/** A set's account icons, with a warning on any that needs attention. */
export function SetAccounts({ set }: { set: WriteSet }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-neutral-400">
      {set.connections.map((connection) => (
        <span
          className={cn(connection.health !== 'healthy' && 'text-amber-300')}
          key={connection.id}
          title={`${connection.displayName ?? connection.handle ?? connection.platform}${
            connection.health === 'reconnect'
              ? ': reconnect this account'
              : connection.health === 'disabled'
                ? ': turned off'
                : ''
          }`}
        >
          <ChannelIcon channel={connection.channel} />
        </span>
      ))}
    </span>
  )
}

type Member = { id: string; name: string; role: string }
type Connection = { channel: DraftChannel; id: string; label: string; status: string }

/** Create or edit a social set: identity, accounts, default platforms, access, voice. */
function SetDialog({ onClose, set }: { onClose: () => void; set: WriteSet | null }) {
  const router = useRouter()
  const { data } = useWrite()
  const [name, setName] = React.useState(set?.name ?? '')
  const [color, setColor] = React.useState<WriteSet['color']>(set?.color ?? 'sky')
  const [accounts, setAccounts] = React.useState<string[]>(set?.channelConnectionIds ?? [])
  const [defaults, setDefaults] = React.useState<DraftChannel[]>(set?.defaultChannels ?? [])
  const [restricted, setRestricted] = React.useState(set?.visibility === 'restricted')
  const [members, setMembers] = React.useState<string[]>(set?.memberUserIds ?? [])
  const [voice, setVoice] = React.useState(set?.preferences.voice ?? '')
  const [timeZone, setTimeZone] = React.useState(set?.timeZone ?? '')
  const [busy, setBusy] = React.useState(false)
  const [people, setPeople] = React.useState<Member[]>([])
  const connections: Connection[] = data.connections
  React.useEffect(() => {
    void fetch(`/api/v1/organizations/${encodeURIComponent(data.organizationId)}/members`)
      .then((response) => (response.ok ? response.json() : { members: [] }))
      .then((body: { members: { role: string; user: { id: string; name: string } }[] }) =>
        setPeople(
          body.members.map((member) => ({
            id: member.user.id,
            name: member.user.name,
            role: member.role,
          }))
        )
      )
      .catch(() => setPeople([]))
  }, [data.organizationId])
  const chosenChannels = connections
    .filter((item) => accounts.includes(item.id))
    .map((item) => item.channel)
  const toggleAccount = (connection: Connection, on: boolean) => {
    setAccounts((current) =>
      on
        ? [
            ...current.filter(
              (id) => connections.find((item) => item.id === id)?.channel !== connection.channel
            ),
            connection.id,
          ]
        : current.filter((id) => id !== connection.id)
    )
  }
  const save = async () => {
    setBusy(true)
    try {
      const input = {
        channelConnectionIds: accounts,
        color,
        defaultChannels: defaults.filter((channel) => chosenChannels.includes(channel)),
        memberUserIds: members,
        name: name.trim(),
        preferences: { ...set?.preferences, voice: voice.trim() || undefined },
        timeZone: timeZone.trim(),
        visibility: restricted ? ('restricted' as const) : ('workspace' as const),
      }
      const saved = set ? await writeApi.updateSet(set.id, input) : await writeApi.createSet(input)
      rememberSet(saved.id)
      toast.success(set ? 'Social set saved.' : 'Social set created.')
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The set could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!set) return
    setBusy(true)
    try {
      await writeApi.deleteSet(set.id)
      toast.success('Social set deleted.')
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The set could not be deleted.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[90dvh] max-w-lg gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{set ? `Edit ${set.name}` : 'New social set'}</DialogTitle>
          <DialogDescription>
            A social set is one publishing identity: at most one account per platform. Names need
            not be unique.
          </DialogDescription>
        </DialogHeader>
        <Label className="grid gap-1.5 text-sm">
          Name
          <Input maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
        </Label>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {socialSetColorSchema.options.map((option) => (
              <Button
                aria-label={`Colour ${option}`}
                aria-pressed={color === option}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border',
                  color === option ? 'border-white' : 'border-transparent'
                )}
                key={option}
                onClick={() => setColor(option)}
                size={null}
                type="button"
                variant="custom"
              >
                <SetDot className="size-4" color={option} />
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm">Accounts</legend>
          {connections.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No connected accounts. Connect one in workspace settings, Channels.
            </p>
          ) : (
            connections.map((connection) => (
              <Label
                className="flex items-center gap-3 rounded-md px-1 py-1 text-sm"
                key={connection.id}
              >
                <ChannelIcon channel={connection.channel} className="size-4 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate">
                  {connection.label}
                  {connection.status !== 'ACTIVE' ? (
                    <span className="ml-1.5 text-xs text-amber-300">
                      {connection.status.toLowerCase()}
                    </span>
                  ) : null}
                </span>
                <Switch
                  aria-label={`Use ${connection.label} in this set`}
                  checked={accounts.includes(connection.id)}
                  onCheckedChange={(checked) => toggleAccount(connection, checked === true)}
                />
              </Label>
            ))
          )}
          <p className="text-[11px] text-neutral-500">
            One account per platform: choosing another replaces it.
          </p>
        </fieldset>
        {chosenChannels.length > 0 ? (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm">Default platforms for new drafts</legend>
            <p className="text-[11px] text-neutral-500">
              The first is the primary; the others sync from it.
            </p>
            {chosenChannels.map((channel) => (
              <Label className="flex items-center gap-3 text-sm" key={channel}>
                <ChannelIcon channel={channel} className="size-4 text-neutral-400" />
                <span className="flex-1">{channel}</span>
                {defaults.indexOf(channel) === 0 ? (
                  <span className="text-[11px] text-sky-300">primary</span>
                ) : null}
                <Switch
                  aria-label={`${channel} on new drafts`}
                  checked={defaults.includes(channel)}
                  onCheckedChange={(checked) =>
                    setDefaults((current) =>
                      checked === true
                        ? [...current, channel]
                        : current.filter((item) => item !== channel)
                    )
                  }
                />
              </Label>
            ))}
          </fieldset>
        ) : null}
        <Label className="grid gap-1.5 text-sm">
          Time zone
          <Input
            onChange={(event) => setTimeZone(event.target.value)}
            placeholder="The workspace's, or an IANA zone such as Europe/Paris"
            value={timeZone}
          />
        </Label>
        <Label className="grid gap-1.5 text-sm">
          Voice, for the writing assistant
          <Textarea
            className="min-h-16"
            maxLength={2000}
            onChange={(event) => setVoice(event.target.value)}
            placeholder="Plain, specific, a little dry. Short sentences."
            value={voice}
          />
        </Label>
        <Label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Private set
            <span className="block text-[11px] text-neutral-500">
              Only the members below, owners and admins see its drafts.
            </span>
          </span>
          <Switch
            aria-label="Private set"
            checked={restricted}
            onCheckedChange={(checked) => setRestricted(checked === true)}
          />
        </Label>
        {restricted ? (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm">Members</legend>
            {people.map((person) => (
              <Label className="flex items-center gap-3 text-sm" key={person.id}>
                <span className="min-w-0 flex-1 truncate">
                  {person.name} <span className="text-[11px] text-neutral-500">{person.role}</span>
                </span>
                <Switch
                  aria-label={`${person.name} may see this set`}
                  checked={
                    members.includes(person.id) ||
                    person.role === 'owner' ||
                    person.role === 'admin'
                  }
                  disabled={person.role === 'owner' || person.role === 'admin'}
                  onCheckedChange={(checked) =>
                    setMembers((current) =>
                      checked === true
                        ? [...current, person.id]
                        : current.filter((id) => id !== person.id)
                    )
                  }
                />
              </Label>
            ))}
          </fieldset>
        ) : null}
        <DialogFooter className="items-center">
          {set && !set.isDefault ? (
            <Button
              className="mr-auto text-red-300"
              disabled={busy}
              onClick={() => void remove()}
              type="button"
              variant="ghost"
            >
              Delete set
            </Button>
          ) : null}
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void save()} type="button">
            {set ? 'Save' : 'Create set'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
