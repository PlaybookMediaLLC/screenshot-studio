import { z } from 'zod'
import { ingestSourceWebhookContract } from '@/lib/api/contracts/webhooks'
import { type Authenticate, route } from '@/lib/api/route'
import { AuthorizationError } from '@/lib/auth/access'
import { sourceProviderSchema } from '@/lib/tenant/schemas'
import {
  getWebhookIntent,
  getWebhookSource,
  ingestWebhookIntent,
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
  'x-shots-event-id',
  'x-shots-signature',
  'x-shots-timestamp',
])

/** Where each webhook fact is read from, first header present wins. */
const webhookHeaderSetSchema = z.object({
  event: z.array(webhookHeaderSchema),
  eventId: z.array(webhookHeaderSchema),
  signature: z.array(webhookHeaderSchema),
  timestamp: z.array(webhookHeaderSchema),
})

// Each provider reads only its own headers, so a request cannot borrow another
// provider's weaker rule (GitHub's lack of a timestamp) to replay a body.
const githubHeaders = webhookHeaderSetSchema.parse({
  event: ['x-github-event'],
  eventId: ['x-github-delivery'],
  signature: ['x-hub-signature-256'],
  timestamp: [],
})

const gitlabHeaders = webhookHeaderSetSchema.parse({
  event: ['x-gitlab-event'],
  eventId: ['webhook-id', 'x-gitlab-event-uuid', 'idempotency-key'],
  signature: ['webhook-signature'],
  timestamp: ['webhook-timestamp'],
})

const genericHeaders = webhookHeaderSetSchema.parse({
  event: [],
  eventId: ['x-shots-event-id'],
  signature: ['x-shots-signature'],
  timestamp: ['x-shots-timestamp'],
})

/** The verified webhook: its delivery id and the source app it belongs to. */
const webhookAccessSchema = z.object({
  eventId: z.string().min(1),
  source: z.custom<NonNullable<Awaited<ReturnType<typeof getWebhookSource>>>>(),
})

function headersFor(provider: string): z.infer<typeof webhookHeaderSetSchema> {
  if (provider === sourceProviderSchema.enum.github) return githubHeaders
  return provider === sourceProviderSchema.enum.gitlab ? gitlabHeaders : genericHeaders
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

/**
 * Record what a verified delivery ships: a release, a merged PR held for the
 * next release, or a production deployment. A redelivery answers 200, and an
 * event that ships nothing answers 202.
 */
export const POST = route(ingestSourceWebhookContract, {
  auth: webhookSignatureAccess,
  handler: async ({ access: { eventId, source }, body, request }) => {
    const intent = getWebhookIntent({
      body,
      contentType: request.headers.get('content-type'),
      deliveryId: eventId,
      eventName: firstHeader(request.headers, headersFor(source.provider).event),
      source,
    })
    return intent
      ? ingestWebhookIntent({ deliveryId: eventId, intent, source })
      : { ignored: true as const }
  },
  status: (result) => ('ignored' in result ? 202 : result.created ? 201 : 200),
})
