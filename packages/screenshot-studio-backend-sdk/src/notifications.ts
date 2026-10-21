/** Per-event channel controls. */
export type NotificationChannels = { inApp: boolean; email: boolean; slack: boolean }
/** Workspace policy; generation invalidates queued work after configuration changes. */
export type NotificationPolicy = {
  availability: NotificationChannels
  events: Record<string, NotificationChannels>
  generation: number
  slackConnectionId: string
  slackChannelId: string
  slackChannelName: string
}
/** Preferences belong to the authenticated user and workspace. */
export type NotificationPreferences = {
  events: Record<string, NotificationChannels>
  generation: number
  /** Kinds turned off for one social set: set ID, then kind, false for off (RFC 043). */
  socialSets?: Record<string, Record<string, boolean>>
}
/** Slack installation metadata, never credentials. */
export type NotificationConnection = {
  id: string
  teamId: string
  teamName: string
  appId: string
  health: string
  scopes: string[]
}
/** Notification configuration and effective decisions. */
export type NotificationSettings = {
  catalogue: {
    emitter: string
    accessCheck: string
    sensitivity: string
    channels: string[]
    description: string
    destination: string
    id: string
    label: string
    group: string
    audience: string
    restricted: boolean
    emailDefault: boolean
  }[]
  policy: NotificationPolicy
  preferences: NotificationPreferences
  canManage: boolean
  emailAvailable: boolean
  slackAvailable: boolean
  connections: NotificationConnection[]
  effective: Record<string, Record<string, { enabled: boolean; reason: string }>>
}
/** A retained inbox row. */
export type NotificationItem = {
  id: string
  kind: string
  description: string
  href: string
  workspaceId: string
  workspaceName: string
  createdAt: string
  seenAt: string | null
  context?: {
    entityType: string
    entityId: string
    source: string
    name?: string
    status?: string
    message?: string
    repository?: string
    branch?: string
    tag?: string
    actorName?: string
    pullRequest?: number
    campaignName?: string
    storySetName?: string
  }
}
/** An inbox page; reading it never acknowledges rows. */
export type NotificationPage = {
  items: NotificationItem[]
  nextCursor: string
  unseenCount: number
}
/** Confirmed acknowledgment. */
export type NotificationSeen = { deleted: number; updated: number; unseenCount: number }
/** A Slack discovery page; follow nextCursor even when channels is empty. */
export type NotificationSlackChannels = {
  channels: {
    id: string
    name: string
    isPrivate: boolean
    isMember: boolean
    isArchived: boolean
  }[]
  nextCursor: string
}
/** Delivery identity and outcome metadata. */
export type NotificationDelivery = {
  id: string
  workspaceId: string
  eventId: string
  kind: string
  channel: string
  destination: string
  status: 'PENDING' | 'CLAIMED' | 'SUCCEEDED' | 'SKIPPED' | 'BLOCKED' | 'UNCERTAIN' | 'DEAD'
  failureCode: string
  providerReceipt: string
  attempts: number
  createdAt: string
  updatedAt: string
}
