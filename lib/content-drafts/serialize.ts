import { z } from 'zod'
import { CHANNEL_RULES } from '@/lib/launch/guards'

/**
 * Plate JSON to a social caption (RFC 037). Social channels take plain text,
 * so this flattens every node the editor can produce, and reports each thing
 * it had to degrade so the composer can warn before scheduling. Pure: the
 * composer previews with it and the schedule route serializes with it, so the
 * preview is what gets posted.
 */

/** Channels a draft can be scheduled to. */
export const draftChannelSchema = z.enum(['x', 'linkedin', 'instagram'])

/** One of {@link draftChannelSchema}. */
export type DraftChannel = z.infer<typeof draftChannelSchema>

/** What serializing had to change. */
export const degradationKindSchema = z.enum([
  'formatting',
  'table',
  'math',
  'footnotes',
  'embed',
  'extra-images',
  'unsupported',
])

/** One of {@link degradationKindSchema}. */
export type DegradationKind = z.infer<typeof degradationKindSchema>

/** A change the composer warns about before scheduling. */
export type Degradation = { kind: DegradationKind; message: string }

/** A caption for one channel, with its limit and what it lost. */
export type SerializedCaption = {
  /** The draft's workspace images; the channel takes the first {@link CHANNEL_IMAGE_LIMITS}. */
  assetIds: string[]
  caption: string
  channel: DraftChannel
  degradations: Degradation[]
  /** Blocking problems: the post cannot be scheduled as is. */
  errors: string[]
  /** UTF-16 length, as the channel and the backend count it. */
  length: number
  limit: number
}

type PlateNode = {
  [key: string]: unknown
  children?: PlateNode[]
  text?: string
  type?: string
}

/**
 * How many images one post takes on each channel. The backend attaches the
 * draft's first images up to this many (`draftChannelImageLimits` in
 * services/internal/product/content_draft_schedule.go).
 */
export const CHANNEL_IMAGE_LIMITS: Record<DraftChannel, number> = {
  instagram: 10,
  linkedin: 9,
  x: 4,
}

const CONNECTION_CHANNELS: Record<string, DraftChannel> = {
  instagram: 'instagram',
  'instagram-standalone': 'instagram',
  linkedin: 'linkedin',
  x: 'x',
}

/** The draft channel a connection platform publishes to, or null. */
export function channelForPlatform(platform: string): DraftChannel | null {
  return CONNECTION_CHANNELS[platform] ?? null
}

/** Text marks the editor applies; plain-text channels drop them all. */
const MARKS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'code',
  'highlight',
  'kbd',
  'subscript',
  'superscript',
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
]

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const DROPPED_BLOCKS: Partial<Record<string, DegradationKind>> = {
  audio: 'embed',
  file: 'embed',
  media_embed: 'embed',
  toc: 'unsupported',
  video: 'embed',
}
const SIMPLE_BLOCKS = new Set(['p', 'blockquote', 'callout', 'toggle', 'lic', 'li', 'caption'])
const CONTAINERS = new Set(['column_group', 'column', 'ul', 'ol'])

type Context = {
  assetIds: string[]
  degraded: Map<DegradationKind, string>
  footnotes: Map<string, number>
  images: number
}

function degrade(context: Context, kind: DegradationKind, message: string): void {
  if (!context.degraded.has(kind)) context.degraded.set(kind, message)
}

function footnoteNumber(context: Context, identifier: string): number {
  const known = context.footnotes.get(identifier)
  if (known) return known
  const next = context.footnotes.size + 1
  context.footnotes.set(identifier, next)
  return next
}

function collectImage(node: PlateNode, context: Context): void {
  context.images += 1
  if (typeof node.assetId === 'string') context.assetIds.push(node.assetId)
}

/** The text of inline content: text leaves, links, mentions, tags, math. */
function inlineText(nodes: PlateNode[] | undefined, context: Context): string {
  return (nodes ?? [])
    .map((node) => {
      if (typeof node.text === 'string') {
        if (MARKS.some((mark) => node[mark])) {
          degrade(context, 'formatting', 'Bold, italic and other formatting are removed.')
        }
        return node.text
      }
      switch (node.type) {
        case 'img':
          // Imported documents can carry an image inside a paragraph.
          collectImage(node, context)
          return ''
        case 'a': {
          const label = inlineText(node.children, context).trim()
          const url = String(node.url ?? '')
          return !label || label === url ? url : `${label} (${url})`
        }
        case 'mention':
          return `@${String(node.value ?? '')}`
        case 'tag':
          return `#${String(node.value ?? '').replace(/^#/, '')}`
        case 'inline_equation':
          degrade(context, 'math', 'Math is posted as its LaTeX source.')
          return String(node.texExpression ?? '')
        case 'footnoteReference':
          degrade(context, 'footnotes', 'Footnotes become numbered notes at the end.')
          return `[${footnoteNumber(context, String(node.identifier ?? ''))}]`
        case 'date':
          return String(node.date ?? '')
        default:
          return inlineText(node.children, context)
      }
    })
    .join('')
}

/** A table as rows of cells padded to each column's width. */
function tableText(table: PlateNode, context: Context): string {
  degrade(context, 'table', 'Tables are posted as aligned text rows.')
  const rows = (table.children ?? []).map((row) =>
    (row.children ?? []).map((cell) =>
      (cell.children ?? [])
        .map((block) => blockText(block, context))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  )
  // An empty row (the editor starts tables with spare rows) posts nothing.
  const filled = rows.filter((row) => row.some((cell) => cell))
  const widths: number[] = []
  for (const row of filled) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length)
    })
  }
  return filled
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index])))
        .join(' | ')
    )
    .join('\n')
}

