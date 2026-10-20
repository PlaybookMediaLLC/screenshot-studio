'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChannelIcon } from '@/components/drafts/channel-meta'
import { EmptyState, Group, Pill, Row } from '@/components/platform-ui'
import { ConfirmDialog } from '@/components/settings/ConfirmDialog'
import { DeveloperId } from '@/components/settings/DeveloperId'
import { socialSetHref } from '@/components/workspace/settings-sections'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { copyableSocialSetSchema, socialSetRemovalSchema, socialSetSchema } from '@/lib/api/contracts/social-sets'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { settingsErrorMessage, settingsRequest } from '@/lib/settings/client'
import { z } from 'zod'
import { Layers } from 'lucide-react'
import { type SocialSetRecord, useSocialSets, useStoreSocialSet } from './api'
import { SET_COLORS } from './colors'

function Platforms({ set }: { set: SocialSetRecord }) {
  if (set.accounts.length === 0) return <span className="text-xs text-muted-foreground">No accounts yet</span>
  return (
    <span className="flex items-center gap-1.5" aria-label={`Accounts: ${set.accounts.map((account) => account.platform).join(', ')}`}>
      {set.accounts.map((account) => {
        const channel = channelForPlatform(account.platform)
        return channel ? (
          <ChannelIcon channel={channel} className="size-3.5 text-foreground/80" key={account.id} />
        ) : (
          <span className="text-xs" key={account.id}>
            {account.platform}
          </span>
        )
      })}
    </span>
  )
}

function SetRow({ set }: { set: SocialSetRecord }) {
  return (
    <Row
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Platforms set={set} />
          <span>· {set.weeklySlotCount} weekly slots</span>
          <span>· {set.timeZone}</span>
          <DeveloperId id={set.id} label="Social set" />
        </span>
      }
      label={
        <span className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: set.color }} />
          {set.name}
          <Pill tone={set.visibility === 'PRIVATE' ? 'purple' : 'gray'}>
            {set.visibility === 'PRIVATE' ? 'Private to you' : 'Shared with workspace'}
          </Pill>
          {set.needsAttention ? <Pill tone="yellow">Some accounts need attention</Pill> : null}
        </span>
      }
    >
      <div className="flex flex-wrap gap-2">
        {set.needsAttention ? (
          <Button asChild size="sm" variant="outline">
            <Link href={socialSetHref(set.id)}>Manage platforms</Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link aria-label={`Add a platform to ${set.name}`} href={`${socialSetHref(set.id)}#accounts`}>
            Add platform
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link aria-label={`Settings for ${set.name}`} href={socialSetHref(set.id)}>
            Settings
          </Link>
        </Button>
      </div>
    </Row>
  )
}

function CreateSet({ canManage }: { canManage: boolean }) {
  const store = useStoreSocialSet()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(SET_COLORS[0]!.value)
  const [visibility, setVisibility] = useState<'WORKSPACE' | 'PRIVATE'>('WORKSPACE')
  const [creating, setCreating] = useState(false)
  const valid = name.trim().length > 0 && name.trim().length <= 80

  const create = async () => {
    setCreating(true)
    try {
      const created = await settingsRequest('/api/v1/social-sets', socialSetSchema, {
        body: { color, name: name.trim(), visibility },
        method: 'POST',
      })
      await store(created)
      toast.success(`${created.name} is ready. Connect its accounts next.`)
      window.location.assign(`${socialSetHref(created.id)}#accounts`)
    } catch (error) {
      toast.error(settingsErrorMessage(error))
      setCreating(false)
    }
  }

  if (!canManage) return null
  return (
    <Group>
      <Row description="A set is the accounts one person or brand posts from, with its own schedule and voice." label="New social set" layout="stacked">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) void create()
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-56 flex-1 gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Name</span>
              <Input maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Person or brand" value={name} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Who can use it</span>
              <select
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
                onChange={(event) => setVisibility(z.enum(['WORKSPACE', 'PRIVATE']).parse(event.target.value))}
                value={visibility}
              >
                <option value="WORKSPACE">Everyone in the workspace</option>
                <option value="PRIVATE">Only me</option>
              </select>
            </label>
            <Button disabled={!valid || creating} type="submit">
              {creating ? 'Creating…' : 'Create social set'}
            </Button>
          </div>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Colour</legend>
            {SET_COLORS.map((option) => (
              <label className="cursor-pointer" key={option.value} title={option.label}>
                <input checked={color === option.value} className="peer sr-only" name="new-set-color" onChange={() => setColor(option.value)} type="radio" value={option.value} />
                <span
                  aria-hidden
                  className="block size-6 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-background peer-checked:ring-foreground peer-focus-visible:ring-ring"
                  style={{ backgroundColor: option.value }}
                />
                <span className="sr-only">{option.label}</span>
              </label>
            ))}
          </fieldset>
        </form>
      </Row>
    </Group>
  )
}

