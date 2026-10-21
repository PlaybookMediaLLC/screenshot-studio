import { z } from 'zod'
import { draftChannelSchema, type Numbering } from '@/lib/write/document'
import { numberCaptions } from '@/lib/write/numbering'
import { xLength } from './x-length'

/**
 * Plate JSON to a social caption (RFC 037). Social channels take plain text,
 * so this flattens every node the editor can produce, and reports each thing
 * it had to degrade so the composer can warn before scheduling. Pure: the
 * composer previews with it and the schedule route serializes with it, so the
 * preview is what gets posted.
 */

/** Channels a draft can be scheduled to (defined with the Write document). */
export { draftChannelSchema }

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
  'thread',
  'unsupported',
])

/** One of {@link degradationKindSchema}. */
export type DegradationKind = z.infer<typeof degradationKindSchema>

/** A change the composer warns about before scheduling. */
export type Degradation = { kind: DegradationKind; message: string }

/** One post of a thread: its text and its workspace images in order. */
export type SerializedPost = {
  assetIds: string[]
  caption: string
  /**
   * The post's group in the body: its index among the post breaks' groups,
   * so its settings and identity can be found. Posts joined into one post
   * for a channel without threads take the first group.
   */
  group: number
  /** Images in the post, uploaded or still to render. */
  images: number
  length: number
  /** Uploaded videos among the post's media. */
  videos: number
}

/** Channels that post a thread as replies; the others post it as one post. */
export const THREAD_CHANNELS: ReadonlySet<DraftChannel> = new Set([
  'x',
  'threads',
  'bluesky',
  'mastodon',
])

/**
 * Each channel's caption limit, as the backend checks it
 * (`draftChannelLimits` in services/internal/product/content_draft_schedule.go).
 */
export const DRAFT_CHANNEL_LIMITS: Record<DraftChannel, number> = {
  bluesky: 300,
  instagram: 2_200,
  linkedin: 3_000,
  mastodon: 500,
  threads: 500,
  x: 280,
}

/** The block that starts the next post of a thread. */
export const POST_BREAK = 'post_break'

/**
 * An atomic mention of an account on a platform, picked from a lookup: its
 * label, the platform's id for it, and whether it names a person or an
 * organization. It never splits, and serializes the way its platform reads.
 */
export const SOCIAL_MENTION = 'social_mention'

/**
 * A social mention as its channel writes it: LinkedIn's annotation
 * `@[Name](urn:li:organization:1)` when the mention is LinkedIn's, the
 * handle elsewhere, and the plain label when nothing better is known.
 */
function socialMentionText(node: PlateNode, channel: DraftChannel): string {
  const label = String(node.label ?? '').replace(/[[\]()]/g, '')
  const id = String(node.providerId ?? '')
  const handle = String(node.handle ?? '')
  if (node.platform === 'linkedin' && channel === 'linkedin' && id.startsWith('urn:li:')) {
    return `@[${label}](${id})`
  }
  if (node.platform === channel && handle) return `@${handle.replace(/^@/, '')}`
  return label
}

/** How a caption is limited and numbered for one account. */
export type SerializeOptions = {
  /** The account's caption limit; the channel's standard limit when unset. */
  limit?: number
  /** Thread numbering, added to each post and counted in its length. */
  numbering?: Numbering
}

/** A caption for one channel, with its limit and what it lost. */
export type SerializedCaption = {
  /** The post's workspace images in body order; the channel takes the first {@link CHANNEL_IMAGE_LIMITS}. */
  assetIds: string[]
  caption: string
  channel: DraftChannel
  degradations: Degradation[]
  /** Blocking problems: the post cannot be scheduled as is. */
  errors: string[]
  /** UTF-16 length, as the channel and the backend count it; a thread's longest post. */
  length: number
  limit: number
  /**
   * What the channel posts, in order. A thread channel posts each post of
   * the draft (the first, then replies); any other channel posts one.
   */
  posts: SerializedPost[]
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
  bluesky: 4,
  instagram: 10,
  linkedin: 9,
  mastodon: 4,
  threads: 10,
  x: 4,
}