/** The marker of an indent-list item, or null for a non-list block. */
function listMarker(node: PlateNode, counters: Map<number, number>): string | null {
  const style = node.listStyleType
  if (typeof style !== 'string') return null
  const level = Math.max(1, Number(node.indent ?? 1))
  const indent = '  '.repeat(level - 1)
  for (const deeper of [...counters.keys()]) if (deeper > level) counters.delete(deeper)
  if (style === 'decimal') {
    const start = Number(node.listStart ?? 0)
    const next = start > 0 && !counters.has(level) ? start : (counters.get(level) ?? 0) + 1
    counters.set(level, next)
    return `${indent}${next}. `
  }
  counters.delete(level)
  if (style === 'todo') return `${indent}${node.checked ? '[x]' : '[ ]'} `
  return `${indent}- `
}

function blockText(node: PlateNode, context: Context): string {
  const type = node.type ?? 'p'
  if (type === 'img') {
    collectImage(node, context)
    return ''
  }
  const dropped = DROPPED_BLOCKS[type]
  if (dropped) {
    degrade(
      context,
      dropped,
      dropped === 'embed'
        ? 'Embedded video, audio and files are left out.'
        : 'The table of contents is left out.'
    )
    return ''
  }
  if (type === 'table') return tableText(node, context)
  if (type === 'equation') {
    degrade(context, 'math', 'Math is posted as its LaTeX source.')
    return String(node.texExpression ?? '')
  }
  if (type === 'hr') return '———'
  if (type === 'code_block') {
    degrade(context, 'formatting', 'Bold, italic and other formatting are removed.')
    return (node.children ?? []).map((line) => inlineText(line.children, context)).join('\n')
  }
  if (CONTAINERS.has(type)) return serializeBlocks(node.children ?? [], context)
  if (!HEADINGS.has(type) && !SIMPLE_BLOCKS.has(type)) {
    degrade(context, 'unsupported', 'Some blocks are posted as their plain text.')
  }
  return inlineText(node.children, context)
}

/** Blocks joined with blank lines; consecutive list items stay together. */
function serializeBlocks(nodes: PlateNode[], context: Context): string {
  const counters = new Map<number, number>()
  const parts: { list: boolean; text: string }[] = []
  for (const node of nodes) {
    if (node.type === 'footnoteDefinition') continue
    const marker = listMarker(node, counters)
    if (marker === null) counters.clear()
    const text = blockText(node, context)
    if (!text.trim() && marker === null) continue
    parts.push({ list: marker !== null, text: marker === null ? text : marker + text })
  }
  return parts
    .map((part, index) => {
      if (index === 0) return part.text
      return (part.list && parts[index - 1].list ? '\n' : '\n\n') + part.text
    })
    .join('')
}

/** Footnote definitions in reference order, numbered like their markers. */
function footnotesText(nodes: PlateNode[], context: Context): string {
  const definitions = new Map<string, string>()
  const visit = (list: PlateNode[]) => {
    for (const node of list) {
      if (node.type === 'footnoteDefinition') {
        definitions.set(
          String(node.identifier ?? ''),
          inlineText(
            (node.children ?? []).flatMap((child) => child.children ?? [child]),
            context
          ).trim()
        )
      } else if (node.children) visit(node.children)
    }
  }
  visit(nodes)
  return [...context.footnotes.entries()]
    .map(([identifier, number]) => `[${number}] ${definitions.get(identifier) ?? ''}`.trim())
    .join('\n')
}

/** UTF-16 length, matching JavaScript's String.length and the Go backend. */
export function captionLength(caption: string): number {
  return caption.length
}

/**
 * Serialize a draft for one channel. The caption is trimmed, footnotes follow
 * the body, and the images are attached up to the channel's limit.
 */
export function serializeDraft(value: unknown, channel: DraftChannel): SerializedCaption {
  const nodes = (Array.isArray(value) ? value : []) as PlateNode[]
  const context: Context = { assetIds: [], degraded: new Map(), footnotes: new Map(), images: 0 }
  const body = serializeBlocks(nodes, context)
  const notes = footnotesText(nodes, context)
  const caption = [body, notes]
    .filter((part) => part.trim())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const limit = CHANNEL_RULES[channel].bodyMax
  const errors: string[] = []
  if (!caption) errors.push('Write something to post.')
  const length = captionLength(caption)
  if (length > limit) errors.push(`${length} of ${limit} characters: shorten it for ${channel}.`)
  if (channel === 'instagram' && context.assetIds.length === 0) {
    errors.push('Instagram needs an image.')
  }
  const imageLimit = CHANNEL_IMAGE_LIMITS[channel]
  if (context.images > imageLimit) {
    degrade(context, 'extra-images', `Only the first ${imageLimit} images are attached.`)
  }
  if (context.images > context.assetIds.length) {
    errors.push('Upload every image to the workspace before scheduling.')
  }
  return {
    assetIds: context.assetIds,
    caption,
    channel,
    degradations: [...context.degraded].map(([kind, message]) => ({ kind, message })),
    errors,
    length,
    limit,
  }
}

/** The draft's plain text, for search and the list preview. */
export function draftPlainText(value: unknown): string {
  return serializeDraft(value, 'linkedin').caption
}
