import {
  getUserPreferencesContract,
  updateUserPreferencesContract,
} from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Your preferences, the same in every workspace. */
export const GET = route(getUserPreferencesContract, {
  auth: organizationAccess('workspace:read'),
  handler: ({ access }) => backendSDK(access).getUserPreferences(),
})

/** Save your preferences; a stale `baseVersion` is refused with 409. */
export const PATCH = route(updateUserPreferencesContract, {
  auth: organizationAccess('workspace:read'),
  handler: ({ access, body }) => backendSDK(access).updateUserPreferences(body),
})
