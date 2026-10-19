'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { StoredOnboardingRun } from '@/lib/tenant/onboarding-runs'
import { useTRPCClient } from '@/lib/trpc/react'
import { isTerminal, stageLabel, useOnboardingRun } from './run-progress'
import { Button } from '@/components/ui/button'

/** A finished run's card stays this long after the run ends, until dismissed. */
const SHOW_FINISHED_MS = 30 * 60 * 1_000

const dismissedKey = (runId: string) => `onboarding-card-dismissed:${runId}`

const HEADINGS: Record<string, string> = {
  cancelled: 'Enrichment stopped',
  completed: 'Your profile is enriched',
  failed: 'Enrichment did not finish',
  partial: 'Enrichment stopped early',
}

function Card({ initial }: { initial: StoredOnboardingRun }) {
  const { run } = useOnboardingRun(initial)
  const [dismissed, setDismissed] = useState(
    () => window.localStorage.getItem(dismissedKey(initial.id)) === '1'
  )
  const running = !isTerminal(run.status)
  const finishedAt = run.completedAt?.getTime() ?? 0
  if (dismissed || (!running && Date.now() - finishedAt > SHOW_FINISHED_MS)) return null
  const detail = running
    ? `${stageLabel(run)} · ${run.pagesProcessed} of ${run.pagesDiscovered} pages read`
    : `${run.pagesProcessed} pages read${run.errorMessage ? `. ${run.errorMessage}` : ''}`
  return (
    <aside
      aria-label="Profile enrichment"
      className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 rounded-xl border border-white/[0.1] bg-neutral-950/95 p-4 text-sm shadow-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-white">
          {running ? 'Enriching your profile' : HEADINGS[run.status]}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-neutral-300 tabular-nums">{run.progress}%</span>
          <Button variant="custom" size={null}
            aria-label="Dismiss"
            className="text-neutral-500 hover:text-white"
            onClick={() => {
              window.localStorage.setItem(dismissedKey(run.id), '1')
              setDismissed(true)
            }}
            type="button"
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <div
        aria-label="Enrichment progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={run.progress}
        className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        role="progressbar"
      >
        <div className="h-full bg-white transition-all" style={{ width: `${run.progress}%` }} />
      </div>
      <p aria-live="polite" className="text-xs text-neutral-400">
        {detail}
      </p>
      <Link
        className="w-fit text-xs text-neutral-300 underline underline-offset-4 hover:text-white"
        href="/workspace/product"
      >
        Review your profile
      </Link>
    </aside>
  )
}

/**
 * After onboarding, a card in the bottom-right corner follows the background
 * read (docs/rfcs/032): how far enrichment has got, the stage it is on, and
 * the pages read. It stays a while after the run ends, until dismissed.
 * Workspaces without a run see nothing.
 */
export function OnboardingProgressCard() {
  const trpcClient = useTRPCClient()
  const [run, setRun] = useState<StoredOnboardingRun | null>(null)
  useEffect(() => {
    trpcClient.onboarding.latest
      .query()
      .then((result) => setRun(result.run))
      .catch(() => setRun(null))
  }, [trpcClient])
  return run ? <Card initial={run} key={run.id} /> : null
}
