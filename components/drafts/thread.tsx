'use client'

import * as React from 'react'
import {
  createPlatePlugin,
  PlateElement,
  type PlateEditor,
  type PlateElementProps,
  useEditorRef,
  useEditorSelector,
  useEditorVersion,
  useReadOnly,
} from '@shots/platejs-editor/platejs/react'
import { KEYS, type Value } from '@shots/platejs-editor/platejs'
import { POST_BREAK } from '@/lib/content-drafts/serialize'
import { cn } from '@/lib/utils'
import { POST_COLUMN } from './layout'

/**
 * Threads (RFC 037): a draft is one or more posts. A post break block starts
 * the next one, drawn as that post's header, and a line joins the avatars.
 * X posts each post as a reply to the last; other channels join them.
 */

/** The header the host draws for post `number` (1-based) of the thread. */
export const PostHeaderContext = React.createContext<(number: number) => React.ReactNode>(
  () => null
)

/** The draft for a document export: each post break becomes a horizontal rule. */
export function threadAsRules(value: Value): Value {
  return value.map((node) =>
    node.type === POST_BREAK ? { children: [{ text: '' }], type: KEYS.hr } : node
  )
}

/** Each post's top-level blocks as [start, end) indexes, breaks left out. */
export function postRanges(children: Value): [number, number][] {
  const ranges: [number, number][] = []
  let start = 0
  children.forEach((node, index) => {
    if (node.type !== POST_BREAK) return
    ranges.push([start, index])
    start = index + 1
  })
  ranges.push([start, children.length])
  return ranges
}

/**
 * Move post `from` to position `to` (both 1-based). The posts are put in
 * their new order with a break between each pair, by moving the existing
 * nodes, so a live session and undo see plain moves.
 */
export function movePost(editor: PlateEditor, from: number, to: number): void {
  const children = editor.children
  const ranges = postRanges(children)
  if (from === to || from < 1 || to < 1 || from > ranges.length || to > ranges.length) return
  const posts = ranges.map(([start, end]) => children.slice(start, end))
  const breaks = children.filter((node) => node.type === POST_BREAK)
  const [moved] = posts.splice(from - 1, 1)
  posts.splice(to - 1, 0, moved)
  const desired = posts.flatMap((nodes, index) =>
    index === 0 ? nodes : [breaks[index - 1], ...nodes]
  )
  editor.tf.withoutNormalizing(() => {
    desired.forEach((node, index) => {
      const at = editor.children.indexOf(node)
      if (at !== index) editor.tf.moveNodes({ at: [at], to: [index] })
    })
  })
}

/** Remove post `number` and the break that set it apart. */
export function deletePost(editor: PlateEditor, number: number): void {
  const ranges = postRanges(editor.children)
  if (ranges.length < 2) return
  const [start, end] = ranges[number - 1]
  // The first post takes the break after it; any other, the break before.
  const [from, to] = number === 1 ? [start, end + 1] : [start - 1, end]
  editor.tf.withoutNormalizing(() => {
    for (let index = to - 1; index >= from; index -= 1) editor.tf.removeNodes({ at: [index] })
  })
}

/** Put the caret at the end of post `number`, to insert into it there. */
export function selectPostEnd(editor: PlateEditor, number: number): void {
  const [start, end] = postRanges(editor.children)[number - 1]
  if (end > start) editor.tf.select(editor.api.end([end - 1]))
  editor.tf.focus()
}

/** Split the post at the caret: what follows the caret starts the next post. */
export function splitPostAtCaret(editor: PlateEditor): void {
  if (!editor.selection) return
  editor.tf.splitNodes({ always: true, mode: 'highest' })
  const entry = editor.api.block({ highest: true })
  if (!entry) return
  editor.tf.insertNodes({ children: [{ text: '' }], type: POST_BREAK }, { at: [entry[1][0]] })
  editor.tf.select(editor.api.start([entry[1][0] + 1]))
}

/** Start a new post after the block holding the caret, and move into it. */
export function insertPostBreak(editor: PlateEditor): void {
  const entry = editor.api.block({ highest: true })
  const at = entry ? entry[1][0] + 1 : editor.children.length
  editor.tf.insertNodes(
    [
      { children: [{ text: '' }], type: POST_BREAK },
      { children: [{ text: '' }], type: 'p' },
    ],
    { at: [at] }
  )
  editor.tf.select([at + 1], { edge: 'start' })
  editor.tf.focus()
}

function isEmptyParagraph(node: unknown): boolean {
  const block = node as { children?: { text?: string }[]; type?: string } | undefined
  return (
    block?.type === 'p' &&
    (block.children ?? []).every((child) => typeof child.text === 'string' && !child.text)
  )
}

/**
 * The post break block. ⌘↵ (Ctrl+↵) starts a new post anywhere, and so does
 * Enter on the second empty line in a row, as in Typefully.
 */
