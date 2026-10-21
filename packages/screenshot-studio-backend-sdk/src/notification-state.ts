import { z } from 'zod'

/** Recipient feeds; all preserves the original combined inbox endpoint. */
export const notificationViewSchema = z.enum(['inbox', 'activity', 'archive', 'all'])
/** Persistent receipt state belongs to one member and workspace. */
export const notificationItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  category: z.enum(['inbox', 'activity']),
  description: z.string(),
  href: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
})
/** Reading a cursor page never acknowledges its receipts. */
export const notificationPageSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string(),
  unseenCount: z.number().int().nonnegative(),
})
/** Mutations bind a retry key to the action, selected feed and receipt IDs. */
export const notificationStateInputSchema = z
  .strictObject({
    action: z.enum(['read', 'unread', 'archive', 'restore']),
    view: notificationViewSchema,
    ids: z.array(z.string().min(1).max(128)).max(100).default([]),
    all: z.boolean().default(false),
    key: z.string().min(16).max(128),
  })
  .refine((value) => (value.all ? value.ids.length === 0 : value.ids.length > 0), {
    message: 'Choose receipt IDs or all items in this feed.',
  })
/** Counts are returned only after the backend commits recipient state. */
export const notificationStateResultSchema = z.object({
  changed: z.number().int().nonnegative(),
  unseenCount: z.number().int().nonnegative(),
})
/** A recipient feed filter. */
export type NotificationView = z.infer<typeof notificationViewSchema>
/** A recipient receipt. */
export type NotificationItem = z.infer<typeof notificationItemSchema>
/** A cursor page. */
export type NotificationPage = z.infer<typeof notificationPageSchema>
/** A validated recipient mutation. */
export type NotificationStateInput = z.infer<typeof notificationStateInputSchema>
/** A committed recipient mutation result. */
export type NotificationStateResult = z.infer<typeof notificationStateResultSchema>
