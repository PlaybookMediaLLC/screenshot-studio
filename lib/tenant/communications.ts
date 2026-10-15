import 'server-only'

import { randomUUID } from 'node:crypto'
import { backendSDK } from '@/lib/backend/sdk'

// Announcement delivery runs in services/internal/maintenance. This module
// retains the public unsubscribe operation used by the web application.

/**
 * Record an explicit opt-out for a verified unsubscribe claim.
 *
 * Idempotent: unsubscribing twice keeps the original timestamp, so the
 * one-click endpoint can be retried by mail clients without churn. The
 * caller has no session, so the backend acts as a service for the
 * claim's workspace, named by the address in the audit log.
 */
export async function unsubscribeAudienceMember(input: {
  email: string
  organizationId: string
}): Promise<boolean> {
  await backendSDK({
    organizationId: input.organizationId,
    principal: {
      kind: 'trigger_service',
      organizationId: input.organizationId,
      taskRunId: input.email,
    },
    requestId: randomUUID(),
  }).unsubscribeAudienceMember(input.email)

  // Report success even when nothing changed: the caller asked to be
  // unsubscribed and they are, which is what the endpoint must confirm.
  return true
}
