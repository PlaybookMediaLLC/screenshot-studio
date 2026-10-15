import 'server-only'

import { backendSDK, orNull, withDates } from '@/lib/backend/sdk'
import type { TenantContext } from '@/lib/auth/access'
import { type DesignDocument, designDocumentSchema } from '@/lib/design/document'

export class DesignError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404
  ) {
    super(message)
    this.name = 'DesignError'
  }
}

/**
 * The backend rejects a document that references an image outside this
 * workspace: the renderer signs whatever a design names, so that check keeps
 * one tenant's design from rendering another tenant's images.
 */
export async function createDesign(
  context: TenantContext,
  input: {
    campaignId?: string
    document: unknown
    name: string
    parentDesignId?: string
    /** Plan asset this design realizes (A1…) and its A/B label. */
    planAssetKey?: string
    planVersion?: number
    templateId?: string
    variantLabel?: string
  }
) {
  const document = designDocumentSchema.parse(input.document)
  const design = withDates(
    await backendSDK(context).createDesign({
      ...input,
      document,
      templateId: input.templateId ?? document.template,
    })
  )
  return { ...design, document }
}

export async function getDesign(context: TenantContext, designId: string) {
  const design = withDates(await orNull(backendSDK(context).getDesign(designId)))
  return design ? { ...design, document: designDocumentSchema.parse(design.document) } : null
}

export async function updateDesignDocument(
  context: TenantContext,
  designId: string,
  document: DesignDocument
) {
  await backendSDK(context).updateDesignDocument(designId, document)
}

export async function setDesignRender(
  context: TenantContext,
  designId: string,
  assetId: string,
  renderKey: string | null = null
) {
  await backendSDK(context).setDesignRender(designId, assetId, renderKey)
}

export async function listCampaignDesigns(context: TenantContext, campaignId: string) {
  return withDates((await backendSDK(context).listCampaignDesigns(campaignId)).designs)
}
