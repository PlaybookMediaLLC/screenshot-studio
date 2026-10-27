'use client'

import { BaseEditorKit } from '@shots/platejs-editor/components'
import { Plate, usePlateEditor } from '@shots/platejs-editor/platejs/react'
import { Editor, EditorContainer } from '@shots/platejs-editor/ui'
import type { Value } from '@shots/platejs-editor/platejs'

/** The existing Plate document model, with the full Write editor available after planning. */
export default function QuickBody({
  value,
  onChange,
}: {
  value: Value
  onChange: (value: Value) => void
}) {
  const editor = usePlateEditor({ plugins: BaseEditorKit, value })
  return (
    <Plate editor={editor} onValueChange={({ value }) => onChange(value)}>
      <EditorContainer className="max-h-64 min-h-32 overflow-auto rounded-lg border">
        <Editor aria-label="Post content" placeholder="What would you like to share?" />
      </EditorContainer>
    </Plate>
  )
}
