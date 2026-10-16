import 'server-only'

import { backendSDK, withDates } from '@/lib/backend/sdk'
import type { TenantContext } from '@/lib/auth/access'
import type {
  CreativeTemplateCreateInput,
  CreativeVariantApprovalInput,
  CreativeVariantCreateInput,
} from './schemas'

export class CreativeWorkflowError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'CreativeWorkflowError'
  }
}

function requireCreator(context: TenantContext): void {
  if (context.principal.kind !== 'session') {
    throw new CreativeWorkflowError('A signed-in creator is required.', 400)
  }
}

export async function listCreativeTemplates(context: TenantContext) {
  return withDates((await backendSDK(context).listCreativeTemplates()).templates)
}

/** The backend versions templates by name within the workspace. */
export async function createCreativeTemplate(
  context: TenantContext,
  input: CreativeTemplateCreateInput
) {
  return withDates(await backendSDK(context).createCreativeTemplate(input))
}

/** Rename every version of the template `templateId` belongs to. */
export async function renameCreativeTemplate(context: TenantContext, templateId: string, name: string) {
  return withDates(await backendSDK(context).renameCreativeTemplate(templateId, name))
}

/** Archive every version of the template `templateId` belongs to. */
export async function archiveCreativeTemplate(context: TenantContext, templateId: string) {
  return backendSDK(context).archiveCreativeTemplate(templateId)
}

/**
 * A variant pins the template, brand kit, and source asset revisions it was
 * built from; the backend resolves them in this workspace and numbers the
 * revision per release and aspect ratio.
 */
export async function createCreativeVariant(
  context: TenantContext,
  input: CreativeVariantCreateInput
) {
  requireCreator(context)
  return backendSDK(context).createCreativeVariant(input)
}

export async function decideCreativeVariantApproval(
  context: TenantContext,
  variantId: string,
  input: CreativeVariantApprovalInput
) {
  requireCreator(context)
  return withDates(await backendSDK(context).decideCreativeVariant(variantId, input))
}
