import type { NotificationItem } from './schema'

/** A specific title when the authorized resource supplies a display name. */
export function notificationTitle(item: NotificationItem) {
  return item.context?.name ? `${item.description} — ${item.context.name}` : item.description
}

/** Calendar-day sections and similar events for the same named resource, within the loaded pages. */
export function groupNotifications(items: NotificationItem[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  return ['Today', 'Yesterday', 'Earlier']
    .map((label) => {
      const batches = new Map<string, { key: string; items: NotificationItem[] }>()
      for (const item of items) {
        const at = new Date(item.createdAt)
        const section = at >= today ? 'Today' : at >= yesterday ? 'Yesterday' : 'Earlier'
        if (section !== label) continue
        const key = JSON.stringify([
          item.kind,
          item.context?.entityType,
          item.context?.name || item.context?.entityId || item.id,
          item.context?.repository,
          item.context?.branch,
          item.context?.status,
        ])
        const batch = batches.get(key) ?? { key, items: [] }
        batch.items.push(item)
        batches.set(key, batch)
      }
      return { label, batches: [...batches.values()] }
    })
    .filter((group) => group.batches.length)
}