const CONNECTION_CHANNELS: Record<string, DraftChannel> = {
  bluesky: 'bluesky',
  instagram: 'instagram',
  'instagram-standalone': 'instagram',
  linkedin: 'linkedin',
  'linkedin-page': 'linkedin',
  mastodon: 'mastodon',
  'mastodon-custom': 'mastodon',
  mastodoncustom: 'mastodon',
  threads: 'threads',
  x: 'x',
  twitter: 'x',
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
  /** The channel the caption is for: mentions are written its way. */
  channel: DraftChannel
  /** Table and math blocks posted as rendered images, in body order. */
  blockImages: BlockImages | undefined
  /** How many table and math blocks the caption has passed. */
  blocks: number
  degraded: Map<DegradationKind, string>
  footnotes: Map<string, number>
  images: number
  /** Images not uploaded to the workspace. */
  unstored: number
  /** Uploaded videos, which go out as the post's media. */
  videos: number
}

/**
 * The draft's table and math blocks as images, in body order: each one's
 * rendered asset id, '' when it is rendered at scheduling (the preview), or
 * null when it could not be and posts as text. Positions, not block ids, tie
 * an image to its block: a live session gives the editor's blocks new ids.
 */
export type BlockImages = (string | null)[]

/** Block types the composer renders to an image for posting. */
const RENDERED_BLOCKS = new Set(['table', 'equation'])

/** How many table and math blocks the draft has (the composer renders each). */
export function renderableBlockCount(value: unknown): number {
  const count = (nodes: PlateNode[]): number =>
    nodes.reduce(
      (total, node) =>
        total +
        (RENDERED_BLOCKS.has(node.type ?? '')
          ? 1
          : node.type === 'footnoteDefinition'
            ? 0
            : count(node.children ?? [])),
      0
    )
  return count((Array.isArray(value) ? value : []) as PlateNode[])
}

