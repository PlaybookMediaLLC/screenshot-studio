'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

/**
 * The assets a workspace has collected.
 *
 * Until now a saved export had nowhere to appear, so an account gave a
 * user nothing to look at. This is where saved work becomes visible to
 * the team that owns it.
 */

type AssetSummary = {
  bytes: number
  createdAt: string | Date
  height: number | null
  id: string
  mediaType: string
  width: number | null
}

const PAGE_SIZE = 24

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDimensions(asset: AssetSummary): string | null {
  return asset.width && asset.height ? `${asset.width} × ${asset.height}` : null
}

export function WorkspaceAssets() {
  const trpcClient = useTRPCClient()
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadPage = useCallback(
    async (after?: string): Promise<void> => {
      setIsLoading(true)
      try {
        const result = await trpcClient.asset.list.query({
          ...(after ? { cursor: after } : {}),
          limit: PAGE_SIZE,
        })
        // Append rather than replace, so paging forward keeps what the
        // reader has already scrolled past.
        setAssets((current) => (after ? [...current, ...result.assets] : result.assets))
        setCursor(result.nextCursor)
        setError(null)
      } catch (requestError) {
        setError(getErrorMessage(requestError))
      } finally {
        setIsLoading(false)
      }
    },
    [trpcClient]
  )

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  /**
   * Assets are private, so a URL is signed on demand rather than embedded
   * in the list. Signing every thumbnail up front would issue one request
   * per row and hand out credentials the reader may never use.
   */
  async function handleOpen(assetId: string): Promise<void> {
    try {
      const { downloadUrl } = await trpcClient.asset.signDownload.query({ assetId })
      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!isLoading && assets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No saved assets yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Open the editor, compose a screenshot, then choose Save to workspace to keep it here for
          your team.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((asset) => {
          const dimensions = formatDimensions(asset)
          return (
            <li key={asset.id}>
              <button
                className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent"
                onClick={() => handleOpen(asset.id)}
                type="button"
              >
                <p className="text-sm font-medium">{asset.mediaType}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(asset.bytes)}
                  {dimensions ? ` · ${dimensions}` : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(asset.createdAt).toLocaleString()}
                </p>
              </button>
            </li>
          )
        })}
      </ul>

      {cursor ? (
        <Button disabled={isLoading} onClick={() => loadPage(cursor)} type="button" variant="outline">
          {isLoading ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  )
}
