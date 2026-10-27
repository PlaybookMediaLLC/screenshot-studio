import { z } from 'zod'
import { ingestGitHubAppWebhookContract } from '@/lib/api/contracts/webhooks'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import { handleGitHubAppDelivery, verifyGitHubAppDelivery } from '@/lib/tenant/github'

/** The verified delivery: GitHub's delivery ID and event name. */
const appDeliverySchema = z.object({
  deliveryId: z.string().min(1).max(255),
  eventName: z.string().nullable(),
})

/** An App delivery authenticates with the App's webhook secret over the exact body bytes. */
const appSignatureAccess: Authenticate<z.infer<typeof appDeliverySchema>> = async ({
  raw,
  request,
}) => {
  const { body } = await raw()
  const deliveryId = request.headers.get('x-github-delivery')
  if (
    !deliveryId ||
    !verifyGitHubAppDelivery(z.string().parse(body), request.headers.get('x-hub-signature-256'))
  ) {
    throw new AuthorizationError('Unauthorized webhook.', 401)
  }
  return appDeliverySchema.parse({ deliveryId, eventName: request.headers.get('x-github-event') })
}

/**
 * Act on a GitHub App delivery: installation lifecycle, removed repository
 * access, and repository events fanned out to every watching workspace. A
 * delivery that touched nothing answers 202.
 */
export const POST = route(ingestGitHubAppWebhookContract, {
  auth: appSignatureAccess,
  handler: async ({ access, body }) => handleGitHubAppDelivery({ ...access, body }),
  status: (result) => (result.handled > 0 ? 200 : 202),
})
