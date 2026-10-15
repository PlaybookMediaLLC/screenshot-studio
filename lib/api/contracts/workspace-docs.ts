import type { ContractDocs, DocumentedStatus } from '@/lib/api/contract'

/**
 * OpenAPI docs for an API-key workspace operation, with the shared 401, 403,
 * and 503 descriptions filled in.
 */
export function workspaceDocs(
  docs: Omit<ContractDocs, 'responses' | 'security'> & {
    responses: Partial<Record<DocumentedStatus, string>>
  }
): ContractDocs {
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
