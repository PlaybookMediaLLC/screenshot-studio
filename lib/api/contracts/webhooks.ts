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
