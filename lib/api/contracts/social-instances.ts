import { mastodonInstanceSchema, socialInstanceQuerySchema } from 'screenshot-studio-backend-sdk'
import { defineContract } from '@/lib/api/contract'
import { memberDocs } from '@/lib/api/contracts/workspace-docs'

/** Read public instance metadata without starting authorization or creating a social set. */
export const previewMastodonInstanceContract = defineContract({
  access: { permission: 'workspace:update', feature: 'content:drafts', quota: 'api:write:minute' },
  docs: memberDocs({
    description:
      'Reads the selected public Mastodon server’s v2 instance metadata. Accepts a hostname or HTTPS origin with no path, port or credentials. The backend blocks private addresses, refuses redirects, limits the response size and bounds network time. This preview does not authorize an account or prove publishing capability. activeUsers is the reported number of active users in the past four weeks, when available.',
    operationId: 'previewMastodonInstance',
    outputName: 'MastodonInstancePreview',
    responses: {
      '200': 'Public instance metadata for the requested origin.',
      '400': 'The server origin is invalid.',
      '429': 'The workspace API request quota is exhausted.',
      '503': 'The server is unreachable, private, redirects, or returns an invalid response.',
    },
    tag: 'Publishing',
  }),
  method: 'GET',
  name: 'social-instances.mastodon',
  output: mastodonInstanceSchema,
  path: '/api/v1/social-instances/mastodon',
  query: socialInstanceQuerySchema,
  status: 200,
  summary: 'Preview a public Mastodon server',
})
