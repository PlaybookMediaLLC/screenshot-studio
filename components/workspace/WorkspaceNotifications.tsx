'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Group, Section } from '@/components/platform-ui'
import { EmailSwitch, SocialSetNotifications } from '@/components/settings/NotificationExtras'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  notificationRequest,
  useNotificationIdentity,
  useNotificationPageVisible,
} from '@/lib/notifications/client'
import {
  notificationDeliverySchema,
  notificationSettingsSchema,
  notificationSlackChannelsSchema,
  type NotificationSettings,
} from '@/lib/notifications/schema'

function SettingsForm({
  initial,
  identity,
}: {
  initial: NotificationSettings
  identity: ReturnType<typeof useNotificationIdentity>
}) {
  const queryClient = useQueryClient()
  const search = useSearchParams()
  const visible = useNotificationPageVisible()
  const [settings, setSettings] = useState(initial)
  const [policy, setPolicy] = useState(initial.policy)
  const [preferences, setPreferences] = useState(initial.preferences)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(
    search.has('error')
      ? 'Slack did not connect. Check your workspace and permissions, then try again.'
      : ''
  )
  const [saved, setSaved] = useState(
    search.has('connected')
      ? 'Slack connected. Select a destination and save your workspace policy.'
      : ''
  )
  const [testDelivery, setTestDelivery] = useState('')
  const [testUntil, setTestUntil] = useState<Record<string, number>>({})
  useEffect(() => {
    const deadlines = Object.values(testUntil)
    if (!deadlines.length) return
    const timer = setTimeout(
      () =>
        setTestUntil((current) =>
          Object.fromEntries(Object.entries(current).filter(([, until]) => until > Date.now()))
        ),
      Math.max(1, Math.min(...deadlines) - Date.now())
    )
    return () => clearTimeout(timer)
  }, [testUntil])
  const channels = useQuery({
    queryKey: [...identity.key, 'slack-channels', policy.slackConnectionId],
    enabled: settings.canManage && !!policy.slackConnectionId,
    queryFn: async ({ signal }) => {
      const result: z.infer<typeof notificationSlackChannelsSchema>['channels'] = []
      const visited = new Set<string>()
      let cursor = ''
      do {
        if (visited.has(cursor))
          throw new Error('Slack returned a repeated channel cursor. Reconnect and try again.')
        visited.add(cursor)
        const page = await notificationRequest(
          identity,
          `/slack/channels?connectionId=${encodeURIComponent(policy.slackConnectionId)}&cursor=${encodeURIComponent(cursor)}`,
          notificationSlackChannelsSchema,
          { signal }
        )
        result.push(...page.channels)
        cursor = page.nextCursor
      } while (cursor)
      return result
    },
  })
  const deliveries = useQuery({
    queryKey: [...identity.key, 'deliveries'],
    queryFn: ({ signal }) =>
      notificationRequest(
        identity,
        '/deliveries',
        z.object({ deliveries: z.array(notificationDeliverySchema) }),
        { signal }
      ),
    enabled: settings.canManage && visible,
    refetchInterval: visible ? 30_000 : false,
    refetchIntervalInBackground: false,
  })

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name)
    setError('')
    setSaved('')
    try {
      await action()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Changes could not be saved. Try again.'
      )
    } finally {
      setBusy('')
    }
  }
  async function save(section: 'policy' | 'preferences') {
    await perform(section, async () => {
      const next = await notificationRequest(identity, `/${section}`, notificationSettingsSchema, {
        method: 'PUT',
        body: section === 'policy' ? policy : preferences,
      })
      setSettings(next)
      if (section === 'policy') setPolicy(next.policy)
      else setPreferences(next.preferences)
      queryClient.setQueryData([...identity.key, 'settings'], next)
      setSaved(section === 'policy' ? 'Workspace policy saved.' : 'Your preferences are saved.')
    })
  }
  async function connect() {
    await perform('connect', async () => {
      const result = await notificationRequest(
        identity,
        '/slack/connect',
        z.object({ url: z.string().url() }),
        {
          method: 'POST',
          body: { purpose: 'notifications', connectionId: policy.slackConnectionId || undefined },
        }
      )
      window.location.assign(result.url)
    })
  }
  async function disconnect(id: string) {
    await perform('disconnect', async () => {
      await notificationRequest(
        identity,
        `/slack/${encodeURIComponent(id)}`,
        z.object({ disconnected: z.boolean() }),
        { method: 'DELETE' }
      )
      const next = await notificationRequest(identity, '', notificationSettingsSchema)
      setSettings(next)
      setPolicy(next.policy)
      queryClient.setQueryData([...identity.key, 'settings'], next)
      setSaved('Slack disconnected from this workspace.')
    })
  }
  async function test(channel: 'email' | 'slack') {
    await perform(`test-${channel}`, async () => {
      const result = await notificationRequest(
        identity,
        '/test',
        z.object({ deliveryId: z.string() }),
        { method: 'POST', body: { channel, key: crypto.randomUUID() } }
      )
      setTestUntil((current) => ({ ...current, [channel]: Date.now() + 60_000 }))
      setTestDelivery(result.deliveryId)
      setSaved('Test queued. Its status appears below.')
      await queryClient.invalidateQueries({ queryKey: [...identity.key, 'deliveries'] })
    })
  }
  const groups = [...new Set(settings.catalogue.map((event) => event.group))]
  const selected = settings.connections.find(
    (connection) => connection.id === policy.slackConnectionId
  )
  return (
    <div className="flex flex-col gap-10">
      <p className="text-sm text-muted-foreground">
        Choose the activity you receive in this workspace. Authentication, invitations, and required
        security messages keep their own delivery rules.
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {testDelivery ? <TestDeliveryStatus identity={identity} id={testDelivery} /> : null}
      {saved ? (
        <p role="status" className="rounded-lg border border-emerald-500/30 p-4 text-sm">
          {saved}
        </p>
      ) : null}

      <Section
        title="Email"
        description="Your switch for activity email, in every workspace you belong to."
      >
        <EmailSwitch />
      </Section>

      <Section
        title="Your preferences"
        description="Workspace policy is the limit for every delivery. These settings affect only you."
      >
        <Group>
          {groups.map((group) => (
            <details
              className="border-b border-border last:border-0"
              key={group}
              open={group === 'reviews'}
            >
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium capitalize">
                {group}
              </summary>
              <div className="overflow-x-auto px-5 pb-4">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="pb-3 font-medium">
                        Activity
                      </th>
                      <th scope="col" className="px-3 pb-3 font-medium">
                        In-app
                      </th>
                      <th scope="col" className="px-3 pb-3 font-medium">
                        Email
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.catalogue
                      .filter((event) => event.group === group)
                      .map((event) => (
                        <tr className="border-t border-border" key={event.id}>
                          <th scope="row" className="py-3 pr-4 font-normal">
                            {event.label}
                          </th>
                          {(['inApp', 'email'] as const).map((channel) => {
                            const reason =
                              settings.effective[event.id]?.[
                                channel === 'inApp' ? 'in_app' : channel
                              ]?.reason
                            return (
                              <td className="px-3 py-3" key={channel}>
                                <label className="flex items-center gap-2">
                                  <Checkbox
                                    aria-label={`${event.label}: your ${channel === 'inApp' ? 'in-app' : 'email'} preference`}
                                    checked={preferences.events[event.id]?.[channel] ?? true}
                                    onCheckedChange={(checked) =>
                                      setPreferences((current) => ({
                                        ...current,
                                        events: {
                                          ...current.events,
                                          [event.id]: {
                                            ...current.events[event.id],
                                            [channel]: checked === true,
                                          },
                                        },
                                      }))
                                    }
                                  />
                                  <span className="sr-only">{channel}</span>
                                </label>
                                {reason ? (
                                  <p className="mt-1 max-w-44 text-xs text-muted-foreground">
                                    {reason}
                                  </p>
                                ) : null}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </Group>
        <p className="mt-3 text-sm text-muted-foreground">
          Slack direct messages are not available: the Shots Slack app does not ask for the im:write
          permission. Workspace activity can still go to a Slack channel.
        </p>
        <div className="mt-6">
          <SocialSetNotifications
            disabled={!!busy}
            onChange={(socialSets) => setPreferences((current) => ({ ...current, socialSets }))}
            value={preferences.socialSets ?? {}}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled={!!busy} onClick={() => void save('preferences')}>
            {busy === 'preferences' ? 'Saving…' : 'Save my preferences'}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy || !settings.emailAvailable || !!testUntil.email}
            onClick={() => void test('email')}
          >
            Send test to my email
          </Button>
        </div>
        {!settings.emailAvailable ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Email is unavailable until an administrator configures delivery.
          </p>
        ) : null}
      </Section>

      {settings.canManage ? (
        <>
          <Section
            title="Slack destination"
            description="A shared channel receives only the activity categories permitted for Slack. Private activity stays with its recipients."
          >
            <Group>
              <div className="flex flex-col gap-4 p-5">
                {!settings.slackAvailable ? (
                  <p className="text-sm text-muted-foreground">
                    Slack is not configured. Ask the server administrator to configure the Slack app
                    and callback URL.
                  </p>
                ) : null}
                {settings.connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Slack workspace is connected.</p>
                ) : null}
                <label className="grid gap-2 text-sm">
                  Slack workspace
                  <Select
                    value={policy.slackConnectionId}
                    onValueChange={(slackConnectionId) =>
                      setPolicy((current) => ({
                        ...current,
                        slackConnectionId,
                        slackChannelId: '',
                        slackChannelName: '',
                      }))
                    }
                  >
                    <SelectTrigger aria-label="Slack workspace" className="w-full">
                      <SelectValue placeholder="Select a connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.connections.map((connection) => (
                        <SelectItem key={connection.id} value={connection.id}>
                          {connection.teamName} · {connection.teamId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {selected ? (
                  <p className="text-xs text-muted-foreground">
                    App {selected.appId} ·{' '}
                    {selected.health === 'CONNECTED' ? 'Connected' : 'Reconnect required'}
                  </p>
                ) : null}
                <label className="grid gap-2 text-sm">
                  Channel
                  <Select
                    disabled={!policy.slackConnectionId || channels.isPending}
                    value={policy.slackChannelId}
                    onValueChange={(slackChannelId) =>
                      setPolicy((current) => ({ ...current, slackChannelId }))
                    }
                  >
                    <SelectTrigger aria-label="Slack channel" className="w-full">
                      <SelectValue placeholder="Select a channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.data?.map((channel) => (
                        <SelectItem
                          key={channel.id}
                          value={channel.id}
                          disabled={!channel.isMember || channel.isArchived}
                        >
                          {channel.isPrivate ? 'Private: ' : '#'}
                          {channel.name}
                          {!channel.isMember ? ' — invite the app first' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {policy.slackConnectionId && channels.isPending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading Slack channels…
                  </p>
                ) : null}
                {channels.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {channels.error.message}
                  </p>
                ) : null}
                {channels.data?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No available channels. Invite the Slack app to a channel, then refresh.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!!busy || !settings.slackAvailable}
                    onClick={() => void connect()}
                  >
                    {selected ? 'Reconnect Slack' : 'Connect Slack'}
                  </Button>
                  {selected ? (
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => void disconnect(selected.id)}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    disabled={!policy.slackConnectionId || channels.isFetching}
                    onClick={() => void channels.refetch()}
                  >
                    Refresh channels
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Invite the app to private channels. Save the workspace policy before testing a new
                  destination.
                </p>
                <Button
                  variant="outline"
                  disabled={!!busy || !settings.policy.slackChannelId || !!testUntil.slack}
                  onClick={() => void test('slack')}
                >
                  Send test to selected channel
                </Button>
              </div>
            </Group>
          </Section>
          <Section
            title="Workspace policy"
            description="Owners and administrators choose which categories each channel can deliver. New email categories and Slack streams start disabled."
          >
            <fieldset className="mb-4 flex flex-wrap gap-5" disabled={!!busy}>
              <legend className="mb-3 text-sm font-medium">Available channels</legend>
              {(['inApp', 'email', 'slack'] as const).map((channel) => (
                <label key={channel} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={policy.availability[channel]}
                    onCheckedChange={(checked) =>
                      setPolicy((current) => ({
                        ...current,
                        availability: { ...current.availability, [channel]: checked === true },
                      }))
                    }
                  />
                  {channel === 'inApp' ? 'In-app' : channel === 'email' ? 'Email' : 'Slack'}
                </label>
              ))}
            </fieldset>
            <Group>
              {groups.map((group) => (
                <details
                  className="border-b border-border last:border-0"
                  key={group}
                  open={group === 'reviews'}
                >
                  <summary className="cursor-pointer px-5 py-4 text-sm font-medium capitalize">
                    {group}
                  </summary>
                  <div className="overflow-x-auto px-5 pb-4">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          <th scope="col" className="pb-3 font-medium">
                            Activity
                          </th>
                          {['In-app', 'Email', 'Slack'].map((channel) => (
                            <th scope="col" className="px-3 pb-3 font-medium" key={channel}>
                              {channel}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {settings.catalogue
                          .filter((event) => event.group === group)
                          .map((event) => (
                            <tr className="border-t border-border" key={event.id}>
                              <th scope="row" className="py-3 pr-4 font-normal">
                                {event.label}
                                {event.restricted ? (
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    Private to recipients
                                  </span>
                                ) : null}
                              </th>
                              {(['inApp', 'email', 'slack'] as const).map((channel) => (
                                <td className="px-3 py-3" key={channel}>
                                  <Checkbox
                                    aria-label={`${event.label}: workspace ${channel === 'inApp' ? 'in-app' : channel}`}
                                    disabled={
                                      !!busy ||
                                      !policy.availability[channel] ||
                                      (channel === 'slack' && event.restricted)
                                    }
                                    checked={policy.events[event.id]?.[channel] ?? false}
                                    onCheckedChange={(checked) =>
                                      setPolicy((current) => ({
                                        ...current,
                                        events: {
                                          ...current.events,
                                          [event.id]: {
                                            ...current.events[event.id],
                                            [channel]: checked === true,
                                          },
                                        },
                                      }))
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </Group>
            <Button className="mt-4" disabled={!!busy} onClick={() => void save('policy')}>
              {busy === 'policy' ? 'Saving…' : 'Save workspace policy'}
            </Button>
          </Section>
          <Section
            title="Delivery status"
            description="Review failures and reconcile uncertain sends. Confirm delivery only after checking the destination."
          >
            {deliveries.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading deliveries…
              </p>
            ) : deliveries.error ? (
              <p role="alert" className="text-sm text-destructive">
                {deliveries.error.message}
              </p>
            ) : deliveries.data?.deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No external deliveries yet.</p>
            ) : (
              <Group>
                {deliveries.data?.deliveries.map((delivery) => (
                  <div className="border-b border-border p-5 last:border-0" key={delivery.id}>
                    <p className="text-sm font-medium">
                      {settings.catalogue.find((event) => event.id === delivery.kind)?.label ??
                        'Test notification'}{' '}
                      · {delivery.channel}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {delivery.status.toLowerCase()}
                      {delivery.failureCode
                        ? ` · ${delivery.failureCode.toLowerCase().replaceAll('_', ' ')}`
                        : ''}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      Reference: {delivery.id}
                    </p>
                    {['BLOCKED', 'UNCERTAIN', 'DEAD'].includes(delivery.status) ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(['retry', 'confirm_delivered', 'dismiss'] as const).map((action) => (
                          <Button
                            variant="outline"
                            size="sm"
                            key={action}
                            disabled={!!busy}
                            onClick={() =>
                              void perform(delivery.id, async () => {
                                await notificationRequest(
                                  identity,
                                  `/deliveries/${encodeURIComponent(delivery.id)}/recover`,
                                  z.object({ recovered: z.boolean() }),
                                  { method: 'POST', body: { action } }
                                )
                                await deliveries.refetch()
                                setSaved('Delivery recovery recorded.')
                              })
                            }
                          >
                            {action === 'retry'
                              ? 'Retry safely'
                              : action === 'confirm_delivered'
                                ? 'Confirm delivered'
                                : 'Dismiss'}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </Group>
            )}
          </Section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Owners and administrators manage workspace channels and Slack connections.
        </p>
      )}
    </div>
  )
}

/** Workspace activity policy and personal preferences use the existing settings surface. */
export function WorkspaceNotifications() {
  const identity = useNotificationIdentity()
  const settings = useQuery({
    queryKey: [...identity.key, 'settings'],
    queryFn: ({ signal }) =>
      notificationRequest(identity, '', notificationSettingsSchema, { signal }),
    enabled: identity.ready,
    refetchOnWindowFocus: false,
  })
  if (!identity.ready || settings.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading notification settings…
      </p>
    )
  if (settings.error)
    return (
      <div role="alert">
        <p className="text-sm text-destructive">{settings.error.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => void settings.refetch()}>
          Retry
        </Button>
      </div>
    )
  return (
    <SettingsForm
      key={`${identity.userId}:${identity.workspaceId}`}
      initial={settings.data}
      identity={identity}
    />
  )
}

function TestDeliveryStatus({
  identity,
  id,
}: {
  identity: ReturnType<typeof useNotificationIdentity>
  id: string
}) {
  const visible = useNotificationPageVisible()
  const status = useQuery({
    queryKey: [...identity.key, 'delivery', id],
    queryFn: ({ signal }) =>
      notificationRequest(
        identity,
        `/deliveries/${encodeURIComponent(id)}`,
        notificationDeliverySchema,
        { signal }
      ),
    refetchInterval: (query) =>
      visible && (!query.state.data || ['PENDING', 'CLAIMED'].includes(query.state.data.status))
        ? 3000
        : false,
    refetchIntervalInBackground: false,
  })
  if (status.error)
    return (
      <p role="alert">
        Could not check the test.{' '}
        <button type="button" onClick={() => void status.refetch()}>
          Retry status check
        </button>
      </p>
    )
  const result = status.data
  return (
    <p role="status" className="text-sm">
      {!result || ['PENDING', 'CLAIMED'].includes(result.status)
        ? 'Waiting for test delivery…'
        : result.status === 'SUCCEEDED'
          ? 'Test delivered.'
          : `Test ${result.status.toLowerCase()}: ${result.failureCode.replaceAll('_', ' ').toLowerCase()}.`}{' '}
      <span className="block text-xs text-muted-foreground">Reference: {id}</span>
    </p>
  )
}
