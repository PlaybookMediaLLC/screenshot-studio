'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import type { LayerOwner } from '@/lib/store-screenshots/commands/schema'
import type { RichText, TextLayer } from '@/lib/store-screenshots/document/schema'
import type { Point } from '@/lib/store-screenshots/engine/geometry'
import { nodeOutline } from '@/lib/store-screenshots/engine/hit-test'
import { applyMarks, commonMarks, normalizeSpans, type MarkChange, type SpanMarks } from '@/lib/store-screenshots/engine/rich-text'
import type { SceneText } from '@/lib/store-screenshots/engine/scene'
import { cn } from '@/lib/utils'
import { textNodeStyle } from '../../render/SlideRender'
import { spanStyle } from '../../render/text-style'
import { useEditorApi } from '../editor-store'
import { placeToolbar } from './toolbar-placement'

/**
 * Direct text editing on the canvas. The editable element uses the
 * renderer's CSS at slide size inside the scaled canvas, so what the user
 * types is laid out exactly as it will export. The DOM is managed
 * imperatively while editing; every change is parsed back into spans and
 * dispatched as a command (coalesced into one undo step per editing burst).
 */

const MARKS_ATTRIBUTE = 'data-marks'

function buildDom(element: HTMLElement, content: RichText, node: SceneText): void {
  element.replaceChildren()
  for (const span of content) {
    const child = document.createElement('span')
    const { text, ...marks } = span
    child.setAttribute(MARKS_ATTRIBUTE, JSON.stringify(marks))
    Object.assign(child.style, spanStyle(span, node.style))
    child.textContent = text
    element.appendChild(child)
  }
  if (!element.firstChild) element.appendChild(document.createTextNode(''))
}

function marksFor(node: Node, root: HTMLElement): SpanMarks {
  let current: Node | null = node
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.hasAttribute(MARKS_ATTRIBUTE)) {
      try {
        return JSON.parse(current.getAttribute(MARKS_ATTRIBUTE) ?? '{}') as SpanMarks
      } catch {
        return {}
      }
    }
    current = current.parentNode
  }
  return {}
}

/** Read spans back from the editable DOM. */
function parseDom(root: HTMLElement): RichText {
  const spans: RichText = []
  const visit = (node: Node, first: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      spans.push({ text: node.textContent ?? '', ...marksFor(node, root) })
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'BR') {
      spans.push({ text: '\n', ...marksFor(node, root) })
      return
    }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && !first) spans.push({ text: '\n' })
    Array.from(node.childNodes).forEach((child, index) => visit(child, index === 0))
  }
  Array.from(root.childNodes).forEach((child, index) => visit(child, index === 0))
  return normalizeSpans(spans)
}

