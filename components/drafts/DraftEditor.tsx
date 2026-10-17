'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  BaseEditorKit,
  createEditorKit,
  insertBlock,
  insertInlineElement,
} from '@shots/platejs-editor/components'
import { PlaceholderPlugin } from '@shots/platejs-editor/@platejs/media/react'
import {
  EditorServicesProvider,
  type EditorServices,
  rehostDataImages,
} from '@shots/platejs-editor/lib'
import { KEYS, type Value } from '@shots/platejs-editor/platejs'
import { Plate, type PlateEditor, usePlateEditor } from '@shots/platejs-editor/platejs/react'
import { discussionPlugin } from '@shots/platejs-editor/plugins'
import {
  Editor,
  EditorContainer,
  EditorStatic,
  MarkToolbarButton,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
} from '@shots/platejs-editor/ui'

/**
 * The document editor for a content draft: the vendored Plate.js editor with
 * the full kit, wired to the platform's uploads and AI. Loaded with
 * next/dynamic on the composer route only, because the kit is heavy.
 */

export type DraftEditorUser = { id: string; name: string }

export type DraftEditorProps = {
  initialValue: Value
  onChange: (value: Value) => void
  readOnly: boolean
  services: EditorServices
  title: string
  user: DraftEditorUser
}

const EMPTY_VALUE: Value = [{ children: [{ text: '' }], type: 'p' }]

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** The package reads its mention list from a global (ComposerEditor sets it the same way). */
function setMentionUsers(users: DraftEditorUser[]): void {
  ;(
    globalThis as { __canvasComposerMentionUsers?: DraftEditorUser[] }
  ).__canvasComposerMentionUsers = users
}

function fileSlug(title: string): string {
  return (
    title
      .trim()
      .replace(/[^\w-]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'draft'
  )
}

/** Pick a file, hand it over, and reset the input so the same file can be picked again. */
function FileButton({
  accept,
  children,
  label,
  onFile,
}: {
  accept: string
  children: React.ReactNode
  label: string
  onFile: (file: File) => void
}) {
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <ToolbarButton onClick={() => input.current?.click()} tooltip={label}>
        {children}
      </ToolbarButton>
      <input
        accept={accept}
        aria-label={label}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
        ref={input}
        type="file"
      />
    </>
  )
}

/**
 * A toolbar button that inserts at the caret. Pressing it must not move focus
 * out of the editor, and the editor takes focus back after the insert, so
 * typing continues where the insert put the caret.
 */
function InsertButton({
  children,
  editor,
  insert,
  label,
}: {
  children: React.ReactNode
  editor: PlateEditor
  insert: () => void
  label: string
}) {
  return (
    <ToolbarButton
      onClick={() => {
        insert()
        editor.tf.focus()
      }}
      onMouseDown={(event) => event.preventDefault()}
      tooltip={label}
    >
      {children}
    </ToolbarButton>
  )
}

function DraftToolbar({
  editor,
  services,
  title,
}: {
  editor: PlateEditor
  services: EditorServices
  title: string
}) {
  const importDocument = async (file: File) => {
    try {
      // DOCX support (mammoth, the Word writer) loads on first use.
      const { importDocx } = await import('@shots/platejs-editor/@platejs/docx-io')
      const { nodes } = await importDocx(editor, await file.arrayBuffer())
      if (!services.uploadFile) throw new Error('Uploads are not available.')
      // Imported images arrive inline; store them as workspace assets.
      const stored = await rehostDataImages(nodes as Value, services.uploadFile)
      editor.tf.insertNodes(stored, { at: [editor.children.length] })
      toast.success(`Imported ${file.name}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The document could not be imported.')
    }
  }
  const importMarkdown = async (file: File) => {
    const nodes = editor.getApi({ key: KEYS.markdown }).markdown.deserialize(await file.text())
    editor.tf.insertNodes(nodes, { at: [editor.children.length] })
  }
  const exportDocument = async () => {
    const { exportToDocx } = await import('@shots/platejs-editor/@platejs/docx-io')
    const blob = await exportToDocx(editor.children, {
      editorPlugins: BaseEditorKit,
      editorStaticComponent: EditorStatic,
      title,
    })
    download(blob, `${fileSlug(title)}.docx`)
  }
  const exportMarkdown = () => {
    const markdown = editor.getApi({ key: KEYS.markdown }).markdown.serialize()
    download(new Blob([markdown], { type: 'text/markdown' }), `${fileSlug(title)}.md`)
  }

  return (
    <Toolbar className="flex flex-wrap gap-1 border-b border-white/[0.06] px-2 py-1.5">
      <ToolbarGroup>
        <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold">
          <span className="font-bold">B</span>
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic">
          <span className="italic">I</span>
        </MarkToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <InsertButton
          editor={editor}
          insert={() => insertBlock(editor, KEYS.table)}
          label="Insert table"
        >
          Table
        </InsertButton>
        <InsertButton
          editor={editor}
          insert={() => insertBlock(editor, KEYS.equation)}
          label="Insert math"
        >
          Math
        </InsertButton>
        <InsertButton
          editor={editor}
          insert={() => insertInlineElement(editor, KEYS.footnoteReference)}
          label="Insert footnote"
        >
          Footnote
        </InsertButton>
        <FileButton
          accept="image/png,image/jpeg,image/webp,image/gif"
          label="Insert image"
          onFile={(file) => {
            // The media plugin takes a FileList, as from a drop or a picker.
            const files = new DataTransfer()
            files.items.add(file)
            editor.getTransforms(PlaceholderPlugin).insert.media(files.files)
          }}
        >
          Image
        </FileButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <FileButton
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          label="Import DOCX"
          onFile={importDocument}
        >
          Import DOCX
        </FileButton>
        <ToolbarButton onClick={exportDocument} tooltip="Export DOCX">
          Export DOCX
        </ToolbarButton>
        <FileButton accept=".md,text/markdown" label="Import Markdown" onFile={importMarkdown}>
          Import Markdown
        </FileButton>
        <ToolbarButton onClick={exportMarkdown} tooltip="Export Markdown">
          Export Markdown
        </ToolbarButton>
      </ToolbarGroup>
    </Toolbar>
  )
}

export default function DraftEditor({
  initialValue,
  onChange,
  readOnly,
  services,
  title,
  user,
}: DraftEditorProps) {
  const plugins = React.useMemo(
    () =>
      createEditorKit({
        // Comments and suggestions are authored by the signed-in member, not
        // the upstream demo users.
        overridePlugins: [
          discussionPlugin.configure({
            options: {
              currentUserId: user.id,
              discussions: [],
              users: { [user.id]: { avatarUrl: '', id: user.id, name: user.name } },
            },
          }),
        ],
      }),
    [user.id, user.name]
  )
  // Mentions offer the signed-in member instead of the upstream demo list.
  React.useEffect(() => {
    setMentionUsers([{ id: user.id, name: user.name }])
  }, [user.id, user.name])
  const editor = usePlateEditor({
    plugins,
    readOnly,
    value: initialValue.length > 0 ? initialValue : EMPTY_VALUE,
  })

  return (
    <EditorServicesProvider services={services}>
      <Plate editor={editor} onValueChange={({ value }) => onChange(value)} readOnly={readOnly}>
        {readOnly ? null : <DraftToolbar editor={editor} services={services} title={title} />}
        <EditorContainer className="min-h-[420px]" data-testid="draft-editor">
          <Editor aria-label="Draft body" placeholder="Write your post…" variant="default" />
        </EditorContainer>
      </Plate>
    </EditorServicesProvider>
  )
}
