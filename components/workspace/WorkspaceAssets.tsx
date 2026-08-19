'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
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
  // The id of the asset whose delete awaits a second click, so one
  // stray click cannot destroy work.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      toast.error('Could not open the asset', { description: getErrorMessage(requestError) })
    }
  }

  async function handleDelete(assetId: string): Promise<void> {
    setDeletingId(assetId)
    try {
      await trpcClient.asset.delete.mutate({ assetId })
      setAssets((current) => current.filter((asset) => asset.id !== assetId))
    } catch (requestError) {
      // The server refuses when a creative variant still references the
      // asset, and its message says so. Show it rather than translate it.
      toast.error('Could not delete the asset', { description: getErrorMessage(requestError) })
    } finally {
      setDeletingId(null)
      setConfirmingDeleteId(null)
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
          const isImage = asset.mediaType.startsWith('image/')
          const isConfirmingDelete = confirmingDeleteId === asset.id
          const isDeleting = deletingId === asset.id
          return (
            <li className="rounded-lg border p-4" key={asset.id}>
              <p className="text-sm font-medium">{asset.mediaType}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatBytes(asset.bytes)}
                {dimensions ? ` · ${dimensions}` : ''}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(asset.createdAt).toLocaleString()}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                {isImage ? (
                  <Button asChild size="sm" variant="outline">
                    {/* The editor reads this parameter on load and pulls
                        the asset onto the canvas for another pass. */}
                    <Link href={`/?asset=${asset.id}`}>Edit</Link>
                  </Button>
                ) : null}
                <Button onClick={() => handleOpen(asset.id)} size="sm" type="button" variant="ghost">
                  Download
                </Button>
                <Button
                  className="text-destructive hover:text-destructive"
                  disabled={isDeleting}
                  onClick={() =>
                    isConfirmingDelete ? handleDelete(asset.id) : setConfirmingDeleteId(asset.id)
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {isDeleting ? 'Deleting…' : isConfirmingDelete ? 'Confirm delete' : 'Delete'}
                </Button>
              </div>
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
