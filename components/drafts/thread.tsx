'use client'

import * as React from 'react'
import {
  createPlatePlugin,
  PlateElement,
  type PlateEditor,
  type PlateElementProps,
  useEditorSelector,
  useEditorVersion,
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

function PostBreakElement(props: PlateElementProps) {
  const header = React.useContext(PostHeaderContext)
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
        {header(number)}
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
  const header = React.useContext(PostHeaderContext)
  return <div className={cn('pt-10', POST_COLUMN)}>{header(1)}</div>
}
