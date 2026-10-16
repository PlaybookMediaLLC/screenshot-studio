import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { providerSlugSchema } from '@/lib/integrations/schema'

/** The provider a connect or callback URL names. */
export const integrationParamsSchema = z.object({ provider: providerSlugSchema })

/** `GET /api/integrations/{provider}/connect`: send an admin to the provider's consent screen. */
export const connectIntegrationContract = defineContract({
  method: 'GET',
  name: 'integrations.connect',
  output: z.undefined(),
  params: integrationParamsSchema,
  path: '/api/integrations/{provider}/connect',
  summary: 'Start connecting Slack, Notion, or Figma',
})

/** `GET /api/integrations/{provider}/callback`: the provider's redirect back, with a code or an error. */
export const integrationCallbackContract = defineContract({
  method: 'GET',
  name: 'integrations.callback',
  output: z.undefined(),
  params: integrationParamsSchema,
  path: '/api/integrations/{provider}/callback',
  query: z.object({
    code: z.string().max(2048).optional(),
    error: z.string().max(200).optional(),
    state: z.string().max(200).optional(),
  }),
  summary: 'Finish connecting Slack, Notion, or Figma',
})
