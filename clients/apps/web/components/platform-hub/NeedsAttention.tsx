'use client'

import { NotificationFeed } from '@/components/notifications/NotificationFeed'
import { useNotificationIdentity } from '@/lib/notifications/client'

/** Reuse the authorized, paginated inbox and its current-access resolver. */
export function NeedsAttention() {
  const identity = useNotificationIdentity()
  if (!identity.ready) return null
  return (
    <section aria-label="Needs attention" className="home-attention space-y-4">
      <div>
        <h2 className="text-lg font-normal tracking-[-0.01em]">Needs attention</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Comments, reviews, and workspace updates.
        </p>
      </div>
      <div className="home-notifications">
        <NotificationFeed identity={identity} view="inbox" close={() => {}} />
      </div>
    </section>
  )
}
