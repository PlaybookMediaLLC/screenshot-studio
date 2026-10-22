'use client'

import { NotificationFeed } from '@/components/notifications/NotificationFeed'
import { useNotificationIdentity } from '@/lib/notifications/client'

/** Reuse the authorized, paginated inbox and its current-access resolver. */
export function NeedsAttention() {
  const identity = useNotificationIdentity()
  if (!identity.ready) return null
  return (
    <section aria-label="Needs attention" className="space-y-3">
      <h2 className="text-lg font-medium">Needs attention</h2>
      <p className="text-sm text-muted-foreground">
        Your workspace inbox. Open an update to review its current state.
      </p>
      <div className="flex max-h-80 flex-col overflow-hidden rounded-xl border">
        <NotificationFeed identity={identity} view="inbox" close={() => {}} />
      </div>
    </section>
  )
}
