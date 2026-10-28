'use client'
import * as React from 'react'
import type { PlateEditor } from '@shots/platejs-editor/platejs/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { call } from '@/lib/content-drafts/client'
import { assetContentUrl } from '@/lib/editor/services'

type Result = { id: string; title: string; previewUrl: string; sourceUrl: string }

/** GIPHY remains unavailable until the server has explicit provider approval. */
export function GiphyPicker({ editor, onClose }: { editor: PlateEditor; onClose: () => void }) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Result[] | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const search = async () => {
    setBusy(true)
    setError('')
    try {
      setResults(
        (
          await call<{ items: Result[] }>(
            `/api/v1/content-drafts/giphy?${new URLSearchParams({ q: query })}`
          )
        ).items
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Search failed.')
      setResults(null)
    } finally {
      setBusy(false)
    }
  }
  const attach = async (item: Result) => {
    setBusy(true)
    setError('')
    try {
      const result = await call<{ assetId: string; sourceUrl: string }>(
        '/api/v1/content-drafts/giphy',
        { method: 'POST', body: { id: item.id } }
      )
      if (!editor.selection) editor.tf.select(editor.api.end([]))
      editor.tf.insertNodes({
        type: 'img',
        id: crypto.randomUUID(),
        children: [{ text: '' }],
        ...result,
        giphyId: item.id,
        url: assetContentUrl(result.assetId),
        mimeType: 'image/gif',
        processingStatus: 'ready',
        alt: '',
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Attachment failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Find a GIF</DialogTitle>
          <DialogDescription>
            Search and attachment require an approved GIPHY integration on this installation.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <Input
            aria-label="Search GIFs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button disabled={busy || !query.trim()}>Search</Button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        {busy ? <p role="status">Loading…</p> : null}
        {results?.length === 0 ? <p role="status">No GIFs found. Try another search.</p> : null}
        <div className="grid grid-cols-2 gap-2">
          {results?.map((item) => (
            <Button
              variant="custom"
              size={null}
              type="button"
              key={item.id}
              disabled={busy}
              aria-label={`Attach ${item.title || 'GIF'}`}
              onClick={() => void attach(item)}
            >
              <img alt={item.title} src={item.previewUrl} className="w-full rounded" />
            </Button>
          ))}
        </div>
        <a href="https://giphy.com" target="_blank" rel="noreferrer" className="text-xs">
          Powered by GIPHY
        </a>
      </DialogContent>
    </Dialog>
  )
}
