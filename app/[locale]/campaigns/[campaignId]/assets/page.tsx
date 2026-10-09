import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  AssetBoard,
  type BoardCapture,
  type BoardVisual,
} from '@/components/launch/assets/AssetBoard'
import { ProduceControl } from '@/components/launch/assets/ProduceControl'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { critiqueSchema } from '@/lib/ai/launch/critique'
import { hasPermission } from '@/lib/auth/permissions'
import { latestLaunchRuns } from '@/lib/launch/runs'
import { getCampaignPlans } from '@/lib/launch/store'
import { createTenantDownloadUrl } from '@/lib/storage/client'
import { getCampaign } from '@/lib/tenant/campaigns'
import { listCampaignDesigns } from '@/lib/tenant/designs'
import { requireCampaignPageAccess } from '../../page-access'

export const metadata: Metadata = { title: 'Campaign assets | Screenshot Studio' }

type CampaignAssetsPageProps = {
  params: Promise<{ campaignId: string; locale: string }>
}

/** Signed for long enough to review the page; a refresh re-signs. */
async function signAssetUrl(organizationId: string, objectKey: string): Promise<string | null> {
  try {
    return await createTenantDownloadUrl({ expiresIn: 900, objectKey, organizationId })
  } catch {
    return null
  }
}

/** The asset board: every plan asset with the designs and product shots made for it. */
export default async function CampaignAssetsPage({ params }: CampaignAssetsPageProps) {
  const { campaignId, locale } = await params
  const access = await requireCampaignPageAccess(locale)
  const organizationId = access.organization.id
  // Scoped to the active workspace: another workspace's id is a 404.
  const campaign = await getCampaign(organizationId, campaignId)
  if (!campaign) notFound()
  const [designs, plans, runs] = await Promise.all([
    listCampaignDesigns(organizationId, campaign.id),
    getCampaignPlans(organizationId, campaign.id),
    latestLaunchRuns(organizationId, campaign.id),
  ])
  const plan = plans.approved ?? plans.latest
  const sign = (objectKey: string) => signAssetUrl(organizationId, objectKey)
  const captionByAsset = new Map(campaign.assets.map((link) => [link.assetId, link.caption]))

  const [visuals, captures] = await Promise.all([
    Promise.all([
      ...designs.map(async (design): Promise<BoardVisual> => ({
        caption: design.renderedAsset
          ? (captionByAsset.get(design.renderedAsset.id) ?? null)
          : null,
        createdAt: design.createdAt.getTime(),
        critique: critiqueSchema.safeParse(design.critique).data ?? null,
        designId: design.id,
        editHref: `/?design=${design.id}`,
        fromEarlierPlan:
          plan && design.planVersion !== null ? design.planVersion !== plan.version : undefined,
        id: design.id,
        image: design.renderedAsset && {
          height: design.renderedAsset.height,
          url: await sign(design.renderedAsset.objectKey),
          width: design.renderedAsset.width,
        },
        name: design.name,
        planAssetKey: design.planAssetKey,
        variantLabel: design.variantLabel,
      })),
      ...campaign.assets
        .filter((link) => link.kind === 'product-shot')
        .map(async (link): Promise<BoardVisual> => ({
          caption: link.caption,
          createdAt: link.createdAt.getTime(),
          critique: null,
          designId: null,
          editHref: `/?asset=${link.asset.id}`,
          fromEarlierPlan:
            plan && link.planVersion !== null ? link.planVersion !== plan.version : undefined,
          id: link.id,
          image: {
            height: link.asset.height,
            url: await sign(link.asset.objectKey),
            width: link.asset.width,
          },
          name: 'Product shot',
          planAssetKey: link.planAssetKey,
          variantLabel: link.variantLabel,
        })),
    ]),
    Promise.all(
      campaign.assets
        .filter((link) => link.kind.startsWith('capture-'))
        .map(async (link): Promise<BoardCapture> => ({
          caption: link.caption,
          device: link.kind === 'capture-mobile' ? 'Mobile' : 'Desktop',
          height: link.asset.height,
          id: link.id,
          url: await sign(link.asset.objectKey),
          width: link.asset.width,
        }))
    ),
  ])

  const canEdit = hasPermission(access.role, 'release:create')
  const aiConfigured = isCampaignStudioConfigured()
  const produce = runs.produce

  return (
    <div className="flex flex-col gap-10">
      {canEdit ? (
        <ProduceControl
          activeRun={
            produce?.status === 'RUNNING'
              ? { id: produce.id, startedAt: produce.startedAt.toISOString() }
              : null
          }
          blocker={!plan ? 'plan' : !aiConfigured ? 'ai' : null}
          campaignId={campaign.id}
          lastError={produce?.status === 'FAILED' ? produce.error : null}
        />
      ) : null}
      <AssetBoard
        captures={captures}
        options={{ aiConfigured, campaignId: campaign.id, canEdit }}
        plan={plan?.content ?? null}
        planCreatedAt={plan?.createdAt.getTime() ?? null}
        visuals={visuals}
      />
    </div>
  )
}
