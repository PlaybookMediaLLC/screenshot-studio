import { z } from 'zod'
import { type ContractDocs, contractDocsSchema } from '@/lib/api/contract'

/** Docs for an API-key workspace operation; the security scheme is implied. */
export const workspaceDocsInputSchema = contractDocsSchema.omit({ security: true })

/** One of {@link workspaceDocsInputSchema}. */
export type WorkspaceDocsInput = z.infer<typeof workspaceDocsInputSchema>

/**
 * OpenAPI docs for an API-key workspace operation, with the shared 401, 403,
 * and 503 descriptions filled in.
 */
export function workspaceDocs(docs: WorkspaceDocsInput): ContractDocs {
  return {
    ...docs,
    responses: {
      '401': 'Authentication is required.',
      '403': 'The API key lacks the required workspace scope.',
      '503': 'A required dependency is unavailable.',
      ...docs.responses,
    },
    security: 'workspaceApiKey',
  }
}
