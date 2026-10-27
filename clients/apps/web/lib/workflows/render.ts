import 'server-only'

import { z } from 'zod'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import { patchDesignDocument } from '@/lib/design/document'
import { renderDesignForTenant } from '@/lib/design/render-design'
import {
  createDesignRenderer,
  type DesignRenderer,
  isDesignRendererReady,
} from '@/lib/design/renderer'
import { getDesignTemplate } from '@/lib/design/templates'
import { brandDesignChanges, parseBrandKit } from '@/lib/launch/brand'
import { createDesign, getDesign, listCampaignDesigns } from '@/lib/tenant/designs'

/** A worker's request to render a campaign's creatives; the Go action builds it. */
export const workflowRenderRequestSchema = z.strictObject({
  organizationId: z.string().min(1).max(128),
  campaignId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  nodeId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  brandKitId: z.string().max(64).optional(),
  captureAssetId: z.string().min(1).max(64),
  headline: z.string().max(60),
  subheadline: z.string().max(100).optional(),
  templateIds: z
    .array(z.string().regex(/^[a-z0-9-]{1,64}$/))
    .min(1)
    .max(3),
})

/** One rendered creative, linked to the campaign as a design render. */
export const workflowRenderSchema = z.strictObject({
  templateId: z.string(),
  designId: z.string(),
  assetId: z.string(),
})

/** A workflow render request. */
export type WorkflowRenderRequest = z.infer<typeof workflowRenderRequestSchema>

/** The renderer is off or unreachable; the worker retries later. */
export class WorkflowRenderUnavailableError extends Error {
  constructor() {
    super('The design renderer is not available.')
    this.name = 'WorkflowRenderUnavailableError'
  }
}

/**
 * Fill each template with the product capture and the event's headline,
 * style it with the campaign's brand kit, render it, and link the image to
 * the campaign. A design this node already made is reused, and identical
 * renders hit the render cache, so a retried request duplicates nothing.
 * The designs stay drafts: a person approves them before scheduling.
 */
export async function renderWorkflowCreatives(request: WorkflowRenderRequest) {
  if (!(await isDesignRendererReady())) throw new WorkflowRenderUnavailableError()
  const tenant: TenantContext = {
    organizationId: request.organizationId,
    principal: {
      kind: 'trigger_service',
      organizationId: request.organizationId,
      taskRunId: `workflow:${request.runId}:${request.nodeId}`,
    },
    requestId: `${request.runId}:${request.nodeId}`,
  }
  const templates = request.templateIds.map((id) => {
    const template = getDesignTemplate(id)
    if (!template)
      throw new z.ZodError([
        { code: 'custom', message: `Unknown template ${id}.`, path: ['templateIds'] },
      ])
    return template
  })
  const { brandKits } = request.brandKitId
    ? await backendSDK(tenant).listBrandKits()
    : { brandKits: [] }
  const kitRow = brandKits.find((kit) => kit.id === request.brandKitId)
  const kit = kitRow ? parseBrandKit(kitRow.name, kitRow.definition) : null
  const existing = await listCampaignDesigns(tenant, request.campaignId)
  const lazy: { renderer?: Promise<DesignRenderer> } = {}
  const getRenderer = () => (lazy.renderer ??= createDesignRenderer())
  try {
    const renders: z.infer<typeof workflowRenderSchema>[] = []
    for (const template of templates) {
      const name = `Workflow ${request.nodeId} · ${template.id}`
      const reused = existing.find((item) => item.name === name && item.templateId === template.id)
      let design = reused ? await getDesign(tenant, reused.id) : null
      if (!design) {
        let document = template.build({
          headline: request.headline,
          screenshot: `asset:${request.captureAssetId}`,
          subheadline: request.subheadline,
        })
        if (kit) document = patchDesignDocument(document, brandDesignChanges(kit, document.texts))
        design = await createDesign(tenant, {
          campaignId: request.campaignId,
          document,
          name,
          templateId: template.id,
        })
      }
      const rendered = await renderDesignForTenant(tenant, getRenderer, design)
      await backendSDK(tenant).linkCampaignAsset(request.campaignId, rendered.asset.id, {
        caption: `${request.headline} · ${template.name}`,
        kind: 'design-render',
      })
      renders.push({ assetId: rendered.asset.id, designId: design.id, templateId: template.id })
    }
    return { renders }
  } finally {
    if (lazy.renderer) await (await lazy.renderer).close().catch(() => undefined)
  }
}
