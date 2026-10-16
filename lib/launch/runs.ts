import 'server-only'

import { after } from 'next/server'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { withAiCredits } from '@/lib/ai/metering'
import { backendSDK, withDates } from '@/lib/backend/sdk'
import { HEARTBEAT_MS, isRunStale } from './run-lease'
import { LaunchError } from './store'

/**
 * Background runs for the launch pipeline's AI actions.
 *
 * Drafting a spec takes about a minute and producing a campaign several, longer
 * than a request should stay open behind proxies. A run is recorded, the work
 * continues after the response (`after`), and the UI polls the run. One run of
 * each kind per campaign at a time. The work heartbeats while it runs; a run
 * whose heartbeat lapsed (the server restarted mid-run) counts as failed, the
 * same window the backend applies when it checks for an active run. A
 * cancelled run stops its work at the next heartbeat.
 */

export const LAUNCH_RUN_KINDS = ['spec', 'plan', 'produce', 'revision'] as const
export type LaunchRunKind = (typeof LAUNCH_RUN_KINDS)[number]

export type LaunchRunView = {
  campaignId: string
  error: string | null
  finishedAt: Date | null
  heartbeatAt: Date | null
  id: string
  kind: string
  resultId: string | null
  startedAt: Date
  status: 'FAILED' | 'RUNNING' | 'SUCCEEDED'
  summary: string | null
}

function view(run: LaunchRunView): LaunchRunView {
  if (run.status === 'RUNNING' && isRunStale(run)) {
    return { ...run, error: 'The run stopped before it finished. Try again.', status: 'FAILED' }
  }
  return run
}

/** Provider responses a retry will not fix, said so plainly. */
const PROVIDER_FAILURES: Record<number, string> = {
  401: 'The AI provider rejected its credentials. An administrator needs to check the AI configuration.',
  402: 'The AI provider account is out of credit. An administrator needs to top it up.',
  403: 'The AI provider refused the request. An administrator needs to check the AI configuration.',
  429: 'The AI provider is rate limiting requests. Try again in a minute.',
}

function failureMessage(error: unknown): string {
  if (error instanceof LaunchError) return error.message
  // The backend's not-found and conflict messages are written for reviewers.
  if (error instanceof BackendSDKError && (error.status === 404 || error.status === 409)) {
    return error.message
  }
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof status === 'number' && PROVIDER_FAILURES[status]) return PROVIDER_FAILURES[status]
  if (error instanceof Error && /quota|rate|limit/i.test(error.message)) return error.message
  return 'The AI step failed. Try again in a moment.'
}

export async function startLaunchRun(
  tenant: TenantContext,
  input: {
    campaignId: string
    kind: LaunchRunKind
    /** Stop when `signal` aborts: the run was cancelled or its lease lapsed. */
    work: (signal: AbortSignal) => Promise<{ resultId?: string | null; summary?: string | null }>
  }
): Promise<LaunchRunView> {
  const backend = backendSDK(tenant)
  // The backend refuses a second active run of the same kind (revisions excepted).
  const run = withDates(await backend.startLaunchRun(input.campaignId, input.kind))
  after(async () => {
    const abort = new AbortController()
    const heartbeat = setInterval(() => {
      backend
        .heartbeatLaunchRun(run.id)
        .then(({ running }) => {
          if (!running) abort.abort()
        })
        // A missed beat is retried on the next tick; the lease outlasts several.
        .catch(() => undefined)
    }, HEARTBEAT_MS)
    try {
      const result = await withAiCredits(tenant, () => input.work(abort.signal))
      await backend.finishLaunchRun(run.id, {
        resultId: result.resultId ?? null,
        status: 'SUCCEEDED',
        summary: result.summary?.slice(0, 2_000) ?? null,
      })
    } catch (error) {
      console.error('Launch run failed.', {
        kind: input.kind,
        reason: error instanceof Error ? error.message : 'unknown',
        runId: run.id,
      })
      // A cancelled or expired run is already finished; the backend ignores this.
      await backend
        .finishLaunchRun(run.id, { error: failureMessage(error), status: 'FAILED' })
        .catch(() => undefined)
    } finally {
      clearInterval(heartbeat)
    }
  })
  return view(run)
}

export async function getLaunchRun(tenant: TenantContext, runId: string): Promise<LaunchRunView> {
  return view(withDates(await backendSDK(tenant).getLaunchRun(runId)))
}

/** The newest run of each kind for a campaign. */
export async function latestLaunchRuns(
  tenant: TenantContext,
  campaignId: string
): Promise<Partial<Record<LaunchRunKind, LaunchRunView>>> {
  const { runs } = await backendSDK(tenant).listLaunchRuns(campaignId)
  const latest: Partial<Record<LaunchRunKind, LaunchRunView>> = {}
  for (const run of withDates(runs)) {
    const kind = run.kind as LaunchRunKind
    if (!latest[kind]) latest[kind] = view(run)
  }
  return latest
}

/** Cancel a running run; its work stops at its next heartbeat. */
export async function cancelLaunchRun(tenant: TenantContext, runId: string) {
  return backendSDK(tenant).cancelLaunchRun(runId)
}
