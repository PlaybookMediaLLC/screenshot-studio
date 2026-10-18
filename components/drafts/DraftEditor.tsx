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
import {
  Plate,
  type PlateEditor,
  useEditorRef,
  usePlateEditor,
  usePluginOption,
} from '@shots/platejs-editor/platejs/react'
import { createYjsPlugin, YjsPlugin } from '@shots/platejs-editor/collaboration'
import { commentPlugin, discussionPlugin, type TDiscussion } from '@shots/platejs-editor/plugins'
import {
  Editor,
  EditorContainer,
  EditorStatic,
  MarkToolbarButton,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
} from '@shots/platejs-editor/ui'
import { MoreHorizontalIcon } from 'hugeicons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DraftDiscussions } from '@/lib/content-drafts/discussions'
import { cn } from '@/lib/utils'
import { POST_COLUMN } from './layout'

/**
 * The document editor for a content draft: the vendored Plate.js editor with
 * the full kit, wired to the platform's uploads and AI. Loaded with
 * next/dynamic on the composer route only, because the kit is heavy.
 */

export type DraftEditorUser = { id: string; name: string }

/** A live session: the collab server's URL and the draft it edits. */
export type DraftCollaboration = { draftId: string; url: string }

export type DraftEditorProps = {
  collaboration: DraftCollaboration | null
  /** Shown above the text, in the post column: who the post is from. */
  header?: React.ReactNode
  /** Comment threads stored with the draft. */
  initialDiscussions: DraftDiscussions
  initialValue: Value
  onChange: (value: Value) => void
  /** Called when someone adds, edits, resolves or deletes a comment. */
  onDiscussionsChange: (discussions: DraftDiscussions) => void
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

/** A stable, readable colour per member for their cursor and presence chip. */
function colorFor(userId: string): string {
  let hash = 0
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hash} 70% 45%)`
}

async function collabToken(draftId: string): Promise<string> {
  const response = await fetch(
    `/api/v1/content-drafts/${encodeURIComponent(draftId)}/collab-token`,
    {
      method: 'POST',
    }
  )
  if (!response.ok) throw new Error(`Collaboration token refused (${response.status}).`)
  return ((await response.json()) as { token: string }).token
}

/**
 * The editor's frame. While comments are open it keeps a column on the right
 * for them, so a thread sits beside the post rather than over the text.
 */
function CommentColumn({ children }: { children: React.ReactNode }) {
  const activeId = usePluginOption(commentPlugin, 'activeId')
  const discussions = usePluginOption(discussionPlugin, 'discussions')
  const open = Boolean(activeId) || discussions.some((discussion) => !discussion.isResolved)
  return (
    <EditorContainer
      className={cn('min-h-[240px] transition-[padding]', open && 'sm:pr-80')}
      data-testid="draft-editor"
    >
      {children}
    </EditorContainer>
  )
}

/** Every user the plugin shows needs an avatar URL; stored users carry none. */
function withAvatars(users: DraftDiscussions['users']) {
  return Object.fromEntries(
    Object.entries(users).map(([id, person]) => [id, { avatarUrl: '', id, name: person.name }])
  )
}

/** Reports comment changes, so the composer saves them with the draft. */
function DiscussionsWatcher({ onChange }: { onChange: (discussions: DraftDiscussions) => void }) {
  const threads = usePluginOption(discussionPlugin, 'discussions')
  const users = usePluginOption(discussionPlugin, 'users')
  const first = React.useRef(threads)
  React.useEffect(() => {
    if (threads === first.current) return
    onChange({
      threads: threads as DraftDiscussions['threads'],
      users: Object.fromEntries(
        Object.entries(users).map(([id, person]) => [id, { id, name: person.name }])
      ),
    })
  }, [onChange, threads, users])
  return null
}

/** Who else is in the draft right now, from the session's awareness. */
function Presence() {
  const editor = useEditorRef()
  const awareness = editor.getOptions(YjsPlugin).awareness
  const [people, setPeople] = React.useState<{ color: string; name: string }[]>([])
  React.useEffect(() => {
    const update = () =>
      setPeople(
        [...awareness.getStates().values()].flatMap((state) => {
          const data = (state as { data?: { color?: string; name?: string } }).data
          return data?.name ? [{ color: data.color ?? 'gray', name: data.name }] : []
        })
      )
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [awareness])
  return (
    // Who else is here sits above the post, at the column's right edge.
    <div className="absolute -top-12 right-6 flex flex-wrap gap-1.5" data-testid="presence">
      {people.map((person, index) => (
        <span
          className="rounded-full px-2 py-0.5 text-xs text-white"
          key={`${person.name}-${index}`}
          style={{ background: person.color }}
        >
          {person.name}
        </span>
      ))}
    </div>
  )
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

/** Import and export, out of the writing toolbar's way behind one button. */
function DocumentMenu({
  exports,
  files,
}: {
  exports: { label: string; run: () => void | Promise<void> }[]
  files: { accept: string; label: string; onFile: (file: File) => void }[]
}) {
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({})
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton aria-label="Import and export" tooltip="Import and export">
            <MoreHorizontalIcon aria-hidden className="size-4" />
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          {files.map((file) => (
            <DropdownMenuItem key={file.label} onSelect={() => inputs.current[file.label]?.click()}>
              {file.label}
            </DropdownMenuItem>
          ))}
          {exports.map((item) => (
            <DropdownMenuItem key={item.label} onSelect={() => void item.run()}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {files.map((file) => (
        <input
          accept={file.accept}
          aria-label={file.label}
          className="hidden"
          key={file.label}
          onChange={(event) => {
            const picked = event.target.files?.[0]
            event.target.value = ''
            if (picked) file.onFile(picked)
          }}
          ref={(element) => {
            inputs.current[file.label] = element
          }}
          type="file"
        />
      ))}
    </>
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
    <Toolbar className="flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-[#161616]/95 px-1.5 py-1 shadow-xl shadow-black/40 backdrop-blur">
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
        <DocumentMenu
          files={[
            {
              accept:
                '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              label: 'Import DOCX',
              onFile: importDocument,
            },
            { accept: '.md,text/markdown', label: 'Import Markdown', onFile: importMarkdown },
          ]}
          exports={[
            { label: 'Export DOCX', run: exportDocument },
            { label: 'Export Markdown', run: exportMarkdown },
          ]}
        />
      </ToolbarGroup>
    </Toolbar>
  )
}

export default function DraftEditor({
  collaboration,
  header,
  initialDiscussions: storedDiscussions,
  initialValue,
  onChange,
  onDiscussionsChange,
  readOnly,
  services,
  title,
  user,
}: DraftEditorProps) {
  // Read once: later saves must not re-seed the plugin and reset its state.
  const [initialDiscussions] = React.useState(storedDiscussions)
  const plugins = React.useMemo(() => {
    const live = collaboration
      ? createYjsPlugin(
          {
            access: readOnly ? 'read' : 'write',
            documentName: `content-draft:${collaboration.draftId}`,
            getToken: () => collabToken(collaboration.draftId),
            hocuspocusUrl: collaboration.url,
            // WebRTC stays off: it would need our own signaling and TURN servers.
            webrtc: null,
          },
          { color: colorFor(user.id), name: user.name, userId: user.id }
        )
      : null
    return createEditorKit({
      additionalPlugins: live ? [live] : [],
      // Comments and suggestions are authored by the signed-in member, not
      // the upstream demo users.
      overridePlugins: [
        // Comments sit in a column beside the post; only a phone-narrow
        // editor falls back to opening them over the text.
        commentPlugin.configure({ options: { overlapWidth: 400 } }),
        discussionPlugin.configure({
          options: {
            currentUserId: user.id,
            discussions: initialDiscussions.threads as TDiscussion[],
            users: {
              ...withAvatars(initialDiscussions.users),
              [user.id]: { avatarUrl: '', id: user.id, name: user.name },
            },
          },
        }),
      ],
    })
  }, [collaboration, initialDiscussions, readOnly, user.id, user.name])
  // Mentions offer the signed-in member instead of the upstream demo list.
  React.useEffect(() => {
    setMentionUsers([{ id: user.id, name: user.name }])
  }, [user.id, user.name])
  const editor = usePlateEditor({
    plugins,
    readOnly,
    // A live session takes its value from the shared document instead.
    skipInitialization: Boolean(collaboration),
    value: collaboration ? undefined : initialValue.length > 0 ? initialValue : EMPTY_VALUE,
  })
  const firstValue = React.useRef(initialValue)
  // Plate renders the editable only once the editor has content; a live
  // session gets it asynchronously, so the editable remounts when it arrives.
  const [live, setLive] = React.useState(false)
  React.useEffect(() => {
    if (!collaboration) return
    const yjs = editor.getApi(YjsPlugin).yjs
    let started = false
    // Deferred a tick: React may mount, unmount and remount at once (Strict
    // Mode), and a session cannot connect twice. The discarded mount never starts.
    const start = setTimeout(() => {
      started = true
      // The stored body seeds the shared document the first time it is opened.
      void yjs
        .init({
          autoSelect: 'end',
          id: `content-draft:${collaboration.draftId}`,
          value: firstValue.current.length > 0 ? firstValue.current : EMPTY_VALUE,
        })
        .then(() => setLive(true))
        .catch((error: unknown) => console.error('[drafts] live session failed', error))
    }, 0)
    return () => {
      clearTimeout(start)
      if (started) yjs.destroy()
    }
  }, [collaboration, editor])

  return (
    <EditorServicesProvider services={services}>
      <Plate editor={editor} onValueChange={({ value }) => onChange(value)} readOnly={readOnly}>
        {collaboration ? <Presence /> : null}
        <DiscussionsWatcher onChange={onDiscussionsChange} />
        <CommentColumn key={live ? 'live' : 'local'}>
          {header ? <div className={cn('pt-10', POST_COLUMN)}>{header}</div> : null}
          <Editor
            aria-label="Draft body"
            className={cn(POST_COLUMN, 'pt-1 pb-12 text-[15px] leading-relaxed')}
            placeholder="What do you want to say?"
            variant="default"
          />
        </CommentColumn>
        {readOnly ? null : (
          // The formatting bar floats at the bottom of the page, out of the text's way.
          <div className="pointer-events-none sticky bottom-5 z-10 flex justify-center">
            <div className="pointer-events-auto">
              <DraftToolbar editor={editor} services={services} title={title} />
            </div>
          </div>
        )}
      </Plate>
    </EditorServicesProvider>
  )
}
