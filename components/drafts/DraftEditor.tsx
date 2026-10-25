'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
const LibraryAssetPicker = dynamic(
  () =>
    import('@/components/platform-hub/LibraryAssetPicker').then(
      (module) => module.LibraryAssetPicker
    ),
  { ssr: false }
)
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
  useEditorMounted,
  usePlateEditor,
  usePluginOption,
} from '@shots/platejs-editor/platejs/react'
import { createYjsPlugin, YjsPlugin } from '@shots/platejs-editor/collaboration'
import {
  BlockPlaceholderKit,
  BlockSelectionKit,
  commentPlugin,
  discussionPlugin,
  type TDiscussion,
} from '@shots/platejs-editor/plugins'
import {
  Editor,
  EditorContainer,
  EditorStatic,
  MarkToolbarButton,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
} from '@shots/platejs-editor/ui'
import { DotsThreeIcon as MoreHorizontalIcon } from '@phosphor-icons/react/dist/ssr/DotsThree'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DraftDiscussions } from '@/lib/content-drafts/discussions'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { cn } from '@/lib/utils'
import { POST_COLUMN } from './layout'
import {
  insertPostBreak,
  insertPostAfter,
  postRanges,
  PostBreakPlugin,
  PostHeaderContext,
  type PostTools,
  PostToolsContext,
  splitPostAtCaret,
  ThreadLine,
  threadAsRules,
} from './thread'
import { normalizePosts, postBreak } from '@/lib/write/versions'
import type { PlateBody } from '@/lib/write/document'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { pendingDraftConnectionError, takePendingDraft } from '@/components/write/pending-draft'
import type { z } from 'zod'
import type { textDirectionSchema } from '@/lib/api/contracts/settings-platform'

/**
 * The document editor for a content draft: the vendored Plate.js editor with
 * the full kit, wired to the platform's uploads and AI. Loaded with
 * next/dynamic on the composer route only, because the kit is heavy.
 */

export type DraftEditorUser = { id: string; name: string }

/** A live session: the collab server's URL and the draft it edits. */
export type DraftCollaboration = { draftId: string; url: string }

/** Hashtags the workspace uses, one click from the post. */
function HashtagChips({ hashtags }: { hashtags: string[] }) {
  const editor = useEditorRef()
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 pb-6', POST_COLUMN)}>
      <span className="text-[11px] text-muted-foreground">Your hashtags</span>
      {hashtags.map((tag) => (
        <Button
          variant="custom"
          size={null}
          className="rounded-full border border-foreground/[0.08] px-2 py-0.5 text-xs text-foreground/65 hover:border-sky-400/40 hover:text-foreground"
          key={tag}
          onClick={() => {
            // At the caret, or at the end of the draft when there is none.
            if (!editor.selection) editor.tf.select(editor.api.end([]))
            editor.tf.insertText(` #${tag}`)
            editor.tf.focus()
          }}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          #{tag}
        </Button>
      ))}
    </div>
  )
}

