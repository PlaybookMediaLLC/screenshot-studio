import { Note01Icon } from 'hugeicons-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { CopyBoard, type CopyChannel, type CopyPost } from '@/components/launch/copy/CopyBoard'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { EmptyState, Section } from '@/components/platform-ui'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { hasPermission } from '@/lib/auth/permissions'
import {
  LAUNCH_CHANNEL_LABELS,
  LAUNCH_CHANNELS,
  type LaunchChannel,
  PLAN_PHASE_LABELS,
  PLAN_PHASES,
  type PlanPhase,
  resolveClaimRef,
} from '@/lib/launch/spec-schema'
import { getCampaignPlans, getReleaseSpecs } from '@/lib/launch/store'
import { getCampaign } from '@/lib/tenant/campaigns'
import { requireCampaignPageAccess } from '../../page-access'

export const metadata: Metadata = { title: 'Campaign copy | Screenshot Studio' }

type CampaignCopyPageProps = {
  params: Promise<{ campaignId: string; locale: string }>
}

const claimsSchema = z.array(z.object({ ref: z.string(), text: z.string() })).catch([])

function phaseRank(phase: string | null): number {
  const index = PLAN_PHASES.indexOf(phase as PlanPhase)
  return index === -1 ? PLAN_PHASES.length : index
}

/** "G2" → 2; posts without an angle go last. */
function angleRank(key: string | null): number {
  return Number(key?.slice(1)) || 99
}

/** The copy board: posts by channel with their provenance and review actions. */
export default async function CampaignCopyPage({ params }: CampaignCopyPageProps) {
  const { campaignId, locale } = await params
  const access = await requireCampaignPageAccess(locale)
  const organizationId = access.organization.id
  // Scoped to the active workspace: another workspace's id is a 404.
  const campaign = await getCampaign(organizationId, campaignId)
  if (!campaign) notFound()

  if (campaign.posts.length === 0) {
    return (
      <EmptyState
        action={
          <ButtonLink href={`/campaigns/${campaign.id}/assets`} variant="outline">
            Produce the campaign
          </ButtonLink>
        }
        description="Producing the campaign writes posts for each channel in the plan, citing the spec claims they rely on."
        icon={Note01Icon}
        title="No copy yet"
      />
    )
  }

  const [plans, specs] = await Promise.all([
    getCampaignPlans(organizationId, campaign.id),
    campaign.release ? getReleaseSpecs(organizationId, campaign.release.id) : null,
  ])
  const workingPlan = plans.approved ?? plans.latest
  const plan = workingPlan?.content
  const spec = (specs?.approved ?? specs?.latest)?.content
  const planAngles = new Map(plan?.angles.map((angle) => [angle.key, angle.title]))
  // Posts from before the plan carry a content angle instead.
  const contentAngles = new Map(campaign.angles.map((angle) => [angle.id, angle.title]))

  const posts = [...campaign.posts]
    .sort(
      (a, b) =>
        phaseRank(a.phase) - phaseRank(b.phase) ||
        angleRank(a.planItemKey) - angleRank(b.planItemKey) ||
        // Each production run adds posts; the newest draft comes first.
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    .map((post): CopyPost => {
      const angleTitle = post.planItemKey ? planAngles.get(post.planItemKey) : undefined
      return {
        angle: angleTitle
          ? `${post.planItemKey} · ${angleTitle}`
          : ((post.angleId && contentAngles.get(post.angleId)) ?? post.planItemKey),
        callToAction: post.callToAction,
        channel: post.channel,
        claims: claimsSchema.parse(post.claims).map((claim) => ({
          ...claim,
          // Without a spec there is nothing to check against.
          current: !spec || resolveClaimRef(spec, claim.ref) !== null,
        })),
        copy: post.copy,
        fromEarlierPlan:
          workingPlan !== null &&
          post.planVersion !== null &&
          post.planVersion !== workingPlan.version,
        id: post.id,
        phase: PLAN_PHASE_LABELS[post.phase as PlanPhase] ?? null,
        reviewNote: post.reviewNote,
        status: post.status,
        title: post.title,
      }
    })

  const planChannels = new Map(plan?.channels.map((channel) => [channel.channel, channel.role]))
  const channels = [
    ...new Set([
      ...LAUNCH_CHANNELS.filter(
        (channel) => planChannels.has(channel) || posts.some((post) => post.channel === channel)
      ),
      // Channels outside the launch set, from earlier generations.
      ...posts.map((post) => post.channel),
    ]),
  ].map((channel): CopyChannel => ({
    label:
      LAUNCH_CHANNEL_LABELS[channel as LaunchChannel] ??
      channel.charAt(0).toUpperCase() + channel.slice(1),
    role: planChannels.get(channel as LaunchChannel) ?? null,
    value: channel,
  }))

  return (
    <Section
      description={`${posts.length} ${posts.length === 1 ? 'post' : 'posts'} across ${channels.length} ${channels.length === 1 ? 'channel' : 'channels'}. Each lists the spec claims it relies on.`}
      title="Copy"
    >
      <CopyBoard
        channels={channels}
        permissions={{
          aiConfigured: isCampaignStudioConfigured(),
          campaignId: campaign.id,
          canApprove: hasPermission(access.role, 'release:approve'),
          canEdit: hasPermission(access.role, 'release:create'),
        }}
        posts={posts}
      />
    </Section>
  )
}
