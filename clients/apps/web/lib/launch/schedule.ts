import type { CampaignPlanContent } from './spec-schema'

/**
 * The connection platforms that publish each post channel. Mirrors
 * campaignChannelPlatforms in server/internal/product/campaign_schedule.go;
 * other channels cannot be scheduled.
 */
const CHANNEL_PLATFORMS: Partial<Record<string, readonly string[]>> = {
  instagram: ['instagram', 'instagram-standalone'],
  linkedin: ['linkedin'],
  x: ['x'],
}

/**
 * Active connections that can publish a post on `channel`, or null when the
 * channel cannot be scheduled at all.
 */
export function connectionsForChannel<T extends { platform: string; status: string }>(
  channel: string,
  connections: readonly T[]
): T[] | null {
  const platforms = CHANNEL_PLATFORMS[channel]
  if (!platforms) return null
  return connections.filter(
    (connection) => connection.status === 'ACTIVE' && platforms.includes(connection.platform)
  )
}

/**
 * The approved visuals to offer for a post: those the plan's timeline pairs
 * with the post's angle, channel, and phase. Falls back to every approved
 * visual of the campaign when the plan pairs none of them.
 */
export function visualChoices<T extends { planAssetKey: string | null }>(
  post: { channel: string; phase: string | null; planItemKey: string | null },
  plan: Pick<CampaignPlanContent, 'timeline'> | null | undefined,
  approved: readonly T[]
): T[] {
  const keys = new Set(
    plan?.timeline
      .filter(
        (item) =>
          item.angleKey === post.planItemKey &&
          item.channel === post.channel &&
          (post.phase === null || item.phase === post.phase)
      )
      .flatMap((item) => item.assetKeys)
  )
  const paired = approved.filter(
    (visual) => visual.planAssetKey !== null && keys.has(visual.planAssetKey)
  )
  return paired.length > 0 ? paired : [...approved]
}
