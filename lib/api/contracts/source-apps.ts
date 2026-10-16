import { z } from 'zod'
import { defineContract, mirrors, timestampSchema } from '@/lib/api/contract'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import type { createSourceApp, updateSourceApp } from '@/lib/tenant/configuration'
import {
  sourceAppCreateSchema,
  sourceAppUpdateSchema,
  sourceWebhookSetupSchema,
} from '@/lib/tenant/schemas'

/** Lifecycle states of a source app. */
export const sourceAppStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])

/** A source app as created and updated, including the rules for its webhooks. */
export const sourceAppSchema = z.object({
  allowedHosts: z.array(z.string()),
  branch: z.string().nullable(),
  createdAt: timestampSchema,
  externalId: z.string().nullable(),
  id: z.string(),
  ignoreBotPullRequests: z.boolean(),
  ignoredPullRequestAuthors: z.array(z.string()),
  name: z.string(),
  organizationId: z.string(),
  provider: z.string(),
  secretReference: z.string().nullable(),
  skipPrereleases: z.boolean(),
  status: sourceAppStatusSchema,
  updatedAt: timestampSchema,
})

/** `POST /api/v1/source-apps` (also served at `/api/tenant/source-apps`). */
export const createSourceAppContract = defineContract({
  body: sourceAppCreateSchema,
  docs: workspaceDocs({
    bodyName: 'SourceAppCreateRequest',
    description:
      'Registers a release-intake source in the API key workspace and returns its webhook URL. Without a `secretReference`, the response also carries the webhook secret, shown only this once. Requires the `source:write` scope.',
    operationId: 'createSourceApp',
    responses: { '201': 'Source app created.', '400': 'The source app input is invalid.' },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'source-apps.create',
  output: z.object({
    sourceApp: mirrors<Awaited<ReturnType<typeof createSourceApp>>>()(sourceAppSchema),
    webhook: sourceWebhookSetupSchema,
  }),
  path: '/api/v1/source-apps',
  status: 201,
  summary: 'Create a workspace source app',
})

/** `PATCH /api/v1/source-apps/{sourceAppId}` (also served at `/api/tenant/source-apps/{sourceAppId}`). */
export const updateSourceAppContract = defineContract({
  body: sourceAppUpdateSchema,
  docs: workspaceDocs({
    bodyName: 'SourceAppUpdateRequest',
    description:
      'Changes which webhook deliveries a source turns into releases: the watched branch, the bot and author filters, and pre-release handling. Requires the `source:write` scope.',
    operationId: 'updateSourceApp',
    responses: {
      '200': 'Source app updated.',
      '400': 'The rules are invalid.',
      '404': 'No source app with that ID exists in the workspace.',
    },
    tag: 'Workspace',
  }),
  method: 'PATCH',
  name: 'source-apps.update',
  output: z.object({
    sourceApp: mirrors<Awaited<ReturnType<typeof updateSourceApp>>>()(sourceAppSchema),
  }),
  params: z.object({ sourceAppId: z.string().min(1) }),
  path: '/api/v1/source-apps/{sourceAppId}',
  summary: 'Update a workspace source app',
})
