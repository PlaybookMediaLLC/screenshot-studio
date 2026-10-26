'use client'

import { useMemo, useState } from 'react'
import type { Value } from '@shots/platejs-editor/platejs'
import type { PlateEditor } from '@shots/platejs-editor/platejs/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { importedBody, importedPosts, splitThread } from '@/lib/write/import-text'
import type { DraftChannel } from '@/lib/write/document'
import { postRanges } from '@/components/drafts/thread'
import { toast } from 'sonner'

/** Preview a paste before appending ordinary, editable Plate posts. */
export function PasteThreadDialog({
  channel,
  editor,
  limit,
  onClose,
}: {
  channel: DraftChannel
  editor: React.MutableRefObject<PlateEditor | null>
  limit: number
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [length, setLength] = useState(limit)
  const [automatic, setAutomatic] = useState(false)
  const preview = useMemo(() => {
    try {
      return {
        posts: automatic ? splitThread(text, channel, length) : importedPosts(text),
        error: '',
      }
    } catch (error) {
      return { posts: [], error: (error as Error).message }
    }
  }, [text, channel, length, automatic])
  const insert = () => {
    const current = editor.current
    if (!current || !preview.posts.length) return
    if (postRanges(current.children).length + preview.posts.length > 25) {
      toast.error('The combined thread would exceed 25 posts.')
      return
    }
    current.tf.insertNodes(importedBody(preview.posts) as Value, { at: [current.children.length] })
    onClose()
    current.tf.focus()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paste as thread</DialogTitle>
          <DialogDescription>
            Separate posts with a line containing --- or four line breaks. Review the split before
            adding posts.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Thread text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          maxLength={100_000}
        />
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
          Split by post length
        </label>
        {automatic && (
          <label className="text-sm">
            Maximum post length
            <Input
              type="number"
              min={23}
              max={limit}
              value={length}
              onChange={(event) => setLength(Number(event.target.value))}
            />
          </label>
        )}
        {preview.error && <p role="alert">{preview.error}</p>}
        <ol className="grid max-h-60 gap-3 overflow-auto text-sm">
          {preview.posts.map((post, index) => (
            <li className="whitespace-pre-wrap rounded border p-2" key={index}>
              <strong>{index + 1}.</strong> {post}
            </li>
          ))}
        </ol>
        <Button
          disabled={!preview.posts.length || Boolean(preview.error) || length > limit}
          onClick={insert}
        >
          Append {preview.posts.length} posts
        </Button>
      </DialogContent>
    </Dialog>
  )
}
