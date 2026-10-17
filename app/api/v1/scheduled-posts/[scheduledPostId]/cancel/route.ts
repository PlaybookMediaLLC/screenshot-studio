import { cancelScheduledPostContract } from '@/lib/api/contracts/scheduled-posts'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { cancelBackendScheduledPost } from '@/lib/tenant/publishing-backend'

/** Cancel a post that has not started publishing; repeating it is safe. */
export const POST = route(cancelScheduledPostContract, {
  auth: memberAccess(cancelScheduledPostContract.access),
  handler: async ({ access, params }) => cancelBackendScheduledPost(access, params.scheduledPostId),
})