function textOffset(root: HTMLElement, container: Node, offset: number): number {
  if (container.nodeType !== Node.TEXT_NODE) {
    let total = 0
    const children = Array.from(container.childNodes).slice(0, offset)
    for (const child of children) total += child.textContent?.length ?? 0
    return total + (container === root ? 0 : textOffset(root, container, 0))
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  while (walker.nextNode()) {
    if (walker.currentNode === container) return total + offset
    total += walker.currentNode.textContent?.length ?? 0
  }
  return total
}

function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const start = textOffset(root, range.startContainer, range.startOffset)
  const end = textOffset(root, range.endContainer, range.endOffset)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

function restoreSelection(root: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let position = 0
  let startSet = false
  let last: Node | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode
    const length = node.textContent?.length ?? 0
    if (!startSet && start <= position + length) {
      range.setStart(node, start - position)
      startSet = true
    }
    if (startSet && end <= position + length) {
      range.setEnd(node, end - position)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    position += length
    last = node
  }
  if (last) {
    range.selectNodeContents(root)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }
}

function insertText(root: HTMLElement, text: string): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

type ToolbarButton = { label: string; shortcut?: string; glyph: React.ReactNode; active: (marks: SpanMarks) => boolean; change: (marks: SpanMarks) => MarkChange }

const BUTTONS: ToolbarButton[] = [
  { label: 'Bold', shortcut: '⌘B', glyph: <b>B</b>, active: (m) => Boolean(m.bold), change: (m) => (m.bold ? { clear: ['bold'] } : { set: { bold: true } }) },
  { label: 'Italic', shortcut: '⌘I', glyph: <i>I</i>, active: (m) => Boolean(m.italic), change: (m) => (m.italic ? { clear: ['italic'] } : { set: { italic: true } }) },
  {
    label: 'Underline',
    shortcut: '⌘U',
    glyph: <span className="underline">U</span>,
    active: (m) => m.decoration === 'underline',
    change: (m) => (m.decoration === 'underline' ? { clear: ['decoration'] } : { set: { decoration: 'underline' } }),
  },
  {
    label: 'Strikethrough',
    glyph: <span className="line-through">S</span>,
    active: (m) => m.decoration === 'strike',
    change: (m) => (m.decoration === 'strike' ? { clear: ['decoration'] } : { set: { decoration: 'strike' } }),
  },
]

/** Props for the inline editor. */
type InlineTextEditorProps = {
  node: SceneText
  layer: TextLayer
  owner: LayerOwner
  slideId: string
  locale: string
  sourceLocale: string
  /** Where the floating toolbar is portaled (screen-space overlay). */
  overlay: HTMLElement | null
  toScreen: (point: Point) => Point
  viewport: { width: number; height: number }
  palette: string[]
  caretPoint: Point | null
}

/** The inline editor for one text node. */
export function InlineTextEditor({
  node,
  layer,
  owner,
  slideId,
  locale,
  sourceLocale,
  overlay,
  toScreen,
  viewport,
  palette,
  caretPoint,
}: InlineTextEditorProps): React.JSX.Element {
  const api = useEditorApi()
  const ref = React.useRef<HTMLDivElement>(null)
  const [marks, setMarks] = React.useState<SpanMarks>({})
  const localized = locale !== sourceLocale
  const initialRef = React.useRef(node.content)

  const commit = React.useCallback(
    (content: RichText) => {
      const key = `text:${layer.id}:${locale}`
      if (localized && owner.kind === 'slide') {
        api.getState().dispatch(
          { type: 'text.translate', entries: [{ slideId, layerId: layer.id, locale, content, status: 'draft' }] },
          { key }
        )
      } else {
        api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [layer.id], patch: { content } }, { key })
      }
    },
    [api, layer.id, locale, localized, owner, slideId]
  )

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    buildDom(element, initialRef.current, node)
    element.focus({ preventScroll: true })
    const caret = caretPoint
      ? (document.caretPositionFromPoint?.(caretPoint.x, caretPoint.y) ?? null)
      : null
    if (caret && element.contains(caret.offsetNode)) {
      const range = document.createRange()
      range.setStart(caret.offsetNode, caret.offset)
      range.collapse(true)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    } else {
      const range = document.createRange()
      range.selectNodeContents(element)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
    // The editor owns its DOM from mount; later scene updates must not reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshMarks = React.useCallback(() => {
    const element = ref.current
    if (!element) return
    const offsets = selectionOffsets(element)
    if (!offsets) return
    setMarks(commonMarks(parseDom(element), offsets.start, offsets.end))
  }, [])

  React.useEffect(() => {
    document.addEventListener('selectionchange', refreshMarks)
    return () => document.removeEventListener('selectionchange', refreshMarks)
  }, [refreshMarks])

  const applyChange = (change: MarkChange) => {
    const element = ref.current
    if (!element) return
    const offsets = selectionOffsets(element)
    if (!offsets || offsets.end === offsets.start) return
    const content = applyMarks(parseDom(element), offsets.start, offsets.end, change)
    buildDom(element, content, node)
    restoreSelection(element, offsets.start, offsets.end)
    commit(content)
    refreshMarks()
  }

  const finish = () => api.getState().stopTextEdit()

  const outline = nodeOutline(node).map(toScreen)
  const placement = placeToolbar(outline, { width: 420, height: 40 }, viewport)

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Text formatting"
      data-store-text-toolbar=""
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
      }}
      className="pointer-events-auto absolute z-40 flex h-10 items-center gap-0.5 rounded-lg border border-foreground/15 bg-background/95 px-1 text-foreground shadow-lg backdrop-blur"
      style={{ left: placement.x, top: placement.y }}
    >
      {BUTTONS.map((button) => (
        <button
          key={button.label}
          type="button"
          aria-label={button.label}
          aria-pressed={button.active(marks)}
          title={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
          onClick={() => applyChange(button.change(marks))}
          className={cn(
            'flex size-8 items-center justify-center rounded-md text-sm hover:bg-foreground/[0.07]',
            button.active(marks) && 'bg-foreground/[0.12]'
          )}
        >
          {button.glyph}
        </button>
      ))}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-foreground/10" />
      <label className="flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-foreground/[0.07]" title="Text color for selection">
        <span className="sr-only">Text color for selection</span>
        <span className="size-4 rounded-full border border-foreground/20" style={{ background: marks.color ?? node.color }} />
        <input type="color" className="sr-only" value={marks.color ?? node.color} onChange={(event) => applyChange({ set: { color: event.target.value.toUpperCase() } })} />
      </label>
      {palette.slice(0, 4).map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color selection ${color}`}
          title={`Color selection ${color}`}
          onClick={() => applyChange({ set: { color } })}
          className="flex size-6 items-center justify-center rounded-md hover:bg-foreground/[0.07]"
        >
          <span className="size-3.5 rounded-full border border-foreground/20" style={{ background: color }} />
        </button>
      ))}
      <button
        type="button"
        aria-label="Highlight pill"
        aria-pressed={Boolean(marks.highlight)}
        title="Highlight pill"
        onClick={() => applyChange(marks.highlight ? { clear: ['highlight'] } : { set: { highlight: palette[2] ?? '#FDE68A' } })}
        className={cn('flex h-8 items-center justify-center rounded-md px-2 text-[11px] font-medium hover:bg-foreground/[0.07]', marks.highlight && 'bg-foreground/[0.12]')}
      >
        Pill
      </button>
      <button
        type="button"
        aria-label="Gradient text"
        aria-pressed={Boolean(marks.gradient)}
        title="Gradient text"
        onClick={() =>
          applyChange(marks.gradient ? { clear: ['gradient'] } : { set: { gradient: { from: palette[2] ?? '#6D28D9', to: palette[3] ?? '#F43F5E' } } })
        }
        className={cn('flex h-8 items-center justify-center rounded-md px-2 text-[11px] font-semibold hover:bg-foreground/[0.07]', marks.gradient && 'bg-foreground/[0.12]')}
      >
        <span className="bg-gradient-to-r from-violet-500 to-rose-500 bg-clip-text text-transparent">Grad</span>
      </button>
      <button
        type="button"
        aria-label="Clear formatting"
        title="Clear formatting"
        onClick={() => applyChange({ clear: ['bold', 'italic', 'color', 'highlight', 'gradient', 'decoration'] })}
        className="flex h-8 items-center justify-center rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/[0.07]"
      >
        Clear
      </button>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-foreground/10" />
      <button type="button" onClick={finish} className="h-8 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background">
        Done
      </button>
    </div>
  )

  return (
    <>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={`Edit ${layer.name}${localized ? ` (${locale})` : ''}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-store-inline-editor={layer.id}
        className="outline-none"
        style={{
          ...textNodeStyle(node),
          zIndex: 30,
          cursor: 'text',
          caretColor: node.color,
          boxShadow: '0 0 0 2px var(--canvas-selection, #3B82F6)',
          minWidth: node.fontSizePx,
        }}
        onInput={() => {
          if (ref.current) commit(parseDom(ref.current))
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          const meta = event.metaKey || event.ctrlKey
          if (event.key === 'Escape') {
            event.preventDefault()
            finish()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            insertText(event.currentTarget, '\n')
            commit(parseDom(event.currentTarget))
            return
          }
          if (meta && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
            event.preventDefault()
            const button = BUTTONS[['b', 'i', 'u'].indexOf(event.key.toLowerCase())]
            applyChange(button.change(marks))
          }
        }}
        onPaste={(event) => {
          event.preventDefault()
          insertText(event.currentTarget, event.clipboardData.getData('text/plain'))
          commit(parseDom(event.currentTarget))
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && overlay?.contains(next)) return
          finish()
        }}
      />
      {overlay ? createPortal(toolbar, overlay) : null}
    </>
  )
}
