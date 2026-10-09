import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { formatTeamPreferences } from '@/lib/launch/preferences-format'
import { campaignPlanSchema, validatePlanReferences } from '@/lib/launch/spec-schema'
import {
  getActiveBrand,
  getWorkingSpec,
  LaunchError,
  loadLaunchCampaign,
  loadPreferenceExamples,
  releaseSourceUrls,
  savePlanVersion,
  type StoredPlan,
} from '@/lib/launch/store'
import { defuseMarkup } from '@/lib/launch/sanitize'
import {
  captureUrlsFor,
  formatBrandKit,
  formatBrandVoice,
  formatCaptureTargets,
  formatSpecForStages,
} from './context'
import { PLAN_INSTRUCTIONS } from './prompts'
import { runSubmitStage, stageMetadata } from './run'

/** Plan the campaign from the release's approved (or latest) spec. */
export async function draftCampaignPlan(
  tenant: TenantContext,
  campaignId: string
): Promise<StoredPlan> {
  const campaign = await loadLaunchCampaign(tenant.organizationId, campaignId)
  if (!campaign.release) throw new LaunchError('Link a release brief before planning.', 409)
  const spec = await getWorkingSpec(tenant.organizationId, campaign.release.id)
  if (!spec) throw new LaunchError('Draft the spec before planning the campaign.', 409)

  const [brand, examples] = await Promise.all([
    getActiveBrand(tenant.organizationId),
    loadPreferenceExamples(tenant.organizationId),
  ])
  const captureUrls = captureUrlsFor([campaign.productSurface?.url, ...releaseSourceUrls(campaign)])
  const prompt = [
    formatSpecForStages(spec.content, spec.version),
    [
      '<campaign>',
      `Name: ${defuseMarkup(campaign.name)}`,
      `Objective: ${defuseMarkup(campaign.objective)}`,
      campaign.productSurface
        ? `Product: ${defuseMarkup(campaign.productSurface.name)} (${campaign.productSurface.url})`
        : null,
      '</campaign>',
    ]
      .filter(Boolean)
      .join('\n'),
    formatCaptureTargets(captureUrls, spec.sources),
    formatBrandVoice(brand),
    formatBrandKit(brand.kit),
    formatTeamPreferences(examples),
    'Plan the launch campaign.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const run = await runSubmitStage({
    description:
      'Submit the complete campaign plan. Angles cite spec claim refs; assets and timeline ' +
      'items reference angle and asset keys; capture hints use registered URLs only.',
    maxSteps: 6,
    prompt,
    role: 'deep',
    schema: campaignPlanSchema,
    system: PLAN_INSTRUCTIONS,
    toolName: 'submitPlan',
    validate: (plan) => validatePlanReferences(plan, spec.content, captureUrls),
  })
  if (!run.value) throw new LaunchError('The plan could not be drafted. Try again.', 503)
  return savePlanVersion(tenant, {
    campaignId,
    changeSummary: `Planned from spec v${spec.version}${spec.status === 'APPROVED' ? '' : ' (draft)'}`,
    content: run.value,
    metadata: { ...stageMetadata(run), specVersion: spec.version },
    modelId: run.modelId,
    origin: 'ai',
    specId: spec.id,
  })
}
