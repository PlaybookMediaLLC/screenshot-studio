import 'server-only'

import { tool } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { designCatalogSections } from '@/lib/design/catalog'
import { describeDesignCatalog } from '@/lib/design/catalog-sections'
import {
  type DesignDocument,
  definedChanges,
  designChangesSchema,
  patchDesignDocument,
} from '@/lib/design/document'
import type { DesignRenderer } from '@/lib/design/renderer'
import { designTemplates, getDesignTemplate } from '@/lib/design/templates'
import { storeGeneratedAsset } from '@/lib/tenant/assets'
import { createDesign, getDesign, setDesignRender } from '@/lib/tenant/designs'
import type { CampaignStudioRecord, CampaignStudioScope } from './campaign-studio'

/**
 * Design tools: every editor capability, exposed as templates plus typed
 * edits on a DesignDocument.
 *
 * The agent starts a design from a template (an editor template, preset, or
 * marketing layout with copy slots), derives variants by patching any part
 * of the document (background, frame, shadow, 3D, filters, devices, text,
 * overlays, annotations, redaction, animation), and renders the ones worth
 * keeping through the editor's own renderer. Every design stays editable:
 * it opens in the editor exactly as rendered.
 */

const MAX_DESIGNS = 10
/** Includes re-renders after the agent reviews and fixes a design. */
const MAX_RENDERS = 8

