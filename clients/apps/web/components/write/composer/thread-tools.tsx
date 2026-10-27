'use client'

import * as React from 'react'
import type { PlateEditor } from '@shots/platejs-editor/platejs/react'
import type { Value } from '@shots/platejs-editor/platejs'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { splitThread } from '@/lib/write/split-thread'
import type { DraftChannel, PlateBody, VersionOptions } from '@/lib/write/document'

/** Explicit, undoable thread creation using the version's persisted length preference. */
export function ThreadTools({
  editor,
  channel,
  limit,
  options,
  onChange,
  pasted,
  onSplit,
}: {
  editor: React.RefObject<PlateEditor | null>
  channel: DraftChannel
  limit: number
  options: VersionOptions
  onChange: (options: VersionOptions) => void
  pasted?: boolean
  onSplit?: () => void
}) {
  const maxLength = Math.min(options.splitLimit ?? limit, limit)
  const performSplit = React.useCallback(() => {
    const current = editor.current
    if (!current) return
    try {
      const body = splitThread(current.children as PlateBody, channel, maxLength, options.numbering)
      current.tf.withNewBatch(() =>
        current.tf.withoutNormalizing(() => {
          for (let index = current.children.length - 1; index >= 0; index--)
            current.tf.removeNodes({ at: [index] })
          current.tf.insertNodes(body as Value, { at: [0] })
        })
      )
      current.tf.select(current.api.end([]))
      current.tf.focus()
      onSplit?.()
      toast.success('Thread created. Review the preview before scheduling.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The text could not be split.')
    }
  }, [editor, channel, maxLength, options.numbering, onSplit])
  const lastPaste = React.useRef(false)
  React.useEffect(() => {
    if (!pasted) {
      lastPaste.current = false
      return
    }
    if (!options.splitOnPaste || lastPaste.current) return
    lastPaste.current = true
    // Run after Plate's synchronous paste transaction has finished.
    window.setTimeout(performSplit, 0)
  }, [pasted, options.splitOnPaste, performSplit])
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-xs">
      {pasted ? (
        <p className="w-full text-muted-foreground" role="status">
          Pasted content is ready. Make thread splits it at your chosen length while keeping its
          formatting and links.
        </p>
      ) : null}
      <label className="flex items-center gap-2">
        Characters per post
        <Input
          aria-label="Characters per post"
          className="h-7 w-24"
          type="number"
          min={25}
          max={limit}
          value={maxLength}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isInteger(value) && value >= 25 && value <= limit)
              onChange({ ...options, splitLimit: value })
          }}
        />
      </label>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={options.splitOnPaste ?? false}
          onChange={(event) => onChange({ ...options, splitOnPaste: event.target.checked })}
        />
        Split automatically on paste
      </label>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          performSplit()
        }}
      >
        Make thread
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          const current = editor.current
          if (!current) return
          try {
            const text = draftPlainText(current.children)
            await navigator.clipboard.writeText(text)
            toast.success('Text copied.')
          } catch {
            toast.error('Copy failed. Select the text and copy it using your keyboard.')
          }
        }}
      >
        Copy text
      </Button>
    </div>
  )
}
