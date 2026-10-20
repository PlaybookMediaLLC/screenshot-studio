import { z } from 'zod'

/** Delivery channels permitted by a workspace or selected by a member. */
export const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  slack: z.boolean(),
})
/** A workspace's policy, including its verified Slack destination. */
export const notificationPolicySchema = z.object({
  availability: notificationChannelsSchema,
  events: z.record(z.string(), notificationChannelsSchema),
  generation: z.number().int().positive(),
  slackConnectionId: z.string(),
  slackChannelId: z.string(),
  slackChannelName: z.string(),
})
/** Preferences always belong to the authenticated member. */
export const notificationPreferencesSchema = z.object({
  events: z.record(z.string(), notificationChannelsSchema),
  generation: z.number().int().positive(),
  /** Kinds turned off for one social set: set ID, then kind, false for off. */
  socialSets: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
})
/** Provider identity and health without credentials. */
export const notificationConnectionSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  teamName: z.string(),
  appId: z.string(),
  health: z.string(),
  scopes: z.array(z.string()),
})
/** The event catalogue and effective configuration returned by the backend. */
export const notificationSettingsSchema = z.object({
  catalogue: z.array(
    z.object({
      emitter: z.string(),
      accessCheck: z.string(),
      sensitivity: z.string(),
      channels: z.array(z.string()),
      description: z.string(),
      destination: z.string(),
      id: z.string(),
      label: z.string(),
      group: z.string(),
      audience: z.string(),
      restricted: z.boolean(),
      emailDefault: z.boolean(),
    })
  ),
  policy: notificationPolicySchema,
  preferences: notificationPreferencesSchema,
  canManage: z.boolean(),
  emailAvailable: z.boolean(),
  slackAvailable: z.boolean(),
  connections: z.array(notificationConnectionSchema),
  effective: z.record(
    z.string(),
    z.record(z.string(), z.object({ enabled: z.boolean(), reason: z.string() }))
  ),
})
/** An unseen recipient row; acknowledging it removes it from storage. */
export const notificationItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  description: z.string(),
  href: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  createdAt: z.string(),
})
/** Read-only, cursor-paginated inbox. */
export const notificationPageSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string(),
  unseenCount: z.number().int().nonnegative(),
})
/** Acknowledgment confirmation. */
export const notificationSeenSchema = z.object({
  deleted: z.number().int().nonnegative(),
  unseenCount: z.number().int().nonnegative(),
})
/** One page of Slack channels, including empty pages with a continuation cursor. */
export const notificationSlackChannelsSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isPrivate: z.boolean(),
      isMember: z.boolean(),
      isArchived: z.boolean(),
    })
  ),
  nextCursor: z.string(),
})
/** Content-free delivery metadata for authorized recovery. */
export const notificationDeliverySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  eventId: z.string(),
  kind: z.string(),
  channel: z.string(),
  destination: z.string(),
  status: z.enum(['PENDING', 'CLAIMED', 'SUCCEEDED', 'SKIPPED', 'BLOCKED', 'UNCERTAIN', 'DEAD']),
  failureCode: z.string(),
  providerReceipt: z.string(),
  attempts: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
/** A rendered recipient row. */
export type NotificationItem = z.infer<typeof notificationItemSchema>
/** The current workspace and member configuration. */
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
/** An immutable delivery receipt or pending job. */
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>
