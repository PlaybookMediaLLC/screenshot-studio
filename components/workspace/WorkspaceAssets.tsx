'use client'

import { Album02Icon, MoreHorizontalIcon, Video01Icon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/platform-ui'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
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

type TypeFilter = 'all' | 'image' | 'video'

const PAGE_SIZE = 24
const TYPE_FILTERS: { label: string; value: TypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Images', value: 'image' },
  { label: 'Videos', value: 'video' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDimensions(asset: AssetSummary): string | null {
  return asset.width && asset.height ? `${asset.width}×${asset.height}` : null
}

/** "image/png" → "PNG image". */
function describeType(mediaType: string): string {
  const [kind, subtype] = mediaType.split('/')
  return `${(subtype ?? '').replace(/^x-/, '').toUpperCase()} ${kind}`.trim()
}

/**
 * Assets are private, so each preview needs a signed URL. It is signed only
 * once the card nears the viewport: the tRPC client batches the visible
 * cards into one request, and assets nobody scrolls to get no URL at all.
 */
function AssetPreview({ asset }: { asset: AssetSummary }) {
  const trpcClient = useTRPCClient()
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const isVideo = asset.mediaType.startsWith('video/')

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        trpcClient.asset.signDownload
          .query({ assetId: asset.id })
          .then((result) => setUrl(result.downloadUrl))
          .catch(() => undefined)
      },
      { rootMargin: '200px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [asset.id, trpcClient])

  return (
    <div
      className="relative grid aspect-[16/10] place-items-center overflow-hidden bg-[radial-gradient(circle_at_center,#1a1a1a,#0c0c0c)]"
      ref={ref}
    >
      {url && isVideo ? (
        <video className="size-full object-contain" muted preload="metadata" src={url} />
      ) : url ? (
        // A signed, short-lived storage URL, so a plain img: next/image would cache it.
        <img alt="" className="size-full object-contain p-3" loading="lazy" src={url} />
      ) : isVideo ? (
        <Video01Icon className="text-neutral-700" size={28} />
      ) : (
        <div className="size-full animate-pulse bg-white/[0.02]" />
      )}
    </div>
  )
}

export function WorkspaceAssets() {
  const trpcClient = useTRPCClient()
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  // The id of the asset whose delete awaits confirmation, so one stray
  // click cannot destroy work.
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

  const visible = useMemo(() => {
    const filtered = assets.filter(
      (asset) => typeFilter === 'all' || asset.mediaType.startsWith(`${typeFilter}/`)
    )
    return sort === 'newest' ? filtered : [...filtered].reverse()
  }, [assets, sort, typeFilter])

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
      <EmptyState
        action={<ButtonLink href="/">Open the editor</ButtonLink>}
        description="Open the editor, compose a screenshot, then choose Save to workspace to keep it here for your team."
        icon={Album02Icon}
        title="No saved assets yet"
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          aria-label="Filter by type"
          className="inline-flex w-fit rounded-lg bg-white/[0.03] p-0.5 ring-1 ring-white/[0.08]"
          role="group"
        >
          {TYPE_FILTERS.map((filter) => (
            <button
              aria-pressed={typeFilter === filter.value}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                typeFilter === filter.value
                  ? 'bg-white/[0.08] text-white'
                  : 'text-neutral-500 hover:text-neutral-200'
              )}
              key={filter.value}
              onClick={() => setTypeFilter(filter.value)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-500">
          Sort
          <select
            className="h-8 rounded-lg bg-white/[0.03] px-2 text-sm text-neutral-200 ring-1 ring-white/[0.08] outline-none"
            onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}
            value={sort}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {isLoading && assets.length === 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <li
              className="aspect-[16/12] animate-pulse rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]"
              key={index}
            />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">
          No {typeFilter === 'video' ? 'videos' : 'images'} saved yet.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((asset) => {
            const dimensions = formatDimensions(asset)
            const isImage = asset.mediaType.startsWith('image/')
            const isConfirmingDelete = confirmingDeleteId === asset.id
            const isDeleting = deletingId === asset.id
            return (
              <li
                className="group overflow-hidden rounded-xl bg-white/[0.02] ring-1 ring-white/[0.08] transition hover:ring-white/[0.16]"
                key={asset.id}
              >
                <AssetPreview asset={asset} />
                <div className="flex items-start justify-between gap-3 border-t border-white/[0.06] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {describeType(asset.mediaType)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">
                      {[dimensions, formatBytes(asset.bytes)].filter(Boolean).join(' · ')}
                      {' · '}
                      {new Date(asset.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="Asset actions"
                        className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-500 opacity-60 transition hover:bg-white/[0.06] hover:text-white hover:opacity-100 group-hover:opacity-100"
                        type="button"
                      >
                        <MoreHorizontalIcon size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {isImage ? (
                        <DropdownMenuItem asChild>
                          {/* The editor reads this parameter on load and pulls
                              the asset onto the canvas for another pass. */}
                          <a href={`/?asset=${asset.id}`}>Edit</a>
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => void handleOpen(asset.id)}>
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setConfirmingDeleteId(asset.id)}
                        variant="destructive"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {isConfirmingDelete ? (
                  <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-red-500/[0.06] px-4 py-2.5 text-sm">
                    <span className="text-red-300">Delete this asset?</span>
                    <span className="flex gap-1.5">
                      <Button
                        onClick={() => setConfirmingDeleteId(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={isDeleting}
                        onClick={() => void handleDelete(asset.id)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {isDeleting ? 'Deleting…' : 'Confirm delete'}
                      </Button>
                    </span>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {cursor ? (
        <div className="flex justify-center">
          <Button
            className="rounded-lg"
            disabled={isLoading}
            onClick={() => loadPage(cursor)}
            type="button"
            variant="outline"
          >
            {isLoading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
