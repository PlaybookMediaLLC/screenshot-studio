'use client'

import { NotificationFeed } from '@/components/notifications/NotificationFeed'
import { useNotificationIdentity } from '@/lib/notifications/client'

/** Reuse the authorized, paginated inbox and its current-access resolver. */
export function NeedsAttention() {
  const identity = useNotificationIdentity()
  if (!identity.ready) return null
  return (
    <section aria-label="Needs attention" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Needs attention</h2>
        <p className="mt-1 text-xs text-muted-foreground">The updates that need your next move.</p>
      </div>
      <div className="flex min-h-52 max-h-80 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/50">
        <NotificationFeed identity={identity} view="inbox" close={() => {}} />
      </div>
    </section>
  )
}
