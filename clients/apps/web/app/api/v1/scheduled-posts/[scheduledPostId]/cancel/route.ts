import { cancelScheduledPostContract } from '@/lib/api/contracts/scheduled-posts'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { cancelBackendScheduledPost } from '@/lib/tenant/publishing-backend'

/** Cancel a post that has not started publishing; repeating it is safe. */
export const POST = route(cancelScheduledPostContract, {
  auth: tenantAccess(cancelScheduledPostContract.access),
  handler: async ({ access, params }) => cancelBackendScheduledPost(access, params.scheduledPostId),
})
