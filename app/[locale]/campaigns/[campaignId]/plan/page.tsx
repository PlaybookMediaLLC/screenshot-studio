import { DocumentValidationIcon } from 'hugeicons-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PlanView } from '@/components/launch/plan/PlanView'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { EmptyState } from '@/components/platform-ui'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { hasPermission } from '@/lib/auth/permissions'
import { latestLaunchRuns } from '@/lib/launch/runs'
import { getCampaignPlans, getPlanById, getReleaseSpecs, getSpecById } from '@/lib/launch/store'
import { getCampaign } from '@/lib/tenant/campaigns'
import { requireCampaignPageAccess } from '../../page-access'

export const metadata: Metadata = { title: 'Campaign plan | Screenshot Studio' }

type PlanPageProps = {
  params: Promise<{ campaignId: string; locale: string }>
  searchParams: Promise<{ version?: string | string[] }>
}

export default async function PlanPage({ params, searchParams }: PlanPageProps) {
  const [{ campaignId, locale }, { version }] = await Promise.all([params, searchParams])
  const access = await requireCampaignPageAccess(locale)
  const organizationId = access.organization.id
  const campaign = await getCampaign(organizationId, campaignId)
  if (!campaign) notFound()
  const [plans, specs, runs] = await Promise.all([
    getCampaignPlans(organizationId, campaign.id),
    campaign.release ? getReleaseSpecs(organizationId, campaign.release.id) : null,
    latestLaunchRuns(organizationId, campaign.id),
  ])
  const workingSpec = specs ? (specs.approved ?? specs.latest) : null
  if (!workingSpec) {
    return (
      <EmptyState
        action={<ButtonLink href={`/campaigns/${campaign.id}/spec`}>Open the spec</ButtonLink>}
        description="The plan is built from the release spec: its capabilities, messaging, and proof."
        icon={DocumentValidationIcon}
        title="Draft the spec first"
      />
    )
  }

  // An earlier version by id; only ids listed for this campaign are accepted.
  const viewed =
    typeof version === 'string' &&
    version !== plans.latest?.id &&
    plans.versions.some((option) => option.id === version)
      ? await getPlanById(organizationId, campaign.id, version)
      : plans.latest
  // Claim references resolve against the spec version the plan was built from.
  const planSpec =
    !viewed?.specId || viewed.specId === workingSpec.id
      ? workingSpec
      : await getSpecById(organizationId, viewed.specId).catch(() => null)
  const run = runs.plan
  const runFailed =
    run?.status === 'FAILED' && (!plans.latest || plans.latest.createdAt < run.startedAt)

  return (
    <PlanView
      activeRunId={run?.status === 'RUNNING' ? run.id : null}
      aiConfigured={isCampaignStudioConfigured()}
      campaignId={campaign.id}
      canApprove={hasPermission(access.role, 'release:approve')}
      canEdit={hasPermission(access.role, 'release:create')}
      hasApproved={Boolean(plans.approved)}
      lastRunError={runFailed ? (run.error ?? 'The last plan failed.') : null}
      latestId={plans.latest?.id ?? null}
      plan={
        viewed && {
          changeSummary: viewed.changeSummary,
          content: viewed.content,
          createdAt: viewed.createdAt.toISOString(),
          id: viewed.id,
          origin: viewed.origin,
          specId: viewed.specId,
          status: viewed.status,
          version: viewed.version,
        }
      }
      spec={planSpec && { content: planSpec.content, id: planSpec.id, version: planSpec.version }}
      versions={plans.versions.map((option) => ({
        ...option,
        createdAt: option.createdAt.toISOString(),
      }))}
      workingSpec={{ id: workingSpec.id, version: workingSpec.version }}
    />
  )
}
