import 'server-only'

import { tool } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { SCREENSHOT_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { getMockupDefinition } from '@/lib/constants/mockups'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { captureScreenshot } from '@/lib/screenshot-service'
import { readTenantObject } from '@/lib/storage/client'
import { isRegisteredCaptureUrl } from '@/lib/launch/spec-schema'
import { storeGeneratedAsset } from '@/lib/tenant/assets'
import {
  composeProductShot,
  isNearlyBlank,
  productShotFormats,
  productShotMockups,
} from '../images/product-shot'

/**
 * Tools the campaign studio agent uses to turn a release brief into launch
 * assets and copy.
 *
 * Every tool is built per run around one tenant and one campaign. The model
 * never names a workspace, campaign, or storage key, and it can only capture
 * URLs the workspace already registered for this release, so a prompt cannot
 * steer the agent at another tenant's data or an arbitrary host.
 */

export const campaignChannels = ['x', 'linkedin', 'instagram', 'threads', 'bluesky'] as const

const MAX_CAPTURES = 6
const MAX_PRODUCT_SHOTS = 4

export type CampaignStudioScope = {
  /** Product and release URLs the agent may capture, already validated. */
  allowedUrls: readonly [string, ...string[]]
  campaignId: string
  /** Plan version being produced, recorded on everything the run makes. */
  planVersion?: number
  tenant: TenantContext
}

export type CampaignStudioRecord = {
  assets: Array<{ assetId: string; kind: string }>
  savedPosts: number
}

/** Tool failures go back to the model as data so it can adjust, not as throws. */
function failure(message: string) {
  return { error: message, ok: false as const }
}

async function linkAsset(
  scope: CampaignStudioScope,
  assetId: string,
  kind: string,
  caption?: string,
  provenance: { planAssetKey?: string; variantLabel?: string } = {}
) {
  await prisma.campaignAsset.create({
    data: {
      assetId,
      campaignId: scope.campaignId,
      caption: caption ?? null,
      kind,
      organizationId: scope.tenant.organizationId,
      planAssetKey: provenance.planAssetKey ?? null,
      planVersion: scope.planVersion ?? null,
      variantLabel: provenance.variantLabel ?? null,
    },
  })
}

export function createCampaignStudioTools(
  scope: CampaignStudioScope,
  record: CampaignStudioRecord,
  /** Per-run budgets; the launch pipeline sizes them to the plan. */
  limits: { captures?: number; productShots?: number } = {}
) {
  const maxCaptures = limits.captures ?? MAX_CAPTURES
  const maxProductShots = limits.productShots ?? MAX_PRODUCT_SHOTS
  let captures = 0
  let productShots = 0

  const captureProductPage = tool({
    description:
      'Capture a real screenshot of one of the product pages registered for this release. ' +
      'Use device "mobile" for phone mockups and "desktop" for laptop mockups. Returns an assetId ' +
      'to pass to createProductShot.',
    inputSchema: z.object({
      colorScheme: z.enum(['light', 'dark']).default('light'),
      device: z.enum(['desktop', 'mobile']),
      url: z
        .string()
        .max(2_100)
        .describe(
          'A registered URL, optionally with a #section from the capture list to show that part of the page.'
        ),
    }),
    execute: async ({ colorScheme, device, url }) => {
      if (!isRegisteredCaptureUrl(url, scope.allowedUrls)) {
        return failure(`Capture one of the registered URLs: ${scope.allowedUrls.join(', ')}.`)
      }
      if (captures >= maxCaptures) return failure(`At most ${maxCaptures} captures per run.`)
      captures += 1
      const limit = await checkRateLimit(
        `campaign-studio:${scope.tenant.organizationId}`,
        SCREENSHOT_RATE_LIMIT
      )
      if (!limit.allowed) return failure('Screenshot capacity is exhausted; try again later.')
      let bytes: Buffer
      try {
        const { screenshot } = await captureScreenshot({
          colorScheme,
          deviceType: device,
          forceRefresh: false,
          url,
        })
        bytes = Buffer.from(screenshot, 'base64')
      } catch {
        return failure('The page could not be captured. Try another registered URL.')
      }
      if (await isNearlyBlank(bytes)) {
        return failure(
          'The capture came back nearly blank (the page likely animates in after load). Try another URL or device.'
        )
      }
      const png = await sharp(bytes).png().toBuffer({ resolveWithObject: true })
      const asset = await storeGeneratedAsset(scope.tenant, {
        body: png.data,
        classification: 'capture',
        contentType: 'image/png',
        fileName: `capture-${device}.png`,
        height: png.info.height,
        width: png.info.width,
      })
      const kind = `capture-${device}`
      await linkAsset(scope, asset.id, kind, url)
      record.assets.push({ assetId: asset.id, kind })
      return { assetId: asset.id, device, ok: true as const }
    },
  })

  const createProductShot = tool({
    description:
      'Composite a captured screenshot into a device mockup on a gradient background with a short ' +
      'headline. Phone mockups need a mobile capture; laptop mockups need a desktop capture. ' +
      'Headlines should be under 50 characters; subheadlines under 90.',
    inputSchema: z.object({
      background: z.object({
        from: z.string().regex(/^#[0-9a-f]{6}$/i),
        to: z.string().regex(/^#[0-9a-f]{6}$/i),
      }),
      caption: z.string().trim().min(1).max(200).describe('Alt text describing the shot.'),
      captureAssetId: z.string().uuid(),
      format: z.enum(Object.keys(productShotFormats) as [keyof typeof productShotFormats]),
      headline: z.string().trim().max(60).optional(),
      mockupId: z.enum(productShotMockups),
      planAssetKey: z
        .string()
        .regex(/^A\d{1,2}$/)
        .optional()
        .describe('The plan asset this shot realizes, e.g. A1.'),
      subheadline: z.string().trim().max(100).optional(),
      textColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      variantLabel: z.enum(['A', 'B']).optional().describe('A or B for an A/B pair.'),
    }),
    execute: async (input) => {
      if (productShots >= maxProductShots) {
        return failure(`At most ${maxProductShots} product shots per run.`)
      }
      const link = await prisma.campaignAsset.findFirst({
        include: { asset: { select: { objectKey: true, status: true } } },
        where: {
          assetId: input.captureAssetId,
          campaignId: scope.campaignId,
          kind: { startsWith: 'capture-' },
          organizationId: scope.tenant.organizationId,
        },
      })
      if (!link || link.asset.status !== 'UPLOADED') {
        return failure('Unknown captureAssetId. Use an id returned by captureProductPage.')
      }
      const family = getMockupDefinition(input.mockupId)?.family
      const device = link.kind === 'capture-mobile' ? 'mobile' : 'desktop'
      if ((family === 'phone') !== (device === 'mobile')) {
        return failure(
          `A ${family} mockup needs a ${family === 'phone' ? 'mobile' : 'desktop'} capture.`
        )
      }
      productShots += 1
      const screenshot = await readTenantObject({
        objectKey: link.asset.objectKey,
        organizationId: scope.tenant.organizationId,
      })
      const shot = await composeProductShot({ ...input, screenshot })
      const asset = await storeGeneratedAsset(scope.tenant, {
        body: shot.png,
        classification: 'derived',
        contentType: 'image/png',
        fileName: `product-shot-${input.format}.png`,
        height: shot.height,
        parentAssetId: input.captureAssetId,
        width: shot.width,
      })
      await linkAsset(scope, asset.id, 'product-shot', input.caption, {
        planAssetKey: input.planAssetKey,
        variantLabel: input.variantLabel,
      })
      record.assets.push({ assetId: asset.id, kind: 'product-shot' })
      return { assetId: asset.id, format: input.format, ok: true as const }
    },
  })

  const saveCampaignCopy = tool({
    description:
      'Save the launch copy to the campaign: 2-4 content angles and one post per channel per ' +
      'angle where it fits. Call this once, after the product shots exist. Posts are saved as drafts ' +
      'for human review.',
    inputSchema: z.object({
      angles: z
        .array(
          z.object({
            hook: z.string().trim().min(1).max(1_000),
            title: z.string().trim().min(1).max(200),
          })
        )
        .min(1)
        .max(4),
      posts: z
        .array(
          z.object({
            angleIndex: z.number().int().min(0).max(3),
            callToAction: z.string().trim().max(300).optional(),
            channel: z.enum(campaignChannels),
            copy: z.string().trim().min(1).max(3_000),
          })
        )
        .min(1)
        .max(16),
    }),
    execute: async ({ angles, posts }) => {
      if (record.savedPosts > 0) return failure('Copy was already saved for this run.')
      if (posts.some((post) => post.angleIndex >= angles.length)) {
        return failure('Every post angleIndex must point at one of the angles.')
      }
      await prisma.$transaction(async (transaction) => {
        // Append after existing angles so a second run never overwrites the first.
        const last = await transaction.contentAngle.findFirst({
          orderBy: { position: 'desc' },
          select: { position: true },
          where: { campaignId: scope.campaignId },
        })
        const offset = (last?.position ?? -1) + 1
        const angleIds: string[] = []
        for (const [index, angle] of angles.entries()) {
          const created = await transaction.contentAngle.create({
            data: {
              campaignId: scope.campaignId,
              hook: angle.hook,
              organizationId: scope.tenant.organizationId,
              position: offset + index,
              title: angle.title,
            },
          })
          angleIds.push(created.id)
        }
        await transaction.campaignPost.createMany({
          data: posts.map((post) => ({
            angleId: angleIds[post.angleIndex],
            callToAction: post.callToAction ?? null,
            campaignId: scope.campaignId,
            channel: post.channel,
            copy: post.copy,
            organizationId: scope.tenant.organizationId,
          })),
        })
        await appendAuditLog(transaction, {
          action: 'product.campaign_copy_generated',
          actor: getAuditActor(scope.tenant.principal),
          entityId: scope.campaignId,
          entityType: 'campaign',
          metadata: { angleCount: angles.length, postCount: posts.length },
          organizationId: scope.tenant.organizationId,
          requestId: scope.tenant.requestId,
        })
      })
      record.savedPosts = posts.length
      return { ok: true as const, savedAngles: angles.length, savedPosts: posts.length }
    },
  })

  return { captureProductPage, createProductShot, saveCampaignCopy }
}
