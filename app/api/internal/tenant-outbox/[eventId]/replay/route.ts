import { replayOutboxEventContract } from '@/lib/api/contracts/internal'
import { errorResponse, route } from '@/lib/api/route'
import { maintenanceAccess } from '@/lib/api/route-auth'
import { replayDeadLetteredOutboxEvent } from '@/lib/tenant/outbox'

/** Requeue a dead-lettered outbox event. Operator only. */
export const POST = route(replayOutboxEventContract, {
  auth: maintenanceAccess,
  handler: async ({ params }) =>
    (await replayDeadLetteredOutboxEvent(params.eventId))
      ? { replayed: true as const }
      : errorResponse(404, 'Dead-lettered outbox event was not found.'),
})
