'use client'

import { LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ComponentProps, useEffect, useEffectEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
import { waitForLaunchRun } from './run-polling'

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/**
 * Starts a background AI run (spec, plan, produce) and waits for it with an
 * elapsed timer, then refreshes the page. A run that was already going when
 * the page loaded (`activeRunId`) is picked up again.
 */
export function RunButton({
  activeRunId,
  className,
  disabled,
  doneMessage,
  hint,
  initialError,
  label,
  onStart,
  runningLabel,
  variant,
}: {
  activeRunId?: string | null
  className?: string
  disabled?: boolean
  /** The success toast, e.g. "Spec drafted"; the page itself shows the run's result. */
  doneMessage: string
  /** Shown beside the timer while the run is going, e.g. "About a minute". */
  hint?: string
  /** The last run's failure, from the server. */
  initialError?: string | null
  label: string
  onStart: () => Promise<{ run: { id: string } }>
  runningLabel: string
  variant?: ComponentProps<typeof Button>['variant']
}) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  // One poll per run, even when an effect runs twice in development.
  const following = useRef<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState(initialError ?? null)
  const running = startedAt !== null

  async function follow(runId: string) {
    if (following.current === runId) return
    following.current = runId
    setError(null)
    setStartedAt((value) => value ?? Date.now())
    try {
      const run = await waitForLaunchRun(trpcClient, runId, (tick) =>
        setStartedAt(new Date(tick.startedAt).getTime())
      )
      if (run.status === 'FAILED') {
        setError(run.error ?? 'The run failed. Try again.')
      } else {
        toast.success(doneMessage)
        router.refresh()
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      following.current = null
      setStartedAt(null)
    }
  }

  async function start() {
    const startTime = Date.now()
    setError(null)
    setNow(startTime)
    setStartedAt(startTime)
    try {
      const { run } = await onStart()
      await follow(run.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setStartedAt(null)
    }
  }

  const resume = useEffectEvent((runId: string) => void follow(runId))
  useEffect(() => {
    if (activeRunId) resume(activeRunId)
  }, [activeRunId])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="rounded-lg"
          disabled={disabled || running}
          onClick={() => void start()}
          size="sm"
          type="button"
          variant={variant}
        >
          {running ? (
            <>
              <LoaderCircle aria-hidden className="animate-spin" />
              {runningLabel}
            </>
          ) : (
            label
          )}
        </Button>
        {running ? (
          <span className="text-xs text-neutral-500 tabular-nums">
            {clock(now - startedAt)}
            {hint ? ` · ${hint}` : null}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
