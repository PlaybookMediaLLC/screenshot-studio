import 'server-only'
import { organizationAccess } from '@/lib/api/route-auth'
import { AuthorizationError } from '@/lib/auth/access'
import type { Permission } from '@/lib/auth/permissions'

/** Refuse an in-flight request if its browser has switched workspaces. */
export function notificationAccess(permission: Permission = 'workspace:read') {
  const authenticate = organizationAccess(permission)
  return async (input: Parameters<typeof authenticate>[0]) => {
    const access = await authenticate(input)
    const expected = input.request.headers.get('x-notification-workspace')
    if (
      (expected && expected !== access.organizationId) ||
      (input.request.headers.get('x-notification-user') &&
        input.request.headers.get('x-notification-user') !== access.principal.userId)
    ) {
      throw new AuthorizationError('Your workspace changed. Reopen notifications.', 403)
    }
    return access
  }
}
