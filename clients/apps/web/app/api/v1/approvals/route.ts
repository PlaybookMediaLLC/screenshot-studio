import { listApprovalsContract } from '@/lib/api/contracts/approvals'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { listPendingApprovals } from '@/lib/tenant/campaigns'

/** The review queue, oldest post first. */
export const GET = route(listApprovalsContract, {
  auth: tenantAccess(listApprovalsContract.access),
  handler: async ({ access, query }) => {
    const page = await listPendingApprovals(access, query)
    return {
      data: page.items,
      pagination: { hasMore: page.nextCursor !== null, nextCursor: page.nextCursor },
    }
  },
})
