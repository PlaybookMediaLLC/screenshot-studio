import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import {
  notificationSettingsSchema,
  notificationPolicySchema,
  notificationPreferencesSchema,
  notificationPageSchema,
  notificationViewSchema,
  notificationStateInputSchema,
  notificationStateResultSchema,
  notificationSeenSchema,
  notificationConnectionSchema,
  notificationSlackChannelsSchema,
  notificationDeliverySchema,
} from '@/lib/notifications/schema'

/** `GET /api/workspace/notifications`: session-scoped workspace activity. */
export const getNotificationSettingsContract = defineContract({
  method: 'GET',
  name: 'notifications.getnotificationsettings',
  path: '/api/workspace/notifications',
  summary: 'getNotificationSettings',
  shell: true,
  output: notificationSettingsSchema,
})

/** `PUT /api/workspace/notifications/policy`: session-scoped workspace activity. */
export const saveNotificationPolicyContract = defineContract({
  method: 'PUT',
  name: 'notifications.savenotificationpolicy',
  path: '/api/workspace/notifications/policy',
  summary: 'saveNotificationPolicy',
  shell: true,
  output: notificationSettingsSchema,
  body: notificationPolicySchema,
})

/** `PUT /api/workspace/notifications/preferences`: session-scoped workspace activity. */
export const saveNotificationPreferencesContract = defineContract({
  method: 'PUT',
  name: 'notifications.savenotificationpreferences',
  path: '/api/workspace/notifications/preferences',
  summary: 'saveNotificationPreferences',
  shell: true,
  output: notificationSettingsSchema,
  body: notificationPreferencesSchema,
})

/** `GET /api/workspace/notifications/inbox`: session-scoped workspace activity. */
export const getNotificationInboxContract = defineContract({
  method: 'GET',
  name: 'notifications.getnotificationinbox',
  path: '/api/workspace/notifications/inbox',
  summary: 'getNotificationInbox',
  shell: true,
  output: notificationPageSchema,
  query: z.object({
    cursor: z.string().max(2048).default(''),
    view: notificationViewSchema.default('all'),
  }),
})

/** `GET /api/workspace/notifications/count`: session-scoped workspace activity. */
export const getNotificationCountContract = defineContract({
  method: 'GET',
  name: 'notifications.getnotificationcount',
  path: '/api/workspace/notifications/count',
  summary: 'getNotificationCount',
  shell: true,
  output: z.object({ unseenCount: z.number().int().nonnegative() }),
})

/** `POST /api/workspace/notifications/seen`: session-scoped workspace activity. */
export const acknowledgeNotificationsContract = defineContract({
  method: 'POST',
  name: 'notifications.acknowledgenotifications',
  path: '/api/workspace/notifications/seen',
  summary: 'acknowledgeNotifications',
  shell: true,
  output: notificationSeenSchema,
  body: z.strictObject({
    ids: z.array(z.string().min(1).max(128)).max(100).optional(),
    all: z.boolean().optional(),
    key: z.string().min(16).max(128).optional(),
  }),
})

/** `GET /api/workspace/notifications/resolve/{id}`: session-scoped workspace activity. */
export const resolveNotificationContract = defineContract({
  method: 'GET',
  name: 'notifications.resolvenotification',
  path: '/api/workspace/notifications/resolve/{id}',
  summary: 'resolveNotification',
  shell: true,
  output: z.object({ href: z.string() }),
  params: z.object({ id: z.string().min(1).max(128) }),
})

/** `POST /api/workspace/notifications/slack/connect`: session-scoped workspace activity. */
export const connectNotificationSlackContract = defineContract({
  method: 'POST',
  name: 'notifications.connectnotificationslack',
  path: '/api/workspace/notifications/slack/connect',
  summary: 'connectNotificationSlack',
  shell: true,
  output: z.object({ url: z.string().url() }),
  body: z.strictObject({
    purpose: z.enum(['notifications', 'design', 'publishing', 'personal']).default('notifications'),
    connectionId: z.string().min(1).max(128).optional(),
  }),
})

