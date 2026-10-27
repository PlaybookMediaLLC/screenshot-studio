import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, withDates } from '@/lib/backend/sdk'

/**
 * Onboarding runs (docs/rfcs/034-background-onboarding-agent.md): the Go
 * backend's fast path and the Temporal run that deepens it. The web only
 * forwards the authenticated workspace; the backend does all the work.
 */

/** Read the product's site into drafts within ten seconds and start the background run. */
export async function startOnboardingRun(
  context: TenantContext,
  input: { idempotencyKey?: string; sentence?: string; url: string }
) {
  return withDates(await backendSDK(context).startOnboardingRun(input))
}

/** A started run with its drafts, dates parsed. */
export type OnboardingStart = Awaited<ReturnType<typeof startOnboardingRun>>

/** One run; while it runs, its progress comes live from the workflow. */
export async function getOnboardingRun(context: TenantContext, runId: string) {
  return withDates((await backendSDK(context).getOnboardingRun(runId)).run)
}

/** A run, dates parsed. */
export type StoredOnboardingRun = Awaited<ReturnType<typeof getOnboardingRun>>

/** The workspace's newest run, or null before its first. */
export async function getLatestOnboardingRun(context: TenantContext) {
  const { run } = await backendSDK(context).latestOnboardingRun()
  return run && withDates(run)
}

/** Stop a running run; it keeps what it already read. */
export async function cancelOnboardingRun(context: TenantContext, runId: string) {
  return withDates((await backendSDK(context).cancelOnboardingRun(runId)).run)
}

/** Start a new run for a run's URL; an unchanged site costs nothing. */
export async function rerunOnboardingRun(
  context: TenantContext,
  runId: string,
  idempotencyKey?: string
) {
  return withDates(await backendSDK(context).rerunOnboardingRun(runId, { idempotencyKey }))
}

/** What enrichment found for a run's site, each finding with its provider and confidence. */
export async function listOnboardingEnrichment(context: TenantContext, runId: string) {
  return withDates((await backendSDK(context).listOnboardingEnrichment(runId)).enrichment)
}

/** One enrichment finding, dates parsed. */
export type StoredEnrichment = Awaited<ReturnType<typeof listOnboardingEnrichment>>[number]
