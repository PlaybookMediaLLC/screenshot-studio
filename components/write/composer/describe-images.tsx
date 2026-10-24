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
type DraftImage = { alt: string; assetId: string; path: number[]; post: number; url: string }

/** The draft's uploaded images, in order, with the post each is in. */
function draftImages(editor: PlateEditor): DraftImage[] {
  const ranges = postRanges(editor.children)
  const images: DraftImage[] = []
  for (const [node, path] of editor.api.nodes({
    at: [],
    match: (item) => (item as { type?: string }).type === 'img',
  })) {
    const image = node as { alt?: unknown; assetId?: unknown; url?: unknown }
    if (typeof image.assetId !== 'string') continue
    const post = ranges.findIndex(([start, end]) => path[0] >= start && path[0] < end) + 1
    images.push({
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
export function DescribeImages({ editor, onClose }: { editor: PlateEditor; onClose: () => void }) {
  const [images] = React.useState(() => draftImages(editor))
  const [alts, setAlts] = React.useState(() => images.map((image) => image.alt))
  const [busy, setBusy] = React.useState(false)
  const save = async () => {
    setBusy(true)
    try {
      for (const [index, image] of images.entries()) {
        const alt = alts[index].trim()
        if (alt === image.alt) continue
        await call(`/api/v1/assets/${encodeURIComponent(image.assetId)}/alt-text`, {
          body: { altText: alt },
          method: 'PUT',
        })
        editor.tf.setNodes({ alt }, { at: image.path })
      }
      toast.success('Image descriptions saved. They are posted with the images.')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The descriptions did not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
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
                    maxLength={1_000}
                    onChange={(event) =>
                      setAlts((current) =>
                        current.map((alt, at) => (at === index ? event.target.value : alt))
                      )
                    }
                    placeholder="What the image shows"
                    rows={2}
                    value={alts[index]}
                  />
                  <span>{alts[index].length} / 1000</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
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
