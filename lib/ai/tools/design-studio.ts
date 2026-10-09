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
import { DesignRenderLimitError, renderDesignForTenant } from '@/lib/design/render-design'
import type { DesignRenderer } from '@/lib/design/renderer'
import { designTemplates, getDesignTemplate } from '@/lib/design/templates'
import { createDesign, getDesign } from '@/lib/tenant/designs'
import { type BrandKitValues, brandDesignChanges } from '@/lib/launch/brand'
import type { RenderCritique } from '../launch/critique'
import type { CampaignStudioRecord, CampaignStudioScope } from './campaign-studio'

/** Extra behavior when the tools run inside the launch pipeline. */
export type LaunchToolOptions = {
  /** Applied to every new design: brand gradient, text color, and font. */
  brand: BrandKitValues | null
  /** Reviews each render; a "fix" verdict is returned to the agent to act on. */
  critique: (input: {
    previewJpegBase64: string
    texts: string[]
  }) => Promise<RenderCritique | null>
  /** Per-run budgets sized to the plan. */
  limits?: { designs?: number; renders?: number }
}

const planAssetKeySchema = z
  .string()
  .regex(/^A\d{1,2}$/)
  .optional()
  .describe('The plan asset this design realizes, e.g. A1.')
const variantLabelSchema = z
  .enum(['A', 'B'])
  .optional()
  .describe('A or B when the plan asks for an A/B pair.')

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
  getRenderer: () => Promise<DesignRenderer>,
  launch?: LaunchToolOptions
) {
  const maxDesigns = launch?.limits?.designs ?? MAX_DESIGNS
  const maxRenders = launch?.limits?.renders ?? MAX_RENDERS
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
    planAssetKey?: string
    templateId?: string
    variantLabel?: string
  }) {
    designs += 1
    const design = await createDesign(scope.tenant, {
      campaignId: scope.campaignId,
      planVersion: scope.planVersion,
      ...input,
    })
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
      planAssetKey: planAssetKeySchema,
      screenshotAssetId: z.string().uuid(),
      subheadline: z.string().trim().max(100).optional(),
      templateId: z.enum(designTemplates.map((template) => template.id) as [string, ...string[]]),
      textColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      variantLabel: variantLabelSchema,
    }),
    execute: async (input) => {
      if (designs >= maxDesigns) return failure(`At most ${maxDesigns} designs per run.`)
      if (
        !(await requireCapture(input.screenshotAssetId)) ||
        !(await requireCapture(input.mobileScreenshotAssetId))
      ) {
        return failure('Use capture asset ids returned by captureProductPage.')
      }
      const template = getDesignTemplate(input.templateId)
      if (!template) return failure('Unknown template.')
      let document = template.build({
        headline: input.headline,
        mobileScreenshot: input.mobileScreenshotAssetId && `asset:${input.mobileScreenshotAssetId}`,
        screenshot: `asset:${input.screenshotAssetId}`,
        subheadline: input.subheadline,
        textColor: input.textColor,
      })
      if (launch?.brand) {
        // Every launch design starts on brand; edits may vary within the palette.
        document = patchDesignDocument(
          document,
          brandDesignChanges(launch.brand, document.texts) as Parameters<
            typeof patchDesignDocument
          >[1]
        )
      }
      return saveDesign({
        document,
        name: input.name,
        planAssetKey: input.planAssetKey,
        templateId: template.id,
        variantLabel: input.variantLabel,
      })
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
      variantLabel: variantLabelSchema,
    }),
    execute: async ({ changes, designId, name, replace, variantLabel }) => {
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
          data: { document, ...(name ? { name } : {}), ...(variantLabel ? { variantLabel } : {}) },
          where: { id: design.id, organizationId: scope.tenant.organizationId },
        })
        return { designId: design.id, ok: true as const }
      }
      if (designs >= maxDesigns) return failure(`At most ${maxDesigns} designs per run.`)
      return saveDesign({
        document,
        name: name ?? `${design.name} variant`,
        parentDesignId: design.id,
        planAssetKey: design.planAssetKey ?? undefined,
        templateId: document.template,
        variantLabel: variantLabel ?? undefined,
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
      if (renders >= maxRenders) return failure(`At most ${maxRenders} renders per run.`)
      const design = await requireCampaignDesign(designId)
      if (!design) return failure('Unknown designId for this campaign.')
      renders += 1
      let rendered
      try {
        rendered = await renderDesignForTenant(scope.tenant, getRenderer, design)
      } catch (error) {
        if (error instanceof DesignRenderLimitError) return failure(error.message)
        console.error('Design render failed.', {
          designId,
          reason: error instanceof Error ? error.message : 'unknown',
        })
        return failure(
          'The design could not be rendered. If this keeps happening, use createProductShot instead.'
        )
      }
      // A re-render of an unchanged design reuses the same asset; link it once.
      const provenance = {
        planAssetKey: design.planAssetKey,
        planVersion: design.planVersion,
        variantLabel: design.variantLabel,
      }
      await prisma.campaignAsset.upsert({
        create: {
          assetId: rendered.asset.id,
          campaignId: scope.campaignId,
          caption,
          kind: 'design-render',
          organizationId: scope.tenant.organizationId,
          ...provenance,
        },
        update: { caption, ...provenance },
        where: { campaignId_assetId: { assetId: rendered.asset.id, campaignId: scope.campaignId } },
      })
      if (!record.assets.some((asset) => asset.assetId === rendered.asset.id)) {
        record.assets.push({ assetId: rendered.asset.id, kind: 'design-render' })
      }
      // A small preview lets the model review its own work without a full-size image.
      const preview = await sharp(await rendered.readBytes())
        .resize({ width: 960, withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer()
      const previewBase64 = preview.toString('base64')
      let review: { issues: string[]; scores: string; verdict: 'fix' | 'pass' } | null = null
      if (launch) {
        const critique = await launch.critique({
          previewJpegBase64: previewBase64,
          texts: design.document.texts.map((text) => text.text),
        })
        if (critique) {
          await prisma.design.updateMany({
            data: { critique },
            where: { id: design.id, organizationId: scope.tenant.organizationId },
          })
          review = {
            issues: critique.issues,
            scores: `spec ${critique.specFidelity}/5, brand ${critique.brand}/5, legibility ${critique.legibility}/5`,
            verdict: critique.verdict,
          }
        }
      }
      return {
        assetId: rendered.asset.id,
        cached: rendered.cached,
        designId: design.id,
        height: rendered.height,
        ok: true as const,
        preview: previewBase64,
        ...(review ? { review } : {}),
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
