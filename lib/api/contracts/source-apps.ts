import { z } from 'zod'
import { defineContract, mirrors, timestampSchema } from '@/lib/api/contract'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import type { createSourceApp } from '@/lib/tenant/configuration'
import { sourceAppCreateSchema } from '@/lib/tenant/schemas'

/** Lifecycle states of a source app. */
export const sourceAppStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])

/** `POST /api/v1/source-apps` (also served at `/api/tenant/source-apps`). */
export const createSourceAppContract = defineContract({
  body: sourceAppCreateSchema,
  docs: workspaceDocs({
    bodyName: 'SourceAppCreateRequest',
    description:
      'Registers a release-intake source in the API key workspace. Requires the `source:write` scope.',
    operationId: 'createSourceApp',
    responses: { '201': 'Source app created.', '400': 'The source app input is invalid.' },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'source-apps.create',
  output: z.object({
    sourceApp: mirrors<Awaited<ReturnType<typeof createSourceApp>>>()(
      z.object({
        allowedHosts: z.array(z.string()),
        createdAt: timestampSchema,
        externalId: z.string().nullable(),
        id: z.string(),
        name: z.string(),
        organizationId: z.string(),
        provider: z.string(),
        secretReference: z.string().nullable(),
        status: sourceAppStatusSchema,
        updatedAt: timestampSchema,
      })
    ),
  }),
  path: '/api/v1/source-apps',
  status: 201,
  summary: 'Create a workspace source app',
})