/** `POST /api/workspace/notifications/slack/callback`: session-scoped workspace activity. */
export const completeNotificationSlackContract = defineContract({
  method: 'POST',
  name: 'notifications.completenotificationslack',
  path: '/api/workspace/notifications/slack/callback',
  summary: 'completeNotificationSlack',
  shell: true,
  output: notificationConnectionSchema,
  body: z.strictObject({ state: z.string().length(43), code: z.string().min(1).max(4096) }),
})

/** `GET /api/workspace/notifications/slack/channels`: session-scoped workspace activity. */
export const getNotificationSlackChannelsContract = defineContract({
  method: 'GET',
  name: 'notifications.getnotificationslackchannels',
  path: '/api/workspace/notifications/slack/channels',
  summary: 'getNotificationSlackChannels',
  shell: true,
  output: notificationSlackChannelsSchema,
  query: z.object({
    connectionId: z.string().min(1).max(128),
    cursor: z.string().max(2048).default(''),
  }),
})

/** `DELETE /api/workspace/notifications/slack/{id}`: session-scoped workspace activity. */
export const disconnectNotificationSlackContract = defineContract({
  method: 'DELETE',
  name: 'notifications.disconnectnotificationslack',
  path: '/api/workspace/notifications/slack/{id}',
  summary: 'disconnectNotificationSlack',
  shell: true,
  output: z.object({ disconnected: z.boolean() }),
  params: z.object({ id: z.string().min(1).max(128) }),
})

/** `POST /api/workspace/notifications/test`: session-scoped workspace activity. */
export const testNotificationContract = defineContract({
  method: 'POST',
  name: 'notifications.testnotification',
  path: '/api/workspace/notifications/test',
  summary: 'testNotification',
  shell: true,
  output: z.object({ deliveryId: z.string() }),
  body: z.strictObject({
    channel: z.enum(['email', 'slack', 'slack_dm']),
    key: z.string().min(16).max(128),
  }),
})

/** `GET /api/workspace/notifications/deliveries`: session-scoped workspace activity. */
export const getNotificationDeliveriesContract = defineContract({
  method: 'GET',
  name: 'notifications.getnotificationdeliveries',
  path: '/api/workspace/notifications/deliveries',
  summary: 'getNotificationDeliveries',
  shell: true,
  output: z.object({ deliveries: z.array(notificationDeliverySchema) }),
})

/** `POST /api/workspace/notifications/deliveries/{id}/recover`: session-scoped workspace activity. */
export const recoverNotificationDeliveryContract = defineContract({
  method: 'POST',
  name: 'notifications.recovernotificationdelivery',
  path: '/api/workspace/notifications/deliveries/{id}/recover',
  summary: 'recoverNotificationDelivery',
  shell: true,
  output: z.object({ recovered: z.boolean() }),
  body: z.strictObject({ action: z.enum(['retry', 'confirm_delivered', 'dismiss']) }),
  params: z.object({ id: z.string().min(1).max(128) }),
})

/** Inspect a delivery owned by the current member or administered by them. */
export const getNotificationDeliveryContract = defineContract({
  method: 'GET',
  name: 'notifications.delivery',
  path: '/api/workspace/notifications/deliveries/{id}',
  summary: 'Inspect notification delivery',
  shell: true,
  params: z.object({ id: z.string().min(1).max(128) }),
  output: notificationDeliverySchema,
})

/** Persist read or archive state for the authenticated recipient. */
export const changeNotificationStateContract = defineContract({
  method: 'POST',
  name: 'notifications.changestate',
  path: '/api/workspace/notifications/state',
  summary: 'Update notification read and archive state',
  shell: true,
  body: notificationStateInputSchema,
  output: notificationStateResultSchema,
})

/** Disconnect only the authenticated member's personal Slack destination. */
export const disconnectPersonalSlackContract = defineContract({
  method: 'DELETE',
  name: 'notifications.disconnectpersonalslack',
  path: '/api/workspace/notifications/slack/personal/{id}',
  summary: 'Disconnect my Slack direct messages',
  shell: true,
  output: z.object({ disconnected: z.boolean() }),
  params: z.object({ id: z.string().min(1).max(128) }),
})
