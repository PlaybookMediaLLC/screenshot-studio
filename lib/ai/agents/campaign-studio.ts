import 'server-only'

import { generateText, stepCountIs } from 'ai'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { assertPublicCaptureUrl } from '@/lib/screenshot-service'
import { CampaignError } from '@/lib/tenant/campaigns'
import { models, normalizeTokenUsage } from '../models'
import { CAMPAIGN_STUDIO_INSTRUCTIONS, formatCampaignStudioBrief } from '../prompts/campaign-studio'
import { type CampaignStudioRecord, createCampaignStudioTools } from '../tools/campaign-studio'

const MAX_STEPS = 14

export function isCampaignStudioConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

/** Registered product and release URLs the agent may capture, in priority order. */
function getCaptureUrls(urls: Array<string | null | undefined>): string[] {
  const allowed: string[] = []
  for (const url of urls) {
    if (!url || allowed.includes(url)) continue
    try {
      assertPublicCaptureUrl(url)
      allowed.push(url)
    } catch {
      // Private or malformed URLs are skipped, never captured.
    }
  }
  return allowed.slice(0, 5)
}

/**
 * Generate a launch kit for one campaign: product captures, composited
 * product shots, and draft posts, all attached to the campaign for review.
 * Runs inside the caller's tenant context, and every write is audited.
 */
export async function runCampaignStudio(tenant: TenantContext, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    include: {
      productSurface: { select: { environment: true, name: true, url: true } },
      release: true,
    },
    where: { id: campaignId, organizationId: tenant.organizationId },
  })
  if (!campaign) throw new CampaignError('Campaign not found.', 404)
  if (!campaign.release) {
    throw new CampaignError('Link a release brief before generating a launch kit.', 409)
  }
  const sourceUrls = Array.isArray(campaign.release.sourceUrls)
    ? campaign.release.sourceUrls.filter((url): url is string => typeof url === 'string')
    : []
  const captureUrls = getCaptureUrls([campaign.productSurface?.url, ...sourceUrls])
  if (captureUrls.length === 0) {
    throw new CampaignError('Connect a public product URL before generating a launch kit.', 409)
  }

  const record: CampaignStudioRecord = { assets: [], savedPosts: 0 }
  const modelId = models.modelId('deep')
  const result = await generateText({
    model: models.languageModel('deep'),
    prompt: formatCampaignStudioBrief({
      audience: campaign.release.audience ?? campaign.audience,
      benefitStatement: campaign.release.benefitStatement,
      campaignName: campaign.name,
      description: campaign.release.description,
      objective: campaign.objective,
      product: campaign.productSurface,
      sourceUrls,
      title: campaign.release.title,
    }),
    stopWhen: stepCountIs(MAX_STEPS),
    system: CAMPAIGN_STUDIO_INSTRUCTIONS,
    tools: createCampaignStudioTools(
      { allowedUrls: captureUrls as [string, ...string[]], campaignId: campaign.id, tenant },
      record
    ),
  })

  const usage = normalizeTokenUsage(result.totalUsage)
  await prisma.$transaction((transaction) =>
    appendAuditLog(transaction, {
      action: 'product.campaign_generated',
      actor: getAuditActor(tenant.principal),
      entityId: campaign.id,
      entityType: 'campaign',
      metadata: {
        assetCount: record.assets.length,
        // Not "...Tokens": the audit sanitizer redacts any key matching /token/.
        inputUsage: usage.inputTokens,
        modelId,
        outputUsage: usage.outputTokens,
        postCount: record.savedPosts,
        steps: result.steps.length,
      },
      organizationId: tenant.organizationId,
      requestId: tenant.requestId,
    })
  )
  return {
    assets: record.assets,
    postCount: record.savedPosts,
    summary: result.text,
  }
}