function Unassigned({ canManage, sets }: { canManage: boolean; sets: SocialSetRecord[] }) {
  const store = useStoreSocialSet()
  const { data, refetch } = useSocialSets()
  const accounts = data?.unassigned ?? []
  if (accounts.length === 0) return null
  return (
    <Group>
      <Row description="These accounts belong to the workspace but to no set yet. Drafts can publish to an account only through its set." label="Accounts in no set" layout="stacked">
        <ul className="grid gap-2">
          {accounts.map((account) => (
            <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={account.id}>
              <span>
                {account.displayName ?? account.handle ?? account.platform} <span className="text-muted-foreground">· {account.platform}</span>
              </span>
              {canManage ? (
                <select
                  aria-label={`Add ${account.displayName ?? account.platform} to a set`}
                  className="h-8 rounded-lg border border-border bg-card px-2 text-sm"
                  defaultValue=""
                  onChange={async (event) => {
                    const target = event.target.value
                    if (!target) return
                    try {
                      await store(
                        await settingsRequest(
                          `/api/v1/social-sets/${encodeURIComponent(target)}/accounts/${encodeURIComponent(account.id)}`,
                          socialSetSchema,
                          { method: 'POST' }
                        )
                      )
                      await refetch()
                      toast.success('Account added to the set.')
                    } catch (error) {
                      toast.error(settingsErrorMessage(error))
                      event.target.value = ''
                    }
                  }}
                >
                  <option value="">Add to a set…</option>
                  {sets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
      </Row>
    </Group>
  )
}

function Orphaned() {
  const { data, refetch } = useSocialSets()
  const orphaned = data?.orphaned ?? []
  if (orphaned.length === 0) return null
  return (
    <Group>
      <Row description="Private sets whose owners left the workspace. Their accounts still count toward your plan; delete a set to disable its accounts." label="Private sets without an owner" layout="stacked">
        <ul className="grid gap-2">
          {orphaned.map((set) => (
            <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={set.id}>
              <span>
                {set.name} <span className="text-muted-foreground">· {set.accountCount} accounts</span>
              </span>
              <ConfirmDialog
                confirmLabel="Delete set"
                confirmText={set.name}
                description="Its accounts are disabled and its drafts archived. Published posts and their history stay."
                destructive
                onConfirm={async (typed) => {
                  try {
                    await settingsRequest(`/api/v1/social-sets/${encodeURIComponent(set.id)}`, socialSetRemovalSchema, {
                      body: { confirmation: typed },
                      method: 'DELETE',
                    })
                    await refetch()
                    return null
                  } catch (error) {
                    return settingsErrorMessage(error)
                  }
                }}
                title={`Delete ${set.name}?`}
                triggerLabel="Delete"
              />
            </li>
          ))}
        </ul>
      </Row>
    </Group>
  )
}

function CopyFromWorkspace({ canManage }: { canManage: boolean }) {
  const store = useStoreSocialSet()
  const copyable = useQuery({
    enabled: canManage,
    queryFn: () =>
      settingsRequest('/api/v1/social-sets/copyable', z.object({ items: z.array(copyableSocialSetSchema) })),
    queryKey: ['social-sets', 'copyable'],
  })
  const items = copyable.data?.items ?? []
  if (!canManage || items.length === 0) return null
  return (
    <Group>
      <Row
        description="Copies a set's name, colour, schedule, defaults and style guide from another of your workspaces. Accounts are not copied: their access stays with their own workspace, so you connect them again here. The copy starts private to you."
        label="Copy from another workspace"
      >
        <select
          aria-label="Copy a social set from another workspace"
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
          defaultValue=""
          onChange={async (event) => {
            const choice = items.find((item) => `${item.workspaceId}/${item.id}` === event.target.value)
            if (!choice) return
            try {
              const copied = await settingsRequest('/api/v1/social-sets/copy', socialSetSchema, {
                body: { socialSetId: choice.id, workspaceId: choice.workspaceId },
                method: 'POST',
              })
              await store(copied)
              window.location.assign(`${socialSetHref(copied.id)}#accounts`)
            } catch (error) {
              toast.error(settingsErrorMessage(error))
              event.target.value = ''
            }
          }}
        >
          <option value="">Choose a set…</option>
          {items.map((item) => (
            <option key={`${item.workspaceId}/${item.id}`} value={`${item.workspaceId}/${item.id}`}>
              {item.name} · {item.workspaceName}
            </option>
          ))}
        </select>
      </Row>
    </Group>
  )
}

/**
 * Social sets (RFC 043): the people and brands this workspace posts as. Each
 * row is one set by ID; two sets can share a name and stay apart.
 */
export function SocialSetList({ canManage }: { canManage: boolean }) {
  const list = useSocialSets()
  if (list.isPending) return <p className="text-sm text-muted-foreground">Loading social sets…</p>
  if (list.isError) {
    return (
      <p className="text-sm text-red-700 dark:text-red-300" role="alert">
        {settingsErrorMessage(list.error)}
      </p>
    )
  }
  const sets = list.data.items
  return (
    <div className="grid gap-6">
      {sets.length === 0 ? (
        <EmptyState description="Create a set for each person or brand you post as." icon={Layers} title="No social sets yet" />
      ) : (
        <Group>
          {sets.map((set) => (
            <SetRow key={set.id} set={set} />
          ))}
        </Group>
      )}
      <CreateSet canManage={canManage} />
      <Unassigned canManage={canManage} sets={sets} />
      <CopyFromWorkspace canManage={canManage} />
      <Orphaned />
    </div>
  )
}
