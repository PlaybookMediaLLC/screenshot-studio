import { z } from 'zod'
import { defineContract, mirrors } from '@/lib/api/contract'
import type { ingestSourceRelease } from '@/lib/tenant/webhooks'

/** `POST /api/webhooks/source/{sourceAppId}`: a signed release event, read as raw text. */
export const ingestSourceWebhookContract = defineContract({
  body: z.string(),
  bodyFormat: 'text',
  method: 'POST',
  name: 'webhooks.source',
  output: mirrors<Awaited<ReturnType<typeof ingestSourceRelease>>>()(
    z.object({ created: z.boolean(), releaseId: z.string() })
  ),
  params: z.object({ sourceAppId: z.string().min(1) }),
  path: '/api/webhooks/source/{sourceAppId}',
  status: 201,
  summary: 'Ingest a signed source-app release webhook',
})
