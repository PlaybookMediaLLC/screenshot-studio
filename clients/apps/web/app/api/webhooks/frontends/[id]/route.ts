import { z } from 'zod'
import { frontendWebhookContract } from '@/lib/api/contracts/webhooks'
import { route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import { serviceBackend } from '@/lib/backend/sdk'

/** Forward the exact bounded body to backend-owned provider authentication and durable acceptance. */
export const POST = route(frontendWebhookContract, {
  auth: async ({ request }) => {
    const signature =
      request.headers.get('x-vercel-signature') ?? request.headers.get('x-webhook-signature')
    if (!signature) throw new AuthorizationError('Missing webhook signature.', 401)
    return z.object({ signature: z.string().min(1).max(4096) }).parse({ signature })
  },
  handler: ({ access, params, body }) =>
    serviceBackend().acceptFrontendWebhook(params.id, access.signature, body),
})
