import {
  mutateCalendarContract,
  calendarResultSchema,
  type CalendarResultWire,
} from '@/lib/api/contracts/plan-analyze'
import { route, errorResponse } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** mutateCalendarContract: authenticated, workspace-scoped backend operation. */
export const POST = route(mutateCalendarContract, {
  auth: memberAccess(mutateCalendarContract.access),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content workspace is unavailable.')
    return calendarResultSchema.encode(
      (await backendSDK(access).mutateCalendar(body)) as CalendarResultWire
    )
  },
})
