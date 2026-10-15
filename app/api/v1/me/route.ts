import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireSessionAccess } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'

export const GET = createShellJsonRoute({
  name: 'me',
  execute: async (request) => {
    const access = await requireSessionAccess(request.headers)
    return backendSDK({ ...access, organizationId: '' }).getCurrentUser()
  },
})
