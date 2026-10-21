import {
  connectionAvailabilitySchema,
  type ConnectionAvailability,
} from 'screenshot-studio-backend-sdk'
import { z } from 'zod'
import { defineContract, mirrors } from '@/lib/api/contract'
import { memberDocs } from '@/lib/api/contracts/workspace-docs'

/** Read current connection readiness without starting OAuth or accepting credentials. */
export const getSocialConnectionAvailabilityContract = defineContract({
  access: { permission: 'workspace:update', feature: 'content:drafts', quota: 'api:write:minute' },
  docs: memberDocs({
    description:
      'Reads the current adapter configuration and product rollout gates for the active workspace. Only signed-in owners/admins may inspect it; API keys cannot connect accounts. No app IDs, secrets or credentials are returned. Available means a connection can be attempted, not that provider approval, account grants or publishing capabilities have been verified. Subscription capacity, target ownership and occupied slots are rechecked when an attempt starts and commits. The response is not cached.',
    operationId: 'getSocialConnectionAvailability',
    outputName: 'SocialConnectionAvailability',
    responses: {
      '200': 'Complete current configuration readiness for the supported connection branches.',
      '400': 'The request includes unsupported query parameters.',
      '403': 'Workspace administration or content draft entitlement is required.',
      '404': 'Social sets are not enabled in this deployment.',
      '429': 'The workspace API request quota is exhausted.',
      '503': 'The workspace binding or adapter availability could not be verified.',
    },
    tag: 'Publishing',
  }),
  method: 'GET',
  name: 'social-connections.availability',
  output: mirrors<ConnectionAvailability>()(connectionAvailabilitySchema),
  query: z.strictObject({}),
  path: '/api/v1/social-connection-availability',
  status: 200,
  summary: 'Read social connection availability',
})
