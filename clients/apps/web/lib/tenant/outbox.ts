import 'server-only'

import { orNull, serviceBackend } from '@/lib/backend/sdk'

// Dispatch runs only in the Go maintenance worker (Temporal schedule
// platform-maintenance-tenant-outbox); replay hands the event back to it.
export async function replayDeadLetteredOutboxEvent(eventId: string): Promise<boolean> {
  return (await orNull(serviceBackend().replayOutboxEvent(eventId))) !== null
}
