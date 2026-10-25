'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type { PlateEditor } from '@shots/platejs-editor/platejs/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { postRanges } from '@/components/drafts/thread'
import { call } from '@/lib/content-drafts/client'

/** An image in the draft: where it is, what it shows, and its description. */
type DraftImage = {
  id: string
  alt: string
  assetId: string
  path: number[]
  post: number
  url: string
}

/** The draft's uploaded images, in order, with the post each is in. */
function draftImages(editor: PlateEditor): DraftImage[] {
  const ranges = postRanges(editor.children)
  const images: DraftImage[] = []
  for (const [node, path] of editor.api.nodes({
    at: [],
    match: (item) => (item as { type?: string }).type === 'img',
  })) {
    const image = node as { id?: string; alt?: unknown; assetId?: unknown; url?: unknown }
    if (typeof image.assetId !== 'string') continue
    const post = ranges.findIndex(([start, end]) => path[0] >= start && path[0] < end) + 1
    images.push({
      id: image.id ?? '',
      alt: typeof image.alt === 'string' ? image.alt : '',
      assetId: image.assetId,
      path,
      post: Math.max(post, 1),
      url: typeof image.url === 'string' ? image.url : '',
    })
  }
  return images
}

/**
 * Describe images (RFC 025): alt text for each uploaded image, saved on the
 * image and posted with it wherever it goes. X takes up to 1,000
 * characters. Kept on the image node too, so the draft shows it.
 */
export function DescribeImages({
  editor,
  onClose,
  aiEnabled = false,
  imageId,
  onSaved,
}: {
  editor: PlateEditor
  onClose: () => void
  aiEnabled?: boolean
  imageId?: string
  onSaved: (assetId: string, alt: string) => void
}) {
  const [images] = React.useState(() => [
    ...new Map(
      draftImages(editor)
        .filter((image) => !imageId || image.id === imageId)
        .map((image) => [image.assetId, image])
    ).values(),
  ])
  const [alts, setAlts] = React.useState(() => images.map((image) => image.alt))
  const [busy, setBusy] = React.useState(false)
  const save = async () => {
    setBusy(true)
    try {
      for (const [index, image] of images.entries()) {
        const alt = alts[index].trim()
        if (Array.from(alt).length > 1000)
          throw new Error('Descriptions can contain up to 1,000 characters.')
        if (alt === image.alt) continue
        await call(`/api/v1/assets/${encodeURIComponent(image.assetId)}/alt-text`, {
          body: { altText: alt },
          method: 'PUT',
        })
        // Descriptions are asset-scoped. Refresh every occurrence by asset identity,
        // including copies, even if the document changed while the dialog was open.
        for (const current of draftImages(editor)) {
          if (current.assetId === image.assetId) editor.tf.setNodes({ alt }, { at: current.path })
        }
        onSaved(image.assetId, alt)
      }
      toast.success('Image descriptions saved. They are posted with the images.')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The descriptions did not save.')
    } finally {
      setBusy(false)
    }
  }
  const suggest = async (index: number) => {
    setBusy(true)
    try {
      const { altText } = await call<{ altText: string }>(
        `/api/v1/assets/${encodeURIComponent(images[index].assetId)}/describe`,
        { method: 'POST' }
      )
      setAlts((current) => current.map((alt, at) => (at === index ? altText : alt)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The image could not be described.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && !busy && onClose()} open>
      <DialogContent
        className="max-h-[90dvh] max-w-lg overflow-y-auto"
        data-testid="describe-images"
      >
        <DialogHeader>
          <DialogTitle>Describe images</DialogTitle>
          <DialogDescription>
            Alt text tells people who cannot see an image what it shows. It is posted with the image
            on X and LinkedIn.
          </DialogDescription>
        </DialogHeader>
        {images.length === 0 ? (
          <p className="text-sm text-neutral-400">This version has no uploaded images.</p>
        ) : (
          <ul className="grid gap-3">
            {images.map((image, index) => (
              <li className="flex gap-3" key={`${image.assetId}-${index}`}>
                {/* biome-ignore lint/performance/noImgElement: a workspace asset URL */}
                <img alt="" className="size-16 shrink-0 rounded-md object-cover" src={image.url} />
                <label className="grid flex-1 gap-1 text-xs text-neutral-400">
                  Post {image.post}
                  <Textarea
                    aria-label={`Description of image ${index + 1}`}
                    maxLength={2_000}
                    onChange={(event) =>
                      setAlts((current) =>
                        current.map((alt, at) => (at === index ? event.target.value : alt))
                      )
                    }
                    placeholder="What the image shows"
                    rows={2}
                    value={alts[index]}
                  />
                  <span>{Array.from(alts[index]).length} / 1000</span>
                  {aiEnabled && (
                    <Button
                      disabled={busy}
                      onClick={() => void suggest(index)}
                      type="button"
                      size="sm"
                      variant="outline"
                    >
                      Suggest with AI
                    </Button>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        {aiEnabled && (
          <p className="text-xs text-muted-foreground">
            AI suggestions use workspace credits. Review and edit the description before saving.
            Animated images use their first frame.
          </p>
        )}
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={busy || images.length === 0} onClick={() => void save()} type="button">
            Save descriptions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A preview description edits the durable asset and every occurrence in this draft. */
export function PreviewImageDescription({
  assetId,
  initialAlt,
  onSaved,
  onClose,
}: {
  assetId: string
  initialAlt: string
  onSaved: (alt: string) => void
  onClose: () => void
}) {
  const [alt, setAlt] = React.useState(initialAlt)
  const [busy, setBusy] = React.useState(false)
  const save = async () => {
    if (Array.from(alt.trim()).length > 1000)
      return toast.error('Descriptions can contain up to 1,000 characters.')
    setBusy(true)
    try {
      await call(`/api/v1/assets/${encodeURIComponent(assetId)}/alt-text`, {
        method: 'PUT',
        body: { altText: alt.trim() },
      })
      onSaved(alt.trim())
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The description did not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Image description</DialogTitle>
          <DialogDescription>
            This description follows this asset, including copies. It is sent to platforms that
            support alt text.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Image description"
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          maxLength={2000}
        />
        <p>{Array.from(alt).length} / 1000</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            Save description
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