export const PostBreakPlugin = createPlatePlugin({
  handlers: {
    onKeyDown: ({ editor, event }) => {
      if (event.key !== 'Enter' || event.shiftKey || event.altKey) return
      if (event.metaKey || event.ctrlKey) return
      const entry = editor.api.block({ highest: true })
      const index = entry?.[1][0] ?? 0
      if (!entry || index === 0 || !isEmptyParagraph(entry[0])) return
      if (!isEmptyParagraph(editor.children[index - 1])) return
      event.preventDefault()
      editor.tf.withoutNormalizing(() => {
        editor.tf.removeNodes({ at: [index] })
        editor.tf.removeNodes({ at: [index - 1] })
        editor.tf.select(index - 2 >= 0 ? editor.api.end([index - 2]) : [0])
      })
      insertPostBreak(editor)
      return true
    },
  },
  key: POST_BREAK,
  node: { component: PostBreakElement, isElement: true, isVoid: true },
  priority: 1000,
  shortcuts: {
    // Ahead of the kit's exit break, which also takes ⌘↵.
    newPost: {
      handler: ({ editor }) => insertPostBreak(editor),
      keys: 'mod+enter',
      priority: 1000,
    },
  },
})

/** A post's header with its tools: reorder, add an image, delete. */
function PostHead({ number }: { number: number }) {
  const header = React.useContext(PostHeaderContext)
  const tools = React.useContext(PostToolsContext)
  const editor = useEditorRef()
  const readOnly = useReadOnly()
  const count = useEditorSelector((current) => postRanges(current.children).length, [])
  const [over, setOver] = React.useState(false)
  const button =
    'flex size-6 items-center justify-center rounded-md text-neutral-500 hover:bg-white/[0.06] hover:text-white disabled:opacity-30'
  return (
    <div
      className={cn('group/post flex items-start gap-2 rounded-lg', over && 'bg-sky-400/[0.06]')}
      onDragLeave={() => setOver(false)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(POST_DRAG)) return
        event.preventDefault()
        setOver(true)
      }}
      onDrop={(event) => {
        const from = Number(event.dataTransfer.getData(POST_DRAG))
        setOver(false)
        if (!from) return
        event.preventDefault()
        movePost(editor, from, number)
      }}
    >
      <div className="min-w-0 flex-1">{header(number)}</div>
      {readOnly || count < 2 ? null : (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/post:opacity-100 focus-within:opacity-100">
          <span
            aria-label={`Drag post ${number}`}
            className={cn(button, 'cursor-grab')}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(POST_DRAG, String(number))
              event.dataTransfer.effectAllowed = 'move'
            }}
            role="img"
          >
            ⠿
          </span>
          <button
            aria-label={`Move post ${number} up`}
            className={button}
            disabled={number === 1}
            onClick={() => movePost(editor, number, number - 1)}
            type="button"
          >
            ↑
          </button>
          <button
            aria-label={`Move post ${number} down`}
            className={button}
            disabled={number === count}
            onClick={() => movePost(editor, number, number + 1)}
            type="button"
          >
            ↓
          </button>
          {tools.addImage ? (
            <button
              aria-label={`Add an image to post ${number}`}
              className={button}
              onClick={() => {
                selectPostEnd(editor, number)
                tools.addImage?.()
              }}
              type="button"
            >
              ▣
            </button>
          ) : null}
          <button
            aria-label={`Delete post ${number}`}
            className={cn(button, 'hover:text-red-400')}
            onClick={() => deletePost(editor, number)}
            type="button"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

/** The drag type a post header carries, so other drops are left alone. */
const POST_DRAG = 'application/x-shots-post'

/** What a post's tools can do beyond the editor itself. */
export const PostToolsContext = React.createContext<{ addImage?: () => void }>({})

function PostBreakElement(props: PlateElementProps) {
  const { element } = props
  // Count the breaks before this one: inserting one above renumbers it.
  const number = useEditorSelector(
    (editor) => {
      const path = editor.api.findPath(element)
      if (!path) return 2
      return editor.children.slice(0, path[0]).filter((node) => node.type === POST_BREAK).length + 2
    },
    [element]
  )
  return (
    <PlateElement {...props} className="pt-8">
      <div className="select-none" contentEditable={false}>
        <PostHead number={number} />
      </div>
      {props.children}
    </PlateElement>
  )
}

/**
 * The line that joins a thread's avatars, drawn in the gutter from the first
 * post's avatar to the last one's. Hidden for a single post.
 */
export function ThreadLine() {
  const version = useEditorVersion()
  const ref = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState<{ height: number; left: number; top: number } | null>(null)
  const [size, setSize] = React.useState(0)
  React.useEffect(() => {
    const container = ref.current?.parentElement
    if (!container) return
    const observer = new ResizeObserver(() => setSize((current) => current + 1))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  React.useLayoutEffect(() => {
    const container = ref.current?.parentElement
    const avatars = container?.querySelectorAll<HTMLElement>('[data-post-avatar]') ?? []
    if (!container || avatars.length < 2) return setBox(null)
    const origin = container.getBoundingClientRect()
    const first = avatars[0].getBoundingClientRect()
    const last = avatars[avatars.length - 1].getBoundingClientRect()
    setBox({
      height: last.top - first.bottom,
      left: first.left - origin.left + first.width / 2,
      top: first.bottom - origin.top + container.scrollTop,
    })
  }, [version, size])
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute w-px bg-white/10', !box && 'hidden')}
      ref={ref}
      style={box ?? undefined}
    />
  )
}

/** The editor's first post header, above the text, like every later one. */
export function FirstPostHeader() {
  return (
    <div className={cn('pt-10', POST_COLUMN)}>
      <PostHead number={1} />
    </div>
  )
}
