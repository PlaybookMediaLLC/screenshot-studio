import 'server-only'
import type { z } from 'zod'
import type {
  saveGitHubProductionSchema,
  previewGitHubProductionSchema,
} from 'screenshot-studio-backend-sdk'
import type { OrganizationAccess } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'

/** Read source-scoped policy and evidence history through the backend authority. */
export const getGitHubProduction = (access: OrganizationAccess, id: string, cursor?: string) =>
  backendSDK(access).getGitHubProduction(id, cursor)
/** Persist a policy revision through the backend's administrator check. */
export const saveGitHubProduction = (
  access: OrganizationAccess,
  id: string,
  input: z.infer<typeof saveGitHubProductionSchema>
) => backendSDK(access).saveGitHubProduction(id, input)
/** Evaluate without writes or provider reads. */
export const previewGitHubProduction = (
  access: OrganizationAccess,
  id: string,
  input: z.infer<typeof previewGitHubProductionSchema>
) => backendSDK(access).previewGitHubProduction(id, input)
/** Discover provider capabilities and exact-attempt jobs. */
export const getGitHubProductionCatalog = (
  access: OrganizationAccess,
  id: string,
  runId?: number,
  attempt?: number
) => backendSDK(access).getGitHubProductionCatalog(id, runId, attempt)
/** Read provider recovery status. */
export const getGitHubRecovery = (access: OrganizationAccess, id: string) =>
  backendSDK(access).getGitHubRecovery(id)
/** Inspect and optionally redeliver failed events into review-only history. */
export const inspectGitHubRecovery = (access: OrganizationAccess, id: string, redeliver: boolean) =>
  backendSDK(access).inspectGitHubRecovery(id, redeliver)
