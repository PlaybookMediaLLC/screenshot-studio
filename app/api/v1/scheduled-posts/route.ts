import {
  createScheduledPostContract,
  listScheduledPostsContract,
} from '@/lib/api/contracts/scheduled-posts'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import {
  createBackendScheduledPost,
  listBackendScheduledPosts,
} from '@/lib/tenant/publishing-backend'
import { getScheduledPostIdempotencyKey } from '@/lib/tenant/scheduled-posts'

/** The workspace publishing schedule, newest first. */
export const GET = route(listScheduledPostsContract, {
  auth: memberAccess(listScheduledPostsContract.access),
  handler: async ({ access, query }) => {
    const data = await listBackendScheduledPosts(access, query.limit)
    return { data, pagination: { hasMore: data.length === query.limit, nextCursor: null } }
  },
})

/** Schedule an approved variant. Replaying an `Idempotency-Key` returns the original with 200. */
export const POST = route(createScheduledPostContract, {
  auth: memberAccess(createScheduledPostContract.access),
  handler: async ({ access, body, headers }) =>
    createBackendScheduledPost(access, {
      ...body,
      idempotencyKey: getScheduledPostIdempotencyKey(headers['idempotency-key'] || null),
    }),
  status: (result) => (result.created ? 201 : 200),
})
