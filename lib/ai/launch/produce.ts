import 'server-only'

import { generateText, stepCountIs } from 'ai'
import type { TenantContext } from '@/lib/auth/access'
import {
  createDesignRenderer,
  type DesignRenderer,
  isDesignRendererReady,
} from '@/lib/design/renderer'
import { brandGradient } from '@/lib/launch/brand'
import { productionBudget } from '@/lib/launch/budget'
import { listSpecClaims } from '@/lib/launch/spec-schema'
import {
  getActiveBrand,
  getWorkingPlan,
  getWorkingSpec,
  LaunchError,
  loadLaunchCampaign,
  loadPreferenceExamples,
  releaseSourceUrls,
} from '@/lib/launch/store'
import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { models, normalizeTokenUsage } from '../models'
import { type CampaignStudioRecord, createCampaignStudioTools } from '../tools/campaign-studio'
import { createDesignStudioTools } from '../tools/design-studio'
import { captureUrlsFor, formatBrandKit, formatPlanForStages, formatSpecForStages } from './context'
import { writeLaunchCopy } from './copy'
import { critiqueRender } from './critique'
import { VISUALS_FALLBACK_INSTRUCTIONS, VISUALS_INSTRUCTIONS } from './prompts'

/**
 * Produce the campaign from its plan: on-brand visuals (rendered in the
 * editor and self-reviewed, or product shots when the renderer is down) and
 * channel copy, side by side. Works from the approved spec and plan when they
 * exist, else the latest drafts. Whatever finished is kept if the other half
 * fails.
 */
export async function produceCampaign(tenant: TenantContext, campaignId: string) {
  const campaign = await loadLaunchCampaign(tenant.organizationId, campaignId)
  if (!campaign.release) throw new LaunchError('Link a release brief first.', 409)
  const [spec, plan] = await Promise.all([
    getWorkingSpec(tenant.organizationId, campaign.release.id),
    getWorkingPlan(tenant.organizationId, campaignId),
  ])
  if (!spec) throw new LaunchError('Draft the spec first.', 409)
  if (!plan) throw new LaunchError('Plan the campaign first.', 409)
  const captureUrls = captureUrlsFor([campaign.productSurface?.url, ...releaseSourceUrls(campaign)])
  if (captureUrls.length === 0) {
    throw new LaunchError('Connect a public product URL before producing visuals.', 409)
  }
  const [brand, examples] = await Promise.all([
    getActiveBrand(tenant.organizationId),
    loadPreferenceExamples(tenant.organizationId),
  ])

  const record: CampaignStudioRecord = { assets: [], savedPosts: 0 }
  const scope = {
    allowedUrls: captureUrls as [string, ...string[]],
    campaignId,
    planVersion: plan.version,
    tenant,
  }
  const budget = productionBudget(plan.content)
  const baseTools = createCampaignStudioTools(scope, record, budget)
  const designMode = await isDesignRendererReady()
  let renderer: Promise<DesignRenderer> | null = null
  const getRenderer = () => (renderer ??= createDesignRenderer())
  const claims = listSpecClaims(spec.content).map((claim) => claim.text)
  const tools = designMode
    ? {
        captureProductPage: baseTools.captureProductPage,
        createProductShot: baseTools.createProductShot,
        ...createDesignStudioTools(scope, record, getRenderer, {
          brand: brand.kit,
          critique: ({ previewJpegBase64, texts }) =>
            critiqueRender({ brand: brand.kit, claims, previewJpegBase64, texts }),
          limits: budget,
        }),
      }
    : {
        captureProductPage: baseTools.captureProductPage,
        createProductShot: baseTools.createProductShot,
      }

  const prompt = [
    formatSpecForStages(spec.content, spec.version),
    formatPlanForStages(plan.content, plan.version),
    formatBrandKit(brand.kit) ??
      'No brand kit is set. Choose one background family and text color and keep them across the set.',
    !designMode && brand.kit
      ? `Product shot colors: background gradient from ${brand.kit.background} to ${brand.kit.accent} (${brandGradient(brand.kit)}), text ${brand.kit.foreground}.`
      : null,
    `<capture_urls>\n${captureUrls.join('\n')}\n</capture_urls>`,
    'Produce every asset in the plan.',
  ]
    .filter(Boolean)
    .join('\n\n')

  // The copy works from the spec and plan, not the visuals, so both run at once.
  const [visualsRun, copyRun] = await Promise.allSettled([
    generateText({
      model: models.languageModel('deep'),
      prompt,
      stopWhen: stepCountIs(designMode ? budget.steps : Math.ceil(budget.steps / 2)),
      system: designMode ? VISUALS_INSTRUCTIONS : VISUALS_FALLBACK_INSTRUCTIONS,
      tools,
    }).finally(async () => {
      if (renderer) await (await renderer).close().catch(() => undefined)
    }),
    writeLaunchCopy(tenant, { brand, campaign, examples, plan, spec }),
  ])
  if (visualsRun.status === 'rejected') throw visualsRun.reason
  if (copyRun.status === 'rejected') throw copyRun.reason
  const visuals = visualsRun.value
  const copy = copyRun.value
  const usage = normalizeTokenUsage(visuals.totalUsage)
  await prisma.$transaction((transaction) =>
    appendAuditLog(transaction, {
      action: 'product.campaign_produced',
      actor: getAuditActor(tenant.principal),
      entityId: campaignId,
      entityType: 'campaign',
      metadata: {
        assetCount: record.assets.length,
        designMode,
        inputUsage: usage.inputTokens,
        modelId: models.modelId('deep'),
        outputUsage: usage.outputTokens,
        planVersion: plan.version,
        postCount: copy.postCount,
        specVersion: spec.version,
        steps: visuals.steps.length,
      },
      organizationId: tenant.organizationId,
      requestId: tenant.requestId,
    })
  )
  return {
    assetCount: record.assets.length,
    designMode,
    postCount: copy.postCount,
    summary: visuals.text,
  }
}
