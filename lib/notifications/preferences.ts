import type { NotificationSettings } from './schema'

type Preferences = NotificationSettings['preferences']
type Channel = keyof Preferences['events'][string]

/** Channels selected independently for each member and social set. */
export const preferenceChannels = [
  { id: 'inApp', label: 'In-app' },
  { id: 'email', label: 'Email' },
  { id: 'slack', label: 'Slack DM' },
] as const

/** Publishing defaults that can be overridden for a particular social set. */
export const socialSetPreferenceEvents = [
  { id: 'post.published', label: 'Post published' },
  { id: 'post.auto_repost_published', label: 'Auto-retweet published' },
  { id: 'post.auto_plug_published', label: 'Auto-plug published' },
  { id: 'post.publish_failed', label: 'Publishing needs attention' },
] as const

/** Legacy all-channel opt-outs take precedence until explicitly edited. */
export function preferenceSelected(p: Preferences, kind: string, channel: Channel, setId?: string) {
  if (setId && p.socialSets?.[setId]?.[kind] === false) return false
  return (
    (setId ? p.socialSetChannels?.[setId]?.[kind]?.[channel] : undefined) ??
    p.events[kind]?.[channel] ??
    channel !== 'slack'
  )
}

/** A mixed or empty group selects all on the next click; a checked group clears all. */
export function preferenceGroupState(values: boolean[]): boolean | 'indeterminate' {
  const selected = values.filter(Boolean).length
  return selected === 0 ? false : selected === values.length ? true : 'indeterminate'
}

/** Updates one channel without re-enabling other channels from a legacy opt-out. */
export function changePreferences(
  p: Preferences,
  kinds: readonly string[],
  channel: Channel,
  checked: boolean,
  setId?: string
): Preferences {
  if (!setId) {
    const events = { ...p.events }
    for (const kind of kinds) {
      events[kind] = {
        ...(events[kind] ?? { inApp: true, email: true, slack: false }),
        [channel]: checked,
      }
    }
    return { ...p, events }
  }
  const legacy = { ...p.socialSets?.[setId] }
  const channels = { ...p.socialSetChannels?.[setId] }
  for (const kind of kinds) {
    channels[kind] = {
      ...(legacy[kind] === false ? { inApp: false, email: false, slack: false } : channels[kind]),
      [channel]: checked,
    }
    delete legacy[kind]
  }
  return {
    ...p,
    socialSets: { ...p.socialSets, [setId]: legacy },
    socialSetChannels: { ...p.socialSetChannels, [setId]: channels },
  }
}

/** Delivery remains subject to workspace policy, the email master, and provider health. */
export function preferenceDeliveryReason(
  settings: NotificationSettings,
  emailEnabled: boolean,
  kind: string,
  channel: Channel,
  selected: boolean
) {
  if (
    !settings.policy.availability[channel] ||
    (channel !== 'slack' && !settings.policy.events[kind]?.[channel])
  )
    return 'Blocked by workspace policy'
  if (channel === 'email' && !emailEnabled) return 'Email off for all workspaces'
  if (channel === 'email' && !settings.emailAvailable) return 'Email delivery unavailable'
  if (channel === 'slack' && !settings.slackAvailable) return 'Slack unavailable'
  if (channel === 'slack' && !settings.personalSlack) return 'Connect your Slack account'
  if (channel === 'slack' && settings.personalSlack?.health !== 'CONNECTED')
    return 'Reconnect your Slack account'
  return selected ? 'On' : 'Off'
}
