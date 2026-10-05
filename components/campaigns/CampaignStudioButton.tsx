'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/components/workspace/settings-client'
import { trackEvent } from '@/lib/analytics'
import { useTRPCClient } from '@/lib/trpc/react'

type CampaignStudioButtonProps = {
  campaignId: string
  canGenerate: boolean
  configured: boolean
  hasAssets: boolean
}

/** Starts the campaign studio agent and refreshes the page with what it made. */
export function CampaignStudioButton({
  campaignId,
  canGenerate,
  configured,
  hasAssets,
}: CampaignStudioButtonProps) {
  const router = useRouter()
  const trpcClient = useTRPCClient()
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  async function handleGenerate(): Promise<void> {
    setError(null)
    setSummary(null)
    setIsRunning(true)
    const startedAt = Date.now()
    try {
      const result = await trpcClient.campaign.generate.mutate({ campaignId })
      trackEvent('campaign_generated', {
        assetCount: result.assets.length,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000),
        postCount: result.postCount,
      })
      setSummary(result.summary || 'Launch kit generated.')
      router.refresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsRunning(false)
    }
  }

  if (!canGenerate) return null

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!configured || isRunning} onClick={handleGenerate} type="button">
          {isRunning
            ? 'Generating launch kit…'
            : hasAssets
              ? 'Generate more'
              : 'Generate launch kit'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {configured
            ? isRunning
              ? 'Capturing your product and drafting posts. This takes about a minute.'
              : 'Captures your product, builds product shots, and drafts posts for review.'
            : 'AI generation is not configured for this environment.'}
        </span>
      </div>
      {summary ? (
        <Alert>
          <AlertDescription>{summary}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
