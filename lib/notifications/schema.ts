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
  slackUserId: z.string().optional(),
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
  personalSlack: notificationConnectionSchema.nullable().optional(),
  effective: z.record(
    z.string(),
    z.record(z.string(), z.object({ enabled: z.boolean(), reason: z.string() }))
  ),
})
/** Shared receipt contracts used by both the SDK and web facade. */
export {
  notificationItemSchema,
  notificationPageSchema,
  notificationViewSchema,
  notificationStateInputSchema,
  notificationStateResultSchema,
} from 'screenshot-studio-backend-sdk'
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
export type {
  NotificationItem,
  NotificationView,
  NotificationStateInput,
} from 'screenshot-studio-backend-sdk'
/** The current workspace and member configuration. */
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
/** An immutable delivery receipt or pending job. */
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>
