'use client'

import { RunButton } from '@/components/launch/RunButton'
import { useTRPCClient } from '@/lib/trpc/react'

export function PlanCampaignAction({
  campaignId,
  activeRunId,
}: {
  campaignId: string
  activeRunId: string | null
}) {
  const client = useTRPCClient()
  return (
    <RunButton
      activeRunId={activeRunId}
      label="Plan campaign"
      runningLabel="Planning…"
      doneMessage="Plan drafted"
      onStart={() => client.launch.plan.generate.mutate({ campaignId })}
    />
  )
}