/** Any section of a DesignDocument; omitted sections are left as they are. */
export function createDesignStudioTools(
  scope: CampaignStudioScope,
  record: CampaignStudioRecord,
  getRenderer: () => Promise<DesignRenderer>
) {
  let designs = 0
  let renders = 0
  const failure = (message: string) => ({ error: message, ok: false as const })

  /** Captures this campaign owns; designs may only show these. */
  async function requireCapture(assetId: string | undefined) {
    if (!assetId) return true
    const link = await prisma.campaignAsset.findFirst({
      select: { id: true },
      where: {
        assetId,
        campaignId: scope.campaignId,
        kind: { startsWith: 'capture-' },
        organizationId: scope.tenant.organizationId,
      },
    })
    return Boolean(link)
  }

  async function requireCampaignDesign(designId: string) {
    const design = await getDesign(scope.tenant.organizationId, designId)
    return design && design.campaignId === scope.campaignId ? design : null
  }

  async function saveDesign(input: {
    document: DesignDocument
    name: string
    parentDesignId?: string
    templateId?: string
  }) {
    designs += 1
    const design = await createDesign(scope.tenant, { campaignId: scope.campaignId, ...input })
    return { designId: design.id, ok: true as const }
  }

  const listDesignOptions = tool({
    description:
      'Look up what the editor can do: templates (start here), aspect ratios, backgrounds ' +
      '(gradients, mesh/magic gradients, solids, images), fonts, device mockups and layouts, ' +
      'frames/patterns/shadows, overlays (arrows, light/shadow textures), and animation presets.',
    inputSchema: z.object({ section: z.enum(designCatalogSections) }),
    execute: async ({ section }) => ({
      ok: true as const,
      options: describeDesignCatalog(section),
      section,
    }),
  })

  const createDesignFromTemplate = tool({
    description:
      'Start a design from a template with the product capture in it. Layout templates place ' +
      'the headline and subheadline; editor templates and presets style the screenshot only. ' +
      'Use a mobile capture for mobileScreenshotAssetId when the template shows phones.',
    inputSchema: z.object({
      headline: z.string().trim().max(60).optional(),
      mobileScreenshotAssetId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120),
      screenshotAssetId: z.string().uuid(),
      subheadline: z.string().trim().max(100).optional(),
      templateId: z.enum(designTemplates.map((template) => template.id) as [string, ...string[]]),
      textColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
    }),
    execute: async (input) => {
      if (designs >= MAX_DESIGNS) return failure(`At most ${MAX_DESIGNS} designs per run.`)
      if (
        !(await requireCapture(input.screenshotAssetId)) ||
        !(await requireCapture(input.mobileScreenshotAssetId))
      ) {
        return failure('Use capture asset ids returned by captureProductPage.')
      }
      const template = getDesignTemplate(input.templateId)
      if (!template) return failure('Unknown template.')
      const document = template.build({
        headline: input.headline,
        mobileScreenshot: input.mobileScreenshotAssetId && `asset:${input.mobileScreenshotAssetId}`,
        screenshot: `asset:${input.screenshotAssetId}`,
        subheadline: input.subheadline,
        textColor: input.textColor,
      })
      return saveDesign({ document, name: input.name, templateId: template.id })
    },
  })

  const editDesign = tool({
    description:
      'Change any part of a design: background, canvas/aspect ratio, frame, shadow, 3D tilt, ' +
      'filters, devices, text, overlays, annotations (arrows, boxes, circles), redactions ' +
      '(blur/mosaic), or animation. By default saves the result as a new variant and keeps the ' +
      'original; set replace=true to edit in place. Positions are 0-1 fractions of the canvas ' +
      '(text positions are 0-100 percentages); text fontSize is a fraction of canvas width.',
    inputSchema: z.object({
      changes: designChangesSchema,
      designId: z.string().cuid(),
      name: z.string().trim().min(1).max(120).optional(),
      replace: z.boolean().default(false),
    }),
    execute: async ({ changes, designId, name, replace }) => {
      const design = await requireCampaignDesign(designId)
      if (!design) return failure('Unknown designId for this campaign.')
      let document: DesignDocument
      try {
        document = patchDesignDocument(design.document, definedChanges(changes))
      } catch (error) {
        return failure(
          `Invalid change: ${error instanceof Error ? error.message.slice(0, 400) : 'invalid'}`
        )
      }
      if (replace) {
        await prisma.design.updateMany({
          data: { document, ...(name ? { name } : {}) },
          where: { id: design.id, organizationId: scope.tenant.organizationId },
        })
        return { designId: design.id, ok: true as const }
      }
      if (designs >= MAX_DESIGNS) return failure(`At most ${MAX_DESIGNS} designs per run.`)
      return saveDesign({
        document,
        name: name ?? `${design.name} variant`,
        parentDesignId: design.id,
        templateId: document.template,
      })
    },
  })

  const renderDesign = tool({
    description:
      'Render a finished design to a PNG with the editor renderer and attach it to the campaign. ' +
      'Returns a preview of the rendered image: check it, and if text is hard to read, cropped, ' +
      'or overlapping, fix the design with editDesign (replace=true) and render it again. ' +
      'Render only the designs worth publishing.',
    inputSchema: z.object({
      caption: z.string().trim().min(1).max(200).describe('Alt text describing the image.'),
      designId: z.string().cuid(),
    }),
    execute: async ({ caption, designId }) => {
      if (renders >= MAX_RENDERS) return failure(`At most ${MAX_RENDERS} renders per run.`)
      const design = await requireCampaignDesign(designId)
      if (!design) return failure('Unknown designId for this campaign.')
      renders += 1
      let rendered
      try {
        rendered = await (await getRenderer()).render(design.id, scope.tenant.organizationId)
      } catch (error) {
        console.error('Design render failed.', {
          designId,
          reason: error instanceof Error ? error.message : 'unknown',
        })
        return failure('The design could not be rendered. Try a simpler variant.')
      }
      const asset = await storeGeneratedAsset(scope.tenant, {
        body: rendered.bytes,
        classification: 'export',
        contentType: rendered.mediaType,
        fileName: 'design.png',
        height: rendered.height,
        width: rendered.width,
      })
      await setDesignRender(scope.tenant, design.id, asset.id)
      await prisma.campaignAsset.create({
        data: {
          assetId: asset.id,
          campaignId: scope.campaignId,
          caption,
          kind: 'design-render',
          organizationId: scope.tenant.organizationId,
        },
      })
      record.assets.push({ assetId: asset.id, kind: 'design-render' })
      // A small preview lets the model review its own work without a full-size image.
      const preview = await sharp(rendered.bytes)
        .resize({ width: 960, withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer()
      return {
        assetId: asset.id,
        designId: design.id,
        height: rendered.height,
        ok: true as const,
        preview: preview.toString('base64'),
        width: rendered.width,
      }
    },
    toModelOutput: ({ output }) => {
      if (!output.ok || !('preview' in output)) return { type: 'json', value: output }
      const { preview, ...result } = output
      return {
        type: 'content',
        value: [
          { text: JSON.stringify(result), type: 'text' },
          { data: { data: preview, type: 'data' }, mediaType: 'image/jpeg', type: 'file' },
        ],
      }
    },
  })

  return { createDesignFromTemplate, editDesign, listDesignOptions, renderDesign }
}