/** A rendered block counts as an image; its text stays out of the caption. */
function renderedBlock(context: Context): boolean {
  const assetId = context.blockImages?.[context.blocks]
  context.blocks += 1
  if (assetId === undefined || assetId === null) return false
  context.images += 1
  if (assetId) context.assetIds.push(assetId)
  return true
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

/** An uploaded video is the post's media; it counts with the images. */
function collectVideo(node: PlateNode, context: Context): void {
  context.images += 1
  context.videos += 1
  context.assetIds.push(String(node.assetId))
}

function collectImage(node: PlateNode, context: Context): void {
  context.images += 1
  if (typeof node.assetId === 'string') context.assetIds.push(node.assetId)
  else context.unstored += 1
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
        case SOCIAL_MENTION:
          return socialMentionText(node, context.channel)
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
  if (type === 'video' && typeof node.assetId === 'string') {
    collectVideo(node, context)
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
  if (type === 'table' && renderedBlock(context)) {
    degrade(context, 'table', 'Tables are posted as images.')
    return ''
  }
  if (type === 'equation' && renderedBlock(context)) {
    degrade(context, 'math', 'Math blocks are posted as images.')
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

const blueskySegments = new Intl.Segmenter('en', { granularity: 'grapheme' })

function platformCaptionLength(channel: DraftChannel, caption: string): number {
  if (channel === 'x') return xLength(caption)
  if (channel === 'bluesky') return Array.from(blueskySegments.segment(caption)).length
  return captionLength(caption)
}

/**
 * Serialize a draft for one channel. The caption is trimmed, footnotes follow
 * the body, and the images are attached up to the channel's limit. Table and
 * math blocks in `blockImages` are posted as those images instead of text.
 * `text`, when set, is what this channel says instead of the body: plain
 * text, where two empty lines start the next post of a thread. The body's
 * images still go with it, on the first post.
 */
export function serializeDraft(
  value: unknown,
  channel: DraftChannel,
  blockImages?: BlockImages,
  text?: string,
  options: SerializeOptions = {}
): SerializedCaption {
  const nodes = (Array.isArray(value) ? value : []) as PlateNode[]
  const context: Context = {
    assetIds: [],
    channel,
    blockImages,
    blocks: 0,
    degraded: new Map(),
    footnotes: new Map(),
    images: 0,
    unstored: 0,
    videos: 0,
  }
  // Each post of a thread serializes on its own; footnotes close the last.
  const written = splitPosts(nodes).map((group, index) => {
    const [assets, images, videos] = [context.assetIds.length, context.images, context.videos]
    const caption = tidy(serializeBlocks(group, context))
    return {
      assetIds: context.assetIds.slice(assets),
      caption,
      group: index,
      images: context.images - images,
      length: 0,
      videos: context.videos - videos,
    }
  })
  const notes = footnotesText(nodes, context)
  const last = written[written.length - 1]
  if (notes && last) last.caption = tidy(`${last.caption}\n\n${notes}`)
  if (text?.trim()) {
    // The channel's own words replace the body's; only its images carry over.
    context.degraded.clear()
    const images = written.flatMap((post) => post.assetIds)
    const count = written.reduce((total, post) => total + post.images, 0)
    written.splice(
      0,
      written.length,
      ...text
        .split(/\n[ \t]*\n[ \t]*\n/)
        .map(tidy)
        .map((caption, index) => ({
          assetIds: index === 0 ? images : [],
          caption,
          group: index,
          images: index === 0 ? count : 0,
          length: 0,
          videos: index === 0 ? written.reduce((total, post) => total + post.videos, 0) : 0,
        }))
    )
  }
  const filled = written.filter((post) => post.caption || post.images > 0)
  const thread = THREAD_CHANNELS.has(channel)
  if (!thread && filled.length > 1) {
    degrade(context, 'thread', `The thread is posted as one ${CHANNEL_NAMES[channel]} post.`)
  }
  const unnumbered: SerializedPost[] =
    thread || filled.length <= 1
      ? filled
      : [
          {
            assetIds: filled.flatMap((post) => post.assetIds),
            caption: filled.map((post) => post.caption).join('\n\n'),
            group: filled[0].group,
            images: filled.reduce((total, post) => total + post.images, 0),
            length: 0,
            videos: filled.reduce((total, post) => total + post.videos, 0),
          },
        ]
  const numbered = thread
    ? numberCaptions(
        unnumbered.map((post) => post.caption),
        options.numbering
      )
    : unnumbered.map((post) => post.caption)
  const posts: SerializedPost[] = unnumbered.map((post, index) => ({
    ...post,
    caption: numbered[index],
    length: platformCaptionLength(channel, numbered[index]),
  }))

  const limit = options.limit ?? DRAFT_CHANNEL_LIMITS[channel]
  const imageLimit = CHANNEL_IMAGE_LIMITS[channel]
  const errors: string[] = []
  if (posts.length === 0 || posts.every((post) => !post.caption)) {
    errors.push('Write something to post.')
  }
  posts.forEach((post, index) => {
    if (channel === 'bluesky' && new TextEncoder().encode(post.caption).length > 3000) {
      errors.push(`Post ${index + 1} exceeds Bluesky's 3,000-byte text limit.`)
    }
    if (post.length <= limit) return
    errors.push(
      posts.length > 1
        ? `Post ${index + 1} is ${post.length} of ${limit} characters: shorten it for ${channel}.`
        : `${post.length} of ${limit} characters: shorten it for ${channel}.`
    )
  })
  if (channel === 'instagram' && context.images === context.unstored) {
    errors.push('Instagram needs an image.')
  }
  if (posts.some((post) => post.images > imageLimit)) {
    if (channel === 'bluesky' || channel === 'x') {
      errors.push(
        channel === 'x'
          ? 'Choose up to four images, one GIF, or one MP4 video for each X post.'
          : 'Choose up to four images or one MP4 video for each Bluesky post.'
      )
    } else {
      degrade(
        context,
        'extra-images',
        `Only the first ${imageLimit} images ${posts.length > 1 ? 'of each post ' : ''}are attached.`
      )
    }
  }
  if (context.unstored > 0) {
    errors.push('Upload every image to the workspace before scheduling.')
  }
  // Every channel takes a video alone: one, with no images beside it.
  posts.forEach((post, index) => {
    if (post.videos > 0 && post.images > 1) {
      errors.push(
        `${posts.length > 1 ? `Post ${index + 1}: a` : 'A'} video goes alone: one video, no images with it.`
      )
    }
  })
  return {
    assetIds: context.assetIds,
    caption: posts.map((post) => post.caption).join('\n\n'),
    channel,
    degradations: [...context.degraded].map(([kind, message]) => ({ kind, message })),
    errors,
    length: Math.max(0, ...posts.map((post) => post.length)),
    limit,
    posts,
  }
}

const CHANNEL_NAMES: Record<DraftChannel, string> = {
  bluesky: 'Bluesky',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  mastodon: 'Mastodon',
  threads: 'Threads',
  x: 'X',
}

/** Top-level blocks grouped into posts at each post break. */
function splitPosts(nodes: PlateNode[]): PlateNode[][] {
  const posts: PlateNode[][] = [[]]
  for (const node of nodes) {
    if (node.type === POST_BREAK) posts.push([])
    else posts[posts.length - 1].push(node)
  }
  return posts
}

function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** The draft's plain text, for search and the list preview. */
export function draftPlainText(value: unknown): string {
  return serializeDraft(value, 'linkedin').caption
}
