'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Group, Section } from '@/components/platform-ui'
import { EmailSwitch, SocialSetNotifications } from '@/components/settings/NotificationExtras'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { useUnsavedSettings } from '@/components/settings/useUnsavedSettings'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { Button } from '@/components/ui/button'
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
  const [panel, setPanel] = useState(
    search.has('connected') || search.has('error') ? 'delivery' : 'personal'
  )
  const { preferences: personal } = usePreferences()
  const preferencesDirty = JSON.stringify(preferences) !== JSON.stringify(settings.preferences)
  const policyDirty = JSON.stringify(policy) !== JSON.stringify(settings.policy)
  useUnsavedSettings(preferencesDirty || policyDirty)
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
    if (
      policyDirty &&
      !window.confirm('Disconnect Slack and discard unsaved workspace policy changes?')
    )
      return
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
    <fieldset disabled={!!busy} className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-wrap gap-2" aria-label="Notification settings">
        {[
          ['personal', 'My notifications'],
          ...(settings.canManage
            ? [
                ['policy', 'Workspace rules'],
                ['delivery', 'Delivery & Slack'],
              ]
            : []),
        ].map(([id, label]) => (
          <Button
            key={id}
            type="button"
            aria-pressed={panel === id}
            variant={panel === id ? 'default' : 'outline'}
            onClick={() => setPanel(id!)}
          >
            {label}
            {(id === 'personal' && preferencesDirty) || (id !== 'personal' && policyDirty)
              ? ' •'
              : ''}
          </Button>
        ))}
      </div>
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

      <div hidden={panel !== 'personal'} className="space-y-8">
        <Section
          title="Email"
          description="Saves automatically. Your switch for activity email in every workspace."
        >
          <EmailSwitch />
        </Section>

        <Section
          title="Your preferences"
          description="Your selections are remembered separately from current delivery. Save changes to apply them. Workspace rules and the email switch can block delivery."
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
                              const effective =
                                settings.effective[event.id]?.[
                                  channel === 'inApp' ? 'in_app' : channel
                                ]
                              const blocked =
                                !settings.policy.availability[channel] ||
                                !settings.policy.events[event.id]?.[channel]
                              const masterOff =
                                channel === 'email' && personal?.emailNotifications === false
                              const label = channel === 'inApp' ? 'In-app' : 'Email'
                              const reason = blocked
                                ? 'Blocked by workspace policy'
                                : masterOff
                                  ? 'Off for all workspaces'
                                  : effective?.enabled
                                    ? 'On'
                                    : effective?.reason || 'Off'
                              return (
                                <td className="px-3 py-3" key={channel}>
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      className="size-4 accent-current"
                                      disabled={blocked || masterOff}
                                      aria-label={`${event.label}: your ${channel === 'inApp' ? 'in-app' : 'email'} preference`}
                                      checked={preferences.events[event.id]?.[channel] ?? true}
                                      onChange={(e) =>
                                        setPreferences((current) => ({
                                          ...current,
                                          events: {
                                            ...current.events,
                                            [event.id]: {
                                              ...current.events[event.id],
                                              [channel]: e.target.checked,
                                            },
                                          },
                                        }))
                                      }
                                    />
                                    <span className="text-xs">
                                      Your preference:{' '}
                                      {(preferences.events[event.id]?.[channel] ?? true)
                                        ? 'On'
                                        : 'Off'}
                                    </span>
                                  </label>
                                  {reason ? (
                                    <p className="mt-1 max-w-44 text-xs text-muted-foreground">
                                      Current {label.toLowerCase()} delivery: {reason}
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
          <details className="mt-3 text-sm text-muted-foreground">
            <summary className="cursor-pointer">Slack delivery details</summary>
            <p>
              Workspace activity can go to a Slack channel. Direct messages are unavailable because
              the app does not request im:write.
            </p>
          </details>
          <div className="mt-6">
            <SocialSetNotifications
              disabled={!!busy}
              onChange={(socialSets) => setPreferences((current) => ({ ...current, socialSets }))}
              value={preferences.socialSets ?? {}}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
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

        <SettingsSaveBar
          dirty={preferencesDirty}
          busy={busy === 'preferences'}
          label="Save my preferences"
          onSave={() => void save('preferences')}
          onDiscard={() => setPreferences(settings.preferences)}
        />
      </div>
      {settings.canManage ? (
        <>
          <div hidden={panel !== 'delivery'}>
            <Section
              title="Slack destination"
              description="Save workspace policy applies changes from both Workspace rules and Delivery & Slack. A shared channel receives only permitted activity; private activity stays with its recipients."
            >
              <Group>
                <div className="flex flex-col gap-4 p-5">
                  {!settings.slackAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      Slack is unavailable. Contact your administrator to enable it.
                    </p>
                  ) : null}
                  {settings.connections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No Slack workspace is connected.
                    </p>
                  ) : null}
                  <label className="grid gap-2 text-sm">
                    Slack workspace
                    <select
                      aria-label="Slack workspace"
                      className="rounded-md border border-border bg-background p-2"
                      value={policy.slackConnectionId}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          slackConnectionId: event.target.value,
                          slackChannelId: '',
                          slackChannelName: '',
                        }))
                      }
                    >
                      <option value="">Select a connection</option>
                      {settings.connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.teamName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected ? (
                    <p className="text-xs text-muted-foreground">
                      {selected.health === 'CONNECTED' ? 'Connected' : 'Reconnect required'}
                    </p>
                  ) : null}
                  <label className="grid gap-2 text-sm">
                    Channel
                    <select
                      aria-label="Slack channel"
                      className="rounded-md border border-border bg-background p-2"
                      disabled={!policy.slackConnectionId || channels.isPending}
                      value={policy.slackChannelId}
                      onChange={(event) =>
                        setPolicy((current) => ({ ...current, slackChannelId: event.target.value }))
                      }
                    >
                      <option value="">Select a channel</option>
                      {channels.data?.map((channel) => (
                        <option
                          key={channel.id}
                          value={channel.id}
                          disabled={!channel.isMember || channel.isArchived}
                        >
                          {channel.isPrivate ? 'Private: ' : '#'}
                          {channel.name}
                          {!channel.isMember ? ' — invite the app first' : ''}
                        </option>
                      ))}
                    </select>
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
                    Invite the app to private channels. Save the workspace policy before testing a
                    new destination.
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
            <SettingsSaveBar
              dirty={policyDirty}
              busy={busy === 'policy'}
              label="Save workspace policy"
              onSave={() => void save('policy')}
              onDiscard={() => setPolicy(settings.policy)}
            />
          </div>
          <div hidden={panel !== 'policy'}>
            <Section
              title="Workspace policy"
              description="Owners and administrators choose which categories each channel can deliver. New email categories and Slack streams start disabled."
            >
              <fieldset className="mb-4 flex flex-wrap gap-5" disabled={!!busy}>
                <legend className="mb-3 text-sm font-medium">Available channels</legend>
                {(['inApp', 'email', 'slack'] as const).map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-violet-500"
                      checked={policy.availability[channel]}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          availability: {
                            ...current.availability,
                            [channel]: event.target.checked,
                          },
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
                                    <input
                                      type="checkbox"
                                      className="size-4 accent-violet-500"
                                      aria-label={`${event.label}: workspace ${channel === 'inApp' ? 'in-app' : channel}`}
                                      disabled={
                                        !!busy ||
                                        !policy.availability[channel] ||
                                        (channel === 'slack' && event.restricted)
                                      }
                                      checked={policy.events[event.id]?.[channel] ?? false}
                                      onChange={(e) =>
                                        setPolicy((current) => ({
                                          ...current,
                                          events: {
                                            ...current.events,
                                            [event.id]: {
                                              ...current.events[event.id],
                                              [channel]: e.target.checked,
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
              <SettingsSaveBar
                dirty={policyDirty}
                busy={busy === 'policy'}
                label="Save workspace policy"
                onSave={() => void save('policy')}
                onDiscard={() => setPolicy(settings.policy)}
              />
            </Section>
          </div>
          <div hidden={panel !== 'delivery'}>
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
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Owners and administrators manage workspace channels and Slack connections.
        </p>
      )}
    </fieldset>
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
