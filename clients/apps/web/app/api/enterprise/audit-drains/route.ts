import { createAuditDrainContract, listAuditDrainsContract } from '@/lib/api/contracts/audit'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { encryptDrainSecret } from '@/lib/audit/drains'
import { getAuditRequestMetadata } from '@/lib/audit/request'
import { backendSDK } from '@/lib/backend/sdk'

/** The organization's audit drains. */
export const GET = route(listAuditDrainsContract, {
  auth: organizationAccess('audit:read', { scope: 'requested' }),
  handler: async ({ access }) => backendSDK(access).listAuditDrains(),
})

/** Add a drain. The signing secret is encrypted before it leaves this process. */
export const POST = route(createAuditDrainContract, {
  auth: organizationAccess('audit:manage', { scope: 'requested', sensitive: true }),
  handler: async ({ access, body, request }) =>
    backendSDK(access).createAuditDrain(
      {
        encryptedSigningSecret: encryptDrainSecret(body.signingSecret),
        endpoint: body.endpoint,
        name: body.name,
        provider: body.provider,
      },
      getAuditRequestMetadata(request.headers)
    ),
})
