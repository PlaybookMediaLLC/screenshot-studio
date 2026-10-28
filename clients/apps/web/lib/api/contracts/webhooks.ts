import { z } from 'zod'
import { defineContract, mirrors } from '@/lib/api/contract'
import type { WebhookIngestResult } from '@/lib/tenant/webhooks'

/** `POST /api/webhooks/source/{sourceAppId}`: a signed release event, read as raw text. */
export const ingestSourceWebhookContract = defineContract({
  body: z.string(),
  bodyFormat: 'text',
  method: 'POST',
  name: 'webhooks.source',
  // A release, a merged PR held for the next release, or a production deployment;
  // a delivery that ships nothing (a ping, an off-branch PR) is acknowledged as ignored.
  output: z.union([
    mirrors<WebhookIngestResult>()(
      z.union([
        z.object({ created: z.boolean(), releaseId: z.string() }),
        z.object({ changeId: z.string(), created: z.boolean() }),
        z.object({ created: z.boolean(), deploymentId: z.string() }),
      ])
    ),
    z.object({ ignored: z.literal(true) }),
  ]),
  params: z.object({ sourceAppId: z.string().min(1) }),
  path: '/api/webhooks/source/{sourceAppId}',
  status: 201,
  summary: 'Ingest a signed source-app release webhook',
})

/** `POST /api/webhooks/github`: a signed GitHub App delivery, read as raw text. */
export const ingestGitHubAppWebhookContract = defineContract({
  body: z.string(),
  bodyFormat: 'text',
  method: 'POST',
  name: 'webhooks.github',
  // How many records the delivery touched; zero means it shipped nothing.
  output: z.object({ handled: z.number().int().nonnegative() }),
  path: '/api/webhooks/github',
  status: 200,
  summary: 'Ingest a signed GitHub App webhook',
})

/** `POST /api/webhooks/stripe`: a Stripe event signed with the endpoint secret, read as raw text. */
export const stripeWebhookContract = defineContract({
  body: z.string(),
  bodyFormat: 'text',
  method: 'POST',
  name: 'webhooks.stripe',
  output: z.object({ synced: z.boolean() }),
  path: '/api/webhooks/stripe',
  summary: 'Sync a workspace plan from a Stripe subscription event',
})

/** Provider signature verification happens in the backend before JSON normalization. */
export const frontendWebhookContract = defineContract({
  body: z.string(),
  bodyFormat: 'text',
  maxBodyBytes: 1024 * 1024,
  method: 'POST',
  name: 'webhooks.frontend',
  path: '/api/webhooks/frontends/{id}',
  status: 202,
  params: z.object({ id: z.string().min(1).max(100) }),
  output: z.object({ accepted: z.literal(true) }),
  summary: 'Durably accept a provider-signed frontend deployment observation',
})
