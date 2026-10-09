'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Group, Row } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/components/workspace/settings-client'
import { useTRPCClient } from '@/lib/trpc/react'
import { waitForLaunchRun } from '../run-polling'

type ActiveRun = { id: string; startedAt: string }

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

/**
 * Starts production (visuals, then copy) as a background run and waits for
 * it, picking up a run that was already going when the page loaded.
 */
export function ProduceControl({
  activeRun,
  blocker,
  campaignId,
  lastError,
}: {
  activeRun: ActiveRun | null
  /** Why production cannot start: no plan yet, or AI is not configured. */
  blocker: 'ai' | 'plan' | null
  campaignId: string
  /** The latest run's failure, so it is not lost when the page reloads. */
  lastError: string | null
}) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const [run, setRun] = useState<ActiveRun | null>(activeRun)
  const [starting, setStarting] = useState(false)
  // Unset until mounted, so the server and the first client render agree.
  const [now, setNow] = useState<number | null>(null)
  const [error, setError] = useState(lastError)

  useEffect(() => {
    if (!run) return
    let active = true
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    waitForLaunchRun(trpcClient, run.id)
      .then((finished) => {
        if (!active) return
        if (finished.status === 'SUCCEEDED') {
          toast.success('Campaign produced', { description: finished.summary ?? undefined })
        } else {
          setError(finished.error ?? 'Production failed. Try again.')
        }
        setRun(null)
        router.refresh()
      })
      .catch((pollError: unknown) => {
        if (!active) return
        setError(getErrorMessage(pollError))
        setRun(null)
      })
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [router, run, trpcClient])

  async function produce() {
    setStarting(true)
    setError(null)
    try {
      const result = await trpcClient.launch.produce.mutate({ campaignId })
      setRun({ id: result.run.id, startedAt: new Date().toISOString() })
    } catch (startError) {
      setError(getErrorMessage(startError))
    } finally {
      setStarting(false)
    }
  }

  const elapsed = run && now ? ` ${formatElapsed(now - Date.parse(run.startedAt))}` : ''
  return (
    <div className="flex flex-col gap-3">
      <Group>
        <Row
          description={
            blocker === 'plan' ? (
              <>
                Plan the campaign first.{' '}
                <Link
                  className="font-medium text-white underline-offset-4 hover:underline"
                  href={`/campaigns/${campaignId}/plan`}
                >
                  Go to the plan
                </Link>
              </>
            ) : blocker === 'ai' ? (
              'AI is not configured for this environment.'
            ) : (
              'Captures the product, designs and reviews each visual, then writes the copy. A few minutes.'
            )
          }
          label="Visuals and copy"
        >
          <Button
            className="rounded-lg tabular-nums"
            disabled={blocker !== null || run !== null || starting}
            onClick={() => void produce()}
            type="button"
          >
            {run ? `Producing…${elapsed}` : starting ? 'Starting…' : 'Produce campaign'}
          </Button>
        </Row>
      </Group>
      <span className="sr-only" role="status">
        {run ? 'Producing the campaign. This takes a few minutes.' : ''}
      </span>
      {error ? (
        <p
          className="rounded-xl bg-red-500/5 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/20"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
