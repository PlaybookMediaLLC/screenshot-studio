'use client'
import * as React from 'react'
import { toast } from 'sonner'
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

/** Explicit attachment is distinct from the ephemeral link card in the preview. */
export function LinkImage({ editor, onClose }: { editor: PlateEditor; onClose: () => void }) {
  const [url, setUrl] = React.useState('')
  const [card, setCard] = React.useState<{
    image: string | null
    title: string | null
    requestedUrl: string
  } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const resolve = async () => {
    setBusy(true)
    setCard(null)
    try {
      const result = await call<{ image: string | null; title: string | null }>(
        `/api/v1/content-drafts/link-card?${new URLSearchParams({ url })}`
      )
      setCard({ ...result, requestedUrl: url })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The page could not be read.')
    } finally {
      setBusy(false)
    }
  }
  const attach = async () => {
    if (!card?.image) return
    setBusy(true)
    try {
      const result = await call<{
        assetId: string
        sourceUrl: string
        width: number
        height: number
      }>('/api/v1/content-drafts/link-image', { method: 'POST', body: { url: card.requestedUrl } })
      if (!editor.selection) editor.tf.select(editor.api.end([]))
      editor.tf.insertNodes({
        type: 'img',
        id: crypto.randomUUID(),
        children: [{ text: '' }],
        ...result,
        url: assetContentUrl(result.assetId),
        mimeType: 'image/png',
        processingStatus: 'ready',
        alt: '',
      })
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The image could not be attached.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Image from link</DialogTitle>
          <DialogDescription>
            Find a page image, then attach a durable copy. Use images you have permission to
            publish.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void resolve()
          }}
          className="flex gap-2"
        >
          <Input
            aria-label="Page URL"
            type="url"
            required
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              setCard(null)
            }}
          />
          <Button disabled={busy}>Find image</Button>
        </form>
        {card ? (
          card.image ? (
            <>
              <img
                src={card.image}
                referrerPolicy="no-referrer"
                alt={card.title ?? 'Discovered page image'}
                className="max-h-64 w-full object-contain"
              />
              <Button disabled={busy} onClick={() => void attach()}>
                Attach image
              </Button>
            </>
          ) : (
            <p role="status">This page has no eligible image.</p>
          )
        ) : null}
        {busy ? <p role="status">Reading image…</p> : null}
      </DialogContent>
    </Dialog>
  )
}
