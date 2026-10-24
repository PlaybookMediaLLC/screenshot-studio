import { connectionsForChannel } from '@/lib/launch/schedule'
import type { CampaignPlanContent, LaunchChannel } from '@/lib/launch/spec-schema'

/**
 * A fixed shape for a plan: exactly `timelineItems` posts, on `channels`
 * only. Onboarding's first campaign asks for seven posts on the channels a
 * founder can schedule (docs/rfcs/048-core-workflows.md, Workflow 1); other
 * campaigns plan without a target. Pure, so it is testable.
 */
export type PlanTarget = { channels: LaunchChannel[]; timelineItems: number }

/** How many posts onboarding's first campaign plans. */
export const ONBOARDING_POST_COUNT = 7

/** The schedulable channels a first campaign uses, in order. */
const FIRST_CAMPAIGN_CHANNELS: readonly LaunchChannel[] = ['x', 'linkedin']

/**
 * The first-campaign channels the workspace has connected, or all of them
 * when none is connected yet (connecting comes after approval).
 */
export function targetChannels(
  connections: ReadonlyArray<{ platform: string; status: string }>
): LaunchChannel[] {
  const connected = FIRST_CAMPAIGN_CHANNELS.filter(
    (channel) => (connectionsForChannel(channel, connections) ?? []).length > 0
  )
  return connected.length > 0 ? connected : [...FIRST_CAMPAIGN_CHANNELS]
}

/** Problems with a plan against its target: the wrong post count or a channel outside it. */
export function planTargetIssues(plan: CampaignPlanContent, target: PlanTarget): string[] {
  const issues: string[] = []
  const allowed = new Set<string>(target.channels)
  const list = target.channels.join(', ')
  if (plan.timeline.length !== target.timelineItems) {
    issues.push(
      `The timeline has ${plan.timeline.length} items; plan exactly ${target.timelineItems}.`
    )
  }
  for (const entry of plan.channels) {
    if (!allowed.has(entry.channel)) issues.push(`Remove ${entry.channel}; use only ${list}.`)
  }
  plan.timeline.forEach((item, index) => {
    if (!allowed.has(item.channel)) {
      issues.push(`Timeline item ${index + 1} posts to ${item.channel}; use only ${list}.`)
    }
  })
  return issues
}
