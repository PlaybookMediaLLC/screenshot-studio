'use client'

import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC, useTRPCClient } from '@/lib/trpc/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { assetContentUrl } from '@/lib/editor/services'
import { draftAssetNode, supportedDraftMedia } from '@/lib/platform/asset-handoff'

/** Attach an existing immutable workspace asset; the server rechecks access before insertion. */
export function LibraryAssetPicker({
  onClose,
  onInsert,
}: {
  onClose: () => void
  onInsert: (node: ReturnType<typeof draftAssetNode>) => void
}) {
  const trpc = useTRPC()
  const client = useTRPCClient()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])
  const query = useInfiniteQuery(
    trpc.asset.list.infiniteQueryOptions(
      { limit: 24, search: debounced || undefined, sort: 'newest', type: 'all' },
      { getNextPageParam: (page) => page.nextCursor }
    )
  )
  const assets = query.data?.pages.flatMap((page) => page.assets) ?? []
  const asset = assets.find((item) => item.id === selected)
  const insert = async () => {
    if (!asset || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.asset.signDownload.query({ assetId: asset.id })
      onInsert(draftAssetNode(asset))
      onClose()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'This asset is no longer available. Choose another asset.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach from Library</DialogTitle>
          <DialogDescription>
            This workspace · Attach existing media to the current post. The original asset stays in
            Library.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Search library assets"
          placeholder="Search media"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setSelected(null)
          }}
        />
        {query.isPending ? (
          <p role="status">Loading assets…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>Library assets could not load.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : assets.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((item) => {
              const supported = supportedDraftMedia(item.mediaType)
              return (
                <li key={item.id}>
                  <Button
                    variant="custom"
                    size={null}
                    type="button"
                    disabled={!supported || busy}
                    aria-pressed={selected === item.id}
                    onClick={() => setSelected(item.id)}
                    className="flex h-full w-full flex-col gap-2 rounded-lg border p-2 text-start aria-pressed:ring-2 aria-pressed:ring-ring disabled:opacity-60"
                  >
                    {item.mediaType.startsWith('image/') ? (
                      <img
                        alt=""
                        loading="lazy"
                        src={`${assetContentUrl(item.id)}?variant=thumbnail`}
                        className="aspect-video w-full object-contain"
                      />
                    ) : (
                      <span className="grid aspect-video w-full place-items-center bg-muted text-xs">
                        {item.mediaType}
                      </span>
                    )}
                    <span className="w-full truncate text-xs">
                      {item.fileName || 'Workspace media'}
                    </span>
                    {!supported ? (
                      <span className="text-xs">
                        Export to PNG, JPEG, WebP, GIF, MP4 or WebM first.
                      </span>
                    ) : null}
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {search
              ? 'No assets match this search.'
              : 'No workspace assets yet. Upload media from the composer or save an export from Create.'}
          </p>
        )}
        {query.hasNextPage ? (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!asset || busy || !supportedDraftMedia(asset.mediaType)}
            onClick={() => void insert()}
          >
            {busy ? 'Checking access…' : 'Attach selected'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
