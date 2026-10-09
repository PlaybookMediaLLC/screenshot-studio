import { DocumentValidationIcon } from 'hugeicons-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SpecEditor } from '@/components/launch/spec/SpecEditor'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { EmptyState } from '@/components/platform-ui'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { hasPermission } from '@/lib/auth/permissions'
import { latestLaunchRuns } from '@/lib/launch/runs'
import { getReleaseSpecs, getSpecById } from '@/lib/launch/store'
import { getCampaign } from '@/lib/tenant/campaigns'
import { requireCampaignPageAccess } from '../../page-access'

export const metadata: Metadata = { title: 'Campaign spec | Screenshot Studio' }

type SpecPageProps = {
  params: Promise<{ campaignId: string; locale: string }>
  searchParams: Promise<{ version?: string | string[] }>
}

export default async function SpecPage({ params, searchParams }: SpecPageProps) {
  const [{ campaignId, locale }, { version }] = await Promise.all([params, searchParams])
  const access = await requireCampaignPageAccess(locale)
  const organizationId = access.organization.id
  const campaign = await getCampaign(organizationId, campaignId)
  if (!campaign) notFound()
  const release = campaign.release
  if (!release) {
    return (
      <EmptyState
        action={
          <ButtonLink href={`/campaigns/${campaign.id}`} variant="outline">
            Back to overview
          </ButtonLink>
        }
        description="The spec is drafted from the release brief and its sources."
        icon={DocumentValidationIcon}
        title="Link a release brief first"
      />
    )
  }

  const [specs, runs] = await Promise.all([
    getReleaseSpecs(organizationId, release.id),
    latestLaunchRuns(organizationId, campaign.id),
  ])
  // An earlier version by id; only ids listed for this release are accepted.
  const viewed =
    typeof version === 'string' &&
    version !== specs.latest?.id &&
    specs.versions.some((option) => option.id === version)
      ? await getSpecById(organizationId, version)
      : specs.latest
  const run = runs.spec
  // A failure matters until a newer version is saved.
  const runFailed =
    run?.status === 'FAILED' && (!specs.latest || specs.latest.createdAt < run.startedAt)

  return (
    <SpecEditor
      activeRunId={run?.status === 'RUNNING' ? run.id : null}
      aiConfigured={isCampaignStudioConfigured()}
      brief={[
        release.title,
        release.benefitStatement,
        release.description,
        release.audience && `Audience: ${release.audience}`,
      ]
        .filter(Boolean)
        .join('\n\n')}
      campaignId={campaign.id}
      canApprove={hasPermission(access.role, 'release:approve')}
      canEdit={hasPermission(access.role, 'release:create')}
      lastRunError={runFailed ? (run.error ?? 'The last draft failed.') : null}
      latestId={specs.latest?.id ?? null}
      spec={
        viewed && {
          changeSummary: viewed.changeSummary,
          content: viewed.content,
          createdAt: viewed.createdAt.toISOString(),
          id: viewed.id,
          origin: viewed.origin,
          // Older snapshots may predate fields the schema defaults.
          sources: viewed.sources.map((source) => ({
            ...source,
            flags: source.flags ?? [],
            sections: source.sections ?? [],
            statusReason: source.statusReason ?? '',
          })),
          status: viewed.status,
          version: viewed.version,
        }
      }
      versions={specs.versions.map((option) => ({
        ...option,
        createdAt: option.createdAt.toISOString(),
      }))}
    />
  )
}
