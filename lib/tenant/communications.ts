import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor, type TriggerServicePrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'

// Announcement delivery runs in services/internal/maintenance. This module
// retains the public unsubscribe operation used by the web application.
function getTriggerPrincipal(
  organizationId: string,
  communicationId: string
): TriggerServicePrincipal {
  return { kind: 'trigger_service', organizationId, taskRunId: communicationId }
}

/**
 * Record an explicit opt-out.
 *
 * Idempotent: unsubscribing twice keeps the original timestamp, so the
 * one-click endpoint can be retried by mail clients without churn.
 */
export async function unsubscribeAudienceMember(input: {
  email: string
  organizationId: string
}): Promise<boolean> {
  const updated = await prisma.audienceSubscriber.updateMany({
    data: { unsubscribedAt: new Date() },
    where: { email: input.email, organizationId: input.organizationId, unsubscribedAt: null },
  })

  if (updated.count > 0) {
    await appendAuditLog(prisma, {
      action: 'audience.unsubscribed',
      actor: getAuditActor(getTriggerPrincipal(input.organizationId, input.email)),
      entityId: input.email,
      entityType: 'audience_subscriber',
      organizationId: input.organizationId,
      requestId: input.email,
    })
  }

  // Report success even when nothing changed: the caller asked to be
  // unsubscribed and they are, which is what the endpoint must confirm.
  return true
}
