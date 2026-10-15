import { z } from 'zod'
import { ingestSourceWebhookContract } from '@/lib/api/contracts/webhooks'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import {
  getWebhookReleaseInput,
  getWebhookSource,
  ingestSourceRelease,
  verifyWebhookRequest,
} from '@/lib/tenant/webhooks'

/** Request headers a source webhook may carry, across providers. */
const webhookHeaderSchema = z.enum([
  'idempotency-key',
  'webhook-id',
  'webhook-signature',
  'webhook-timestamp',
  'x-github-delivery',
  'x-github-event',
  'x-gitlab-event',
  'x-gitlab-event-uuid',
  'x-hub-signature-256',
  'x-screenshot-studio-event-id',
  'x-screenshot-studio-signature',
  'x-screenshot-studio-timestamp',
])

/** Where each webhook fact is read from, first header present wins. */
const webhookHeaderSetSchema = z.object({
  event: z.array(webhookHeaderSchema),
  eventId: z.array(webhookHeaderSchema),
  signature: z.array(webhookHeaderSchema),
  timestamp: z.array(webhookHeaderSchema),
})

/** Providers with their own header conventions; anything else uses the GitHub-style set. */
const webhookProviderSchema = z.enum(['gitlab'])

const gitlabHeaders = webhookHeaderSetSchema.parse({
  event: ['x-gitlab-event'],
  eventId: ['webhook-id', 'x-gitlab-event-uuid', 'idempotency-key'],
  signature: ['webhook-signature'],
  timestamp: ['webhook-timestamp'],
})

const defaultHeaders = webhookHeaderSetSchema.parse({
  event: ['x-github-event'],
  eventId: ['x-github-delivery', 'x-screenshot-studio-event-id'],
  signature: ['x-hub-signature-256', 'x-screenshot-studio-signature'],
  timestamp: ['x-screenshot-studio-timestamp'],
})

/** The verified webhook: its delivery id and the source app it belongs to. */
const webhookAccessSchema = z.object({
  eventId: z.string().min(1),
  source: z.custom<NonNullable<Awaited<ReturnType<typeof getWebhookSource>>>>(),
})

function headersFor(provider: string): z.infer<typeof webhookHeaderSetSchema> {
  return provider === webhookProviderSchema.enum.gitlab ? gitlabHeaders : defaultHeaders
}

function firstHeader(headers: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = headers.get(name)
    if (value !== null) return value
  }
  return null
}

/** A source webhook authenticates with its provider's signature over the exact body bytes. */
const webhookSignatureAccess: Authenticate<z.infer<typeof webhookAccessSchema>> = async ({
  raw,
  request,
}) => {
  const { body, params } = await raw()
  const source = await getWebhookSource(
    ingestSourceWebhookContract.params.parse(params).sourceAppId
  )
  const names = source && headersFor(source.provider)
  const eventId = names && firstHeader(request.headers, names.eventId)
  const verified =
    source &&
    names &&
    eventId &&
    verifyWebhookRequest({
      body: z.string().parse(body),
      eventId,
      signature: firstHeader(request.headers, names.signature),
      source,
      timestamp: firstHeader(request.headers, names.timestamp),
    })
  if (!verified) {
    throw new AuthorizationError('Unauthorized webhook.', 401)
  }
  return webhookAccessSchema.parse({ eventId, source })
}

/** Turn a verified release event into a release; a redelivery answers 200. */
export const POST = route(ingestSourceWebhookContract, {
  auth: webhookSignatureAccess,
  handler: async ({ access: { eventId, source }, body, request }) =>
    ingestSourceRelease({
      eventId,
      release: getWebhookReleaseInput(
        source.provider,
        firstHeader(request.headers, headersFor(source.provider).event),
        body
      ),
      source,
    }),
  status: (result) => (result.created ? 201 : 200),
})