export type DraftEditorProps = {
  /** The direction text runs in, from Appearance settings. */
  textDirection?: z.infer<typeof textDirectionSchema>
  collaboration: DraftCollaboration | null
  draftId?: string
  /** The editor, once made: the host restores revisions through it. */
  onEditor?: (editor: PlateEditor) => void
  /** @handles the workspace already writes, offered in the @ picker. */
  handles: string[]
  /** Hashtags the workspace already writes, offered as chips. */
  hashtags: string[]
  /** Each post's header, by its 1-based number in the thread: who it is from. */
  postHeader: (number: number) => React.ReactNode
  /** Per-post settings tools for the platform being edited. */
  postSettings?: PostTools['settings']
  /** Extra buttons for the bottom toolbar: numbering, finishers, platform tools. */
  toolbarExtras?: React.ReactNode
  /** Plugins the host adds, such as social mentions. */
  extraPlugins?: unknown[]
  /** Collaboration is off for a platform's own version: it saves with the draft. */
  documentName?: string
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

/** A new body: one post, empty. */
function emptyValue(): Value {
  return [postBreak(), { children: [{ text: '' }], type: 'p' }] as Value
}

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
  const wrapper = React.useRef<HTMLDivElement>(null)
  const [wide, setWide] = React.useState(false)
  React.useEffect(() => {
    if (!wrapper.current) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 900))
    observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={wrapper}>
      <EditorContainer
        className={cn('h-auto min-h-[160px]', open && wide && 'pr-80')}
        data-testid="draft-editor"
      >
        {children}
      </EditorContainer>
    </div>
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
  // Only a change to the threads or people is news: the host's callback is
  // often a new function each render, and reacting to that saved forever.
  const report = React.useEffectEvent(() =>
    onChange({
      threads: threads as DraftDiscussions['threads'],
      users: Object.fromEntries(
        Object.entries(users).map(([id, person]) => [id, { id, name: person.name }])
      ),
    })
  )
  React.useEffect(() => {
    if (threads === first.current) return
    report()
  }, [threads, users])
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
    <div className="flex flex-wrap justify-end gap-1.5 px-6 py-2" data-testid="presence">
      {people.map((person, index) => (
        <span
          className="rounded-full px-2 py-0.5 text-xs text-foreground"
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
  inputRef,
  label,
  onFile,
}: {
  accept: string
  children: React.ReactNode
  /** The hidden picker, for opening it from elsewhere. */
  inputRef?: React.RefObject<HTMLInputElement | null>
  label: string
  onFile: (file: File) => void
}) {
  const own = React.useRef<HTMLInputElement>(null)
  const input = inputRef ?? own
  return (
    <>
      <ToolbarButton aria-label={label} onClick={() => input.current?.click()} tooltip={label}>
        {children}
      </ToolbarButton>
      <Input
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
      aria-label={label}
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
        <Input
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
  imageInput,
  services,
  title,
  extras,
}: {
  editor: PlateEditor
  imageInput: React.RefObject<HTMLInputElement | null>
  services: EditorServices
  title: string
  extras?: React.ReactNode
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
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const exportDocument = async () => {
    const { exportToDocx } = await import('@shots/platejs-editor/@platejs/docx-io')
    const blob = await exportToDocx(threadAsRules(editor.children), {
      editorPlugins: BaseEditorKit,
      editorStaticComponent: EditorStatic,
      title,
    })
    download(blob, `${fileSlug(title)}.docx`)
  }
  const exportMarkdown = () => {
    const markdown = editor
      .getApi({ key: KEYS.markdown })
      .markdown.serialize({ value: threadAsRules(editor.children) })
    download(new Blob([markdown], { type: 'text/markdown' }), `${fileSlug(title)}.md`)
  }

  return (
    <Toolbar
      aria-label="Draft formatting"
      className="flex flex-wrap items-center justify-center gap-0.5 rounded-2xl border border-foreground/[0.08] bg-secondary/95 px-1.5 py-1 shadow-xl shadow-black/40 backdrop-blur"
    >
      <ToolbarGroup>
        <MarkToolbarButton aria-label="Bold" nodeType={KEYS.bold} tooltip="Bold">
          <span className="font-bold">B</span>
        </MarkToolbarButton>
        <MarkToolbarButton aria-label="Italic" nodeType={KEYS.italic} tooltip="Italic">
          <span className="italic">I</span>
        </MarkToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <InsertButton editor={editor} insert={() => insertPostBreak(editor)} label="Add post">
          + Post
        </InsertButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <FileButton
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          inputRef={imageInput}
          label="Insert media"
          onFile={(file) => {
            // The media plugin takes a FileList, as from a drop or a picker.
            const files = new DataTransfer()
            files.items.add(file)
            editor.getTransforms(PlaceholderPlugin).insert.media(files.files)
          }}
        >
          Media
        </FileButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          aria-label="Attach from Library"
          tooltip="Attach from Library"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setLibraryOpen(true)}
        >
          Library
        </ToolbarButton>
      </ToolbarGroup>
      {libraryOpen ? (
        <LibraryAssetPicker
          onClose={() => {
            setLibraryOpen(false)
            editor.tf.focus()
          }}
          onInsert={(node) => {
            if (!editor.selection) editor.tf.select(editor.api.end([]))
            editor.tf.insertNodes(node)
            editor.tf.focus()
          }}
        />
      ) : null}
      {extras ? <ToolbarGroup>{extras}</ToolbarGroup> : null}
      <ToolbarGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarButton aria-label="Insert" tooltip="Insert">
              Insert ▾
            </ToolbarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              editor.tf.focus()
            }}
          >
            {[
              { label: 'Table', insert: () => insertBlock(editor, KEYS.table) },
              { label: 'Math', insert: () => insertBlock(editor, KEYS.equation) },
              {
                label: 'Footnote',
                insert: () => insertInlineElement(editor, KEYS.footnoteReference),
              },
              { label: 'Split post at caret', insert: () => splitPostAtCaret(editor) },
            ].map((item) => (
              <DropdownMenuItem
                key={item.label}
                onSelect={() => {
                  item.insert()
                  editor.tf.focus()
                }}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
            <p className="max-w-64 px-2 py-1 text-xs text-muted-foreground">
              Tables and math publish as images. Footnotes publish as text.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
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
  draftId,
  textDirection = 'ltr',
  onEditor,
  handles,
  hashtags,
  postHeader,
  postSettings,
  toolbarExtras,
  extraPlugins,
  documentName,
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
            documentName: documentName ?? `content-draft:${collaboration.draftId}`,
            getToken: () => collabToken(collaboration.draftId),
            hocuspocusUrl: collaboration.url,
            // WebRTC stays off: it would need our own signaling and TURN servers.
            webrtc: null,
          },
          { color: colorFor(user.id), name: user.name, userId: user.id }
        )
      : null
    const hosted = (extraPlugins ?? []) as (typeof PostBreakPlugin)[]
    return createEditorKit({
      recipe: 'collaborative',
      // Social handles remain literal; resolved platform mentions use the dedicated picker.
      excludePluginKeys: ['mention', 'mention_input', 'autoformatShortcuts'],
      additionalPlugins: live ? [PostBreakPlugin, ...hosted, live] : [PostBreakPlugin, ...hosted],
      // Comments and suggestions are authored by the signed-in member, not
      // the upstream demo users.
      overridePlugins: [
        BlockSelectionKit[0].configure({ options: { disableSelectAll: true } }),
        BlockPlaceholderKit[0].configure({
          options: { placeholders: { [KEYS.p]: 'What would you like to share?' } },
        }),
        // Comments sit in a column beside the post; only a phone-narrow
        // editor falls back to opening them over the text.
        commentPlugin.configure({ options: { overlapWidth: 580 } }),
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
  }, [collaboration, documentName, extraPlugins, initialDiscussions, readOnly, user.id, user.name])
  // Mentions offer the signed-in member and the handles the workspace already
  // writes, instead of the upstream demo list.
  const handleList = handles.join(' ')
  React.useEffect(() => {
    setMentionUsers([
      { id: user.id, name: user.name },
      ...handleList
        .split(' ')
        .filter(Boolean)
        .map((handle) => ({ id: `handle:${handle}`, name: handle })),
    ])
  }, [handleList, user.id, user.name])
  const editor = usePlateEditor({
    plugins,
    readOnly,
    // A live session takes its value from the shared document instead.
    skipInitialization: Boolean(collaboration),
    value: collaboration
      ? undefined
      : initialValue.length > 0
        ? (normalizePosts(initialValue as PlateBody) as Value)
        : emptyValue(),
  })
  const [live, setLive] = React.useState(false)
  const reportEditor = React.useEffectEvent(() => onEditor?.(editor))
  React.useEffect(() => {
    // External tools read editor.children immediately. Report the collaborative
    // editor only after its initial snapshot is ready, never the empty shell.
    if (collaboration && !live) return
    reportEditor()
  }, [collaboration, editor, live])
  const firstValue = React.useRef(initialValue)
  const [initiallyEmpty] = React.useState(() => draftPlainText(initialValue).length === 0)
  React.useEffect(() => {
    if (!collaboration && !readOnly && draftPlainText(firstValue.current).length === 0) {
      editor.tf.select(editor.api.end([])!)
    }
  }, [collaboration, editor, readOnly])
  // Plate renders the editable only once the editor has content; a live
  // session gets it asynchronously, so the editable remounts when it arrives.
  React.useEffect(() => {
    if (!collaboration) return
    const yjs = editor.getApi(YjsPlugin).yjs
    let started = false
    let initialized = false
    let cancelled = false
    const ready = () => {
      if (
        !cancelled &&
        initialized &&
        editor
          .getOptions(YjsPlugin)
          ._providers.some((provider) => provider.type === 'hocuspocus' && provider.isSynced)
      )
        setLive(true)
    }
    editor.setOption(YjsPlugin, 'onSyncChange', ready)
    editor.setOption(YjsPlugin, 'onError', () => {
      if (draftId) pendingDraftConnectionError(draftId, () => yjs.connect('hocuspocus'))
    })
    // Deferred a tick: React may mount, unmount and remount at once (Strict
    // Mode), and a session cannot connect twice. The discarded mount never starts.
    const start = setTimeout(() => {
      started = true
      // The stored body seeds the shared document the first time it is opened.
      void yjs
        .init({
          autoSelect: 'end',
          id: `content-draft:${collaboration.draftId}`,
          value:
            firstValue.current.length > 0
              ? (normalizePosts(firstValue.current as PlateBody) as Value)
              : emptyValue(),
        })
        .then(() => {
          initialized = true
          ready()
        })
        .catch((error: unknown) => console.error('[drafts] live session failed', error))
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(start)
      if (started) yjs.destroy()
    }
  }, [collaboration, draftId, editor])

  const imageInput = React.useRef<HTMLInputElement>(null)
  const postTools = React.useMemo<PostTools>(
    () => (readOnly ? {} : { addImage: () => imageInput.current?.click(), settings: postSettings }),
    [postSettings, readOnly]
  )
  return (
    <EditorServicesProvider services={services}>
      <PostHeaderContext.Provider value={postHeader}>
        <PostToolsContext.Provider value={postTools}>
          <Plate
            editor={editor}
            onValueChange={({ value }) => {
              if (!collaboration || live) onChange(value)
            }}
            readOnly={readOnly}
          >
            {collaboration ? <Presence /> : null}
            <DiscussionsWatcher onChange={onDiscussionsChange} />
            {!collaboration || live ? (
              <CommentColumn>
                <ThreadLine />
                <Editor
                  autoFocus={false}
                  aria-label="Draft body"
                  className={cn(
                    POST_COLUMN,
                    'min-h-0 pt-1 pb-4 text-[15px] leading-relaxed [&_[placeholder]]:before:pointer-events-none [&_[placeholder]]:before:absolute [&_[placeholder]]:before:text-neutral-400 [&_[placeholder]]:before:content-[attr(placeholder)]'
                  )}
                  dir={textDirection}
                  placeholder="What would you like to share?"
                  variant="default"
                />
                <ReadyEditor draftId={draftId} focus={!readOnly && initiallyEmpty} />
              </CommentColumn>
            ) : (
              <p role="status" className="p-6">
                Connecting your draft…
              </p>
            )}
            {readOnly ? null : (
              <div className={cn('pb-6', POST_COLUMN)}>
                <Button
                  variant="outline"
                  size="sm"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertPostAfter(editor, postRanges(editor.children).length)}
                >
                  Add another post
                </Button>
              </div>
            )}
            {readOnly || hashtags.length === 0 ? null : <HashtagChips hashtags={hashtags} />}
            {readOnly ? null : (
              // The formatting bar floats at the bottom of the page, out of the text's way.
              <div className="pointer-events-none sticky bottom-5 z-10 flex justify-center px-2">
                <div className="pointer-events-auto min-w-0 max-w-full">
                  <DraftToolbar
                    editor={editor}
                    extras={toolbarExtras}
                    imageInput={imageInput}
                    services={services}
                    title={title}
                  />
                </div>
              </div>
            )}
          </Plate>
        </PostToolsContext.Provider>
      </PostHeaderContext.Provider>
    </EditorServicesProvider>
  )
}

/** Focus once after Plate has mounted, never while a keystroke is being applied. */
function ReadyEditor({ draftId, focus }: { draftId?: string; focus: boolean }) {
  const editor = useEditorRef()
  const mounted = useEditorMounted()
  const done = React.useRef(false)
  React.useEffect(() => {
    if (!mounted || done.current) return
    done.current = true
    const pending = draftId ? takePendingDraft(draftId) : null
    if (
      pending !== null ||
      (focus && !document.activeElement?.matches('input,textarea,[contenteditable="true"]'))
    ) {
      editor.tf.select(editor.api.end([]))
      if (pending) editor.tf.insertText(pending)
      editor.tf.focus()
    }
  }, [draftId, editor, focus, mounted])
  return null
}
