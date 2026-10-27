'use client'

import type { useTRPCClient } from '@/lib/trpc/react'

type Client = ReturnType<typeof useTRPCClient>

export type PolledRun = Awaited<ReturnType<Client['launch']['run']['query']>>['run']

const POLL_MS = 2_000
const GIVE_UP_MS = 25 * 60_000

/**
 * Wait for a background launch run (spec, plan, produce, revision) to finish.
 * Resolves with the finished run; rejects only if polling itself keeps failing.
 */
export async function waitForLaunchRun(
  client: Client,
  runId: string,
  onTick?: (run: PolledRun) => void
): Promise<PolledRun> {
  const started = Date.now()
  let failures = 0
  while (Date.now() - started < GIVE_UP_MS) {
    try {
      const { run } = await client.launch.run.query({ runId })
      failures = 0
      onTick?.(run)
      if (run.status !== 'RUNNING') return run
    } catch (error) {
      failures += 1
      if (failures >= 5) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error('This is taking longer than expected. Refresh to check on it.')
}
