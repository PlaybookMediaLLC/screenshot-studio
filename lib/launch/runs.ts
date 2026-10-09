import 'server-only'

import { after } from 'next/server'
import type { TenantContext } from '@/lib/auth/access'
import { prisma } from '@/lib/db'
import { LaunchError } from './store'

/**
 * Background runs for the launch pipeline's AI actions.
 *
 * Drafting a spec takes about a minute and producing a campaign several, longer
 * than a request should stay open behind proxies. A run is recorded, the work
 * continues after the response (`after`), and the UI polls the run. One run of
 * each kind per campaign at a time; a run that never finished (the server
 * restarted mid-run) counts as failed once it is older than STALE_AFTER_MS.
 */

export const LAUNCH_RUN_KINDS = ['spec', 'plan', 'produce', 'revision'] as const
export type LaunchRunKind = (typeof LAUNCH_RUN_KINDS)[number]

const STALE_AFTER_MS = 20 * 60_000

const runSelect = {
  campaignId: true,
  error: true,
  finishedAt: true,
  id: true,
  kind: true,
  resultId: true,
  startedAt: true,
  status: true,
  summary: true,
} as const

export type LaunchRunView = {
  campaignId: string
  error: string | null
  finishedAt: Date | null
  id: string
  kind: string
  resultId: string | null
  startedAt: Date
  status: 'FAILED' | 'RUNNING' | 'SUCCEEDED'
  summary: string | null
}

function view(run: LaunchRunView): LaunchRunView {
  if (run.status === 'RUNNING' && Date.now() - run.startedAt.getTime() > STALE_AFTER_MS) {
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
    work: () => Promise<{ resultId?: string | null; summary?: string | null }>
  }
): Promise<LaunchRunView> {
  if (input.kind !== 'revision') {
    const active = await prisma.launchRun.findFirst({
      select: { id: true },
      where: {
        campaignId: input.campaignId,
        kind: input.kind,
        organizationId: tenant.organizationId,
        startedAt: { gt: new Date(Date.now() - STALE_AFTER_MS) },
        status: 'RUNNING',
      },
    })
    if (active) throw new LaunchError('This step is already running for the campaign.', 409)
  }
  const run = await prisma.launchRun.create({
    data: {
      campaignId: input.campaignId,
      createdByUserId: tenant.principal.kind === 'session' ? tenant.principal.userId : null,
      kind: input.kind,
      organizationId: tenant.organizationId,
    },
    select: runSelect,
  })
  after(async () => {
    try {
      const result = await input.work()
      await prisma.launchRun.update({
        data: {
          finishedAt: new Date(),
          resultId: result.resultId ?? null,
          status: 'SUCCEEDED',
          summary: result.summary?.slice(0, 2_000) ?? null,
        },
        where: { id: run.id },
      })
    } catch (error) {
      console.error('Launch run failed.', {
        kind: input.kind,
        reason: error instanceof Error ? error.message : 'unknown',
        runId: run.id,
      })
      await prisma.launchRun
        .update({
          data: { error: failureMessage(error), finishedAt: new Date(), status: 'FAILED' },
          where: { id: run.id },
        })
        .catch(() => undefined)
    }
  })
  return view(run)
}

export async function getLaunchRun(organizationId: string, runId: string): Promise<LaunchRunView> {
  const run = await prisma.launchRun.findFirst({
    select: runSelect,
    where: { id: runId, organizationId },
  })
  if (!run) throw new LaunchError('Run not found.', 404)
  return view(run)
}

/** The newest run of each kind for a campaign. */
export async function latestLaunchRuns(
  organizationId: string,
  campaignId: string
): Promise<Partial<Record<LaunchRunKind, LaunchRunView>>> {
  const runs = await prisma.launchRun.findMany({
    orderBy: { startedAt: 'desc' },
    select: runSelect,
    take: 40,
    where: { campaignId, organizationId },
  })
  const latest: Partial<Record<LaunchRunKind, LaunchRunView>> = {}
  for (const run of runs) {
    const kind = run.kind as LaunchRunKind
    if (!latest[kind]) latest[kind] = view(run)
  }
  return latest
}
