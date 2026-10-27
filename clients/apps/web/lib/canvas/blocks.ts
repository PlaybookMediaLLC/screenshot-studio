import { z } from 'zod'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { createElement } from '@/lib/editor/elements/schema'
import { documentCanvasSize } from '@/lib/export/adapt'

/**
 * Building blocks inserted into one artboard. Each returns the native layer
 * sections it changes, whole, ready for `applyDesignChanges`, so the block
 * becomes ordinary text, shape and element layers the editor already edits.
 * Screen blocks (browser, terminal, code, device) go through the editor's
 * own frame commands instead.
 */

/** Text and shape blocks. */
export const layerBlockSchema = z.enum([
  'headline',
  'subheadline',
  'body',
  'caption',
  'label',
  'feature-card',
  'cta',
  'numbered-step',
  'callout',
  'stat',
  'comparison-table',
  'workflow-diagram',
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'line',
  'arrow',
  'divider',
  'highlight',
])
/** One of {@link layerBlockSchema}. */
export type LayerBlock = z.infer<typeof layerBlockSchema>

/** Blocks made of framed screens. */
export const screenBlockSchema = z.enum([
  'browser-window',
  'terminal',
  'code-snippet',
  'api-response',
  'device',
])
/** One of {@link screenBlockSchema}. */
export type ScreenBlock = z.infer<typeof screenBlockSchema>

/** Palette labels, grouped for the Insert panel. */
export const BLOCK_GROUPS: {
  title: string
  blocks: { id: LayerBlock | ScreenBlock; label: string }[]
}[] = [
  {
    title: 'Text',
    blocks: [
      { id: 'headline', label: 'Headline' },
      { id: 'subheadline', label: 'Subheadline' },
      { id: 'body', label: 'Body' },
      { id: 'caption', label: 'Caption' },
      { id: 'label', label: 'Label' },
    ],
  },
  {
    title: 'Product',
    blocks: [
      { id: 'browser-window', label: 'Browser window' },
      { id: 'device', label: 'Device mockup' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'code-snippet', label: 'Code snippet' },
      { id: 'api-response', label: 'API response' },
    ],
  },
  {
    title: 'Explain',
    blocks: [
      { id: 'feature-card', label: 'Feature card' },
      { id: 'numbered-step', label: 'Numbered step' },
      { id: 'callout', label: 'Callout' },
      { id: 'workflow-diagram', label: 'Workflow diagram' },
      { id: 'comparison-table', label: 'Comparison table' },
      { id: 'stat', label: 'Statistic' },
      { id: 'cta', label: 'Call to action' },
    ],
  },
  {
    title: 'Shapes',
    blocks: [
      { id: 'rectangle', label: 'Rectangle' },
      { id: 'rounded-rectangle', label: 'Rounded rectangle' },
      { id: 'ellipse', label: 'Ellipse' },
      { id: 'line', label: 'Line' },
      { id: 'arrow', label: 'Arrow' },
      { id: 'divider', label: 'Divider' },
      { id: 'highlight', label: 'Highlight' },
    ],
  },
]

/** Layer limits of a native document; a block that would exceed one is refused. */
export const LAYER_LIMITS = { texts: 20, annotations: 30, elements: 60, overlays: 40 } as const

/** The sections a block changes, each complete. */
export type BlockChanges = Partial<
  Pick<DesignDocument, 'texts' | 'annotations' | 'elements' | 'overlays'>
>

const textSchema = designDocumentSchema.shape.texts.unwrap().element
const annotationSchema = designDocumentSchema.shape.annotations.unwrap().element
const overlaySchema = designDocumentSchema.shape.overlays.unwrap().element
type Text = z.input<typeof textSchema>
type Annotation = z.input<typeof annotationSchema>
type Overlay = z.input<typeof overlaySchema>

/**
 * A solid colour as a small PNG at an aspect ratio. Filled containers are
 * image layers behind text: the stage draws shapes above text, so a filled
 * shape would hide the words on it. The PNG uploads to workspace assets on
 * save like any image. Injected so blocks and recipes stay testable.
 */
export type FillImage = (color: string, aspect: number) => string

/** {@link FillImage} drawn by the browser. */
export const solidFill: FillImage = (color, aspect) => {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = Math.max(1, Math.round(240 / Math.max(0.05, aspect)))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser could not draw the block.')
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/** A filled, rounded container behind text, centred at (cx, cy), sized in canvas fractions. */
export function container(
  id: string,
  fill: FillImage,
  canvasAspect: number,
  {
    cx,
    cy,
    width,
    height,
    color,
    shadow = true,
  }: { cx: number; cy: number; width: number; height: number; color: string; shadow?: boolean }
): Overlay {
  return {
    id,
    src: fill(color, (width / height) * canvasAspect),
    layer: 'back',
    role: 'user',
    position: { x: Math.min(1, Math.max(0, cx)), y: Math.min(1, Math.max(0, cy)) },
    size: width,
    radius: 14,
    opacity: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    ...(shadow
      ? {
          shadow: {
            enabled: true,
            blur: 28,
            color: '#0f172a',
            opacity: 0.12,
            offsetX: 0,
            offsetY: 10,
            spread: 0,
          },
        }
      : {}),
  }
}
const INK = '#141a17'
const MUTED = '#55625c'
const ACCENT = '#1f6feb'

/** A small offset per insertion, so repeated blocks never sit exactly on top of each other. */
function nudge(document: DesignDocument) {
  return (
    ((document.texts.length + document.annotations.length + document.elements.length) % 5) * 0.03
  )
}

/**
 * The layer sections after adding a block, centred near `at` (canvas
 * fractions; the middle by default). Text that makes a claim (a statistic,
 * a comparison cell) arrives as an obvious placeholder to replace with a
 * sourced value.
 */
export function blockChanges(
  block: LayerBlock,
  document: DesignDocument,
  {
    newId = () => crypto.randomUUID(),
    at,
    fill = solidFill,
  }: { newId?: () => string; at?: { x: number; y: number }; fill?: FillImage } = {}
): BlockChanges {
  const size = documentCanvasSize(document)
  const aspect = size.width / size.height
  const shift = nudge(document)
  const cx = Math.min(0.85, Math.max(0.15, (at?.x ?? 0.5) + shift))
  const cy = Math.min(0.85, Math.max(0.15, (at?.y ?? 0.5) + shift))
  const texts: Text[] = []
  const annotations: Annotation[] = []
  const elements: DesignDocument['elements'] = []
  const overlays: Overlay[] = []
  const card = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    shadow = true
  ) =>
    overlays.push(container(newId(), fill, aspect, { cx: x, cy: y, width, height, color, shadow }))
  const write = (value: string, options: Partial<Text> & Pick<Text, 'fontSize'>, x = cx, y = cy) =>
    texts.push({
      id: newId(),
      text: value,
      color: INK,
      fontFamily: 'inter',
      fontWeight: 'bold',
      align: 'center',
      fit: 'wrap',
      maxWidth: 0.6,
      lineHeight: 1.2,
      position: { x: x * 100, y: y * 100 },
      ...options,
    })
  const box = (
    left: number,
    top: number,
    right: number,
    bottom: number,
    fill: string,
    stroke = fill,
    type: Annotation['type'] = 'rectangle',
    radius?: number
  ) =>
    annotations.push({
      id: newId(),
      type,
      start: { x: left, y: top },
      end: { x: right, y: bottom },
      fillColor: fill,
      strokeColor: stroke,
      strokeWidth: 2,
      opacity: 1,
      ...(radius ? { radius } : {}),
    })
  const stroke = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    type: Annotation['type'],
    color = INK,
    width = 4
  ) =>
    annotations.push({
      id: newId(),
      type,
      start: from,
      end: to,
      strokeColor: color,
      strokeWidth: width,
      fillColor: 'transparent',
      opacity: 1,
    })
  switch (block) {
    case 'headline':
      write('Your headline', { role: 'headline', fontSize: 0.05, maxWidth: 0.8 })
      break
    case 'subheadline':
      write('A supporting line', { role: 'subheadline', fontSize: 0.03, fontWeight: '600' })
      break
    case 'body':
      write('Explain what it does and why it matters.', {
        role: 'body',
        fontSize: 0.02,
        fontWeight: 'normal',
        color: MUTED,
        lineHeight: 1.45,
      })
      break
    case 'caption':
      write('Caption', { role: 'body', fontSize: 0.014, fontWeight: 'normal', color: MUTED })
      break
    case 'label':
      write('NEW', { role: 'label', fontSize: 0.016, color: ACCENT, letterSpacing: 0.1 })
      break
    case 'feature-card': {
      const width = 0.3
      const height = width * aspect * 0.55
      card(cx, cy, width, height, '#ffffff')
      write(
        'Feature name',
        { role: 'subheadline', fontSize: 0.02, maxWidth: width * 0.85 },
        cx,
        cy - height * 0.18
      )
      write(
        'One sentence on the benefit.',
        {
          role: 'body',
          fontSize: 0.013,
          fontWeight: 'normal',
          color: MUTED,
          maxWidth: width * 0.85,
        },
        cx,
        cy + height * 0.15
      )
      break
    }
    case 'cta': {
      const width = 0.22
      const height = width * aspect * 0.22
      card(cx, cy, width, height, INK, false)
      write('Get started', {
        role: 'label',
        fontSize: 0.017,
        color: '#ffffff',
        maxWidth: width * 0.9,
      })
      break
    }
    case 'numbered-step': {
      const step = document.elements.filter((element) => element.type === 'badge').length + 1
      elements.push(
        createElement('badge', { aspect, id: newId(), x: cx - 0.12, y: cy, number: step })
      )
      write(
        `Step ${step}`,
        { role: 'subheadline', fontSize: 0.022, align: 'left', maxWidth: 0.2 },
        cx + 0.03,
        cy
      )
      break
    }
    case 'callout':
      stroke({ x: cx + 0.12, y: cy - 0.1 }, { x: cx, y: cy }, 'curved-arrow', ACCENT)
      write(
        'Point out the detail',
        { role: 'label', fontSize: 0.016, color: ACCENT, maxWidth: 0.22 },
        cx + 0.2,
        cy - 0.13
      )
      break
    case 'stat':
      write('—', { role: 'headline', fontSize: 0.06 }, cx, cy - 0.05)
      write(
        'Add a measured result',
        { role: 'label', fontSize: 0.016, color: MUTED },
        cx,
        cy + 0.04
      )
      write(
        'Source: add where this number comes from',
        { role: 'body', fontSize: 0.011, fontWeight: 'normal', color: MUTED },
        cx,
        cy + 0.09
      )
      break
    case 'comparison-table': {
      const columns = [cx - 0.22, cx, cx + 0.22]
      write('You', { role: 'label', fontSize: 0.015 }, columns[1], cy - 0.15)
      write('Alternative', { role: 'label', fontSize: 0.015, color: MUTED }, columns[2], cy - 0.15)
      for (const [row, offset] of [-0.06, 0.04, 0.14].entries()) {
        stroke(
          { x: cx - 0.33, y: cy + offset - 0.05 },
          { x: cx + 0.33, y: cy + offset - 0.05 },
          'line',
          '#dfe5e2',
          2
        )
        write(
          `Capability ${row + 1}`,
          { role: 'body', fontSize: 0.013, fontWeight: '600', maxWidth: 0.18 },
          columns[0],
          cy + offset
        )
        write(
          'Add a sourced claim',
          { role: 'body', fontSize: 0.012, fontWeight: 'normal', color: MUTED, maxWidth: 0.18 },
          columns[1],
          cy + offset
        )
        write(
          'Add a sourced claim',
          { role: 'body', fontSize: 0.012, fontWeight: 'normal', color: MUTED, maxWidth: 0.18 },
          columns[2],
          cy + offset
        )
      }
      break
    }
    case 'workflow-diagram': {
      const labels = ['Trigger', 'Process', 'Result']
      const width = 0.16
      const height = width * aspect * 0.4
      labels.forEach((label, index) => {
        const x = cx + (index - 1) * 0.24
        card(x, cy, width, height, '#ffffff')
        write(label, { role: 'label', fontSize: 0.015, maxWidth: width * 0.9 }, x, cy)
        if (index < labels.length - 1)
          stroke(
            { x: x + width / 2 + 0.01, y: cy },
            { x: x + 0.24 - width / 2 - 0.01, y: cy },
            'arrow'
          )
      })
      break
    }
    case 'rectangle':
      box(cx - 0.12, cy - 0.1, cx + 0.12, cy + 0.1, 'transparent', ACCENT)
      break
    case 'rounded-rectangle':
      box(cx - 0.12, cy - 0.1, cx + 0.12, cy + 0.1, 'transparent', ACCENT, 'rectangle', 0.2)
      break
    case 'ellipse':
      box(
        cx - 0.08,
        cy - 0.08 * aspect,
        cx + 0.08,
        cy + 0.08 * aspect,
        'transparent',
        ACCENT,
        'circle'
      )
      break
    case 'line':
      stroke({ x: cx - 0.15, y: cy }, { x: cx + 0.15, y: cy }, 'line')
      break
    case 'arrow':
      stroke({ x: cx - 0.15, y: cy }, { x: cx + 0.15, y: cy }, 'arrow', ACCENT)
      break
    case 'divider':
      stroke({ x: 0.08, y: cy }, { x: 0.92, y: cy }, 'line', '#dfe5e2', 2)
      break
    case 'highlight':
      box(
        cx - 0.12,
        cy - 0.04,
        cx + 0.12,
        cy + 0.04,
        'rgba(250,204,21,0.35)',
        'rgba(250,204,21,0.35)'
      )
      break
  }
  const changes: BlockChanges = {}
  if (texts.length) {
    if (document.texts.length + texts.length > LAYER_LIMITS.texts)
      throw new Error(
        `This artboard holds at most ${LAYER_LIMITS.texts} text layers. Remove one or use another artboard.`
      )
    changes.texts = [...document.texts, ...texts.map((layer) => textSchema.parse(layer))]
  }
  if (annotations.length) {
    if (document.annotations.length + annotations.length > LAYER_LIMITS.annotations)
      throw new Error(
        `This artboard holds at most ${LAYER_LIMITS.annotations} shapes. Remove one or use another artboard.`
      )
    changes.annotations = [
      ...document.annotations,
      ...annotations.map((layer) => annotationSchema.parse(layer)),
    ]
  }
  if (elements.length) {
    if (document.elements.length + elements.length > LAYER_LIMITS.elements)
      throw new Error(`This artboard holds at most ${LAYER_LIMITS.elements} elements.`)
    changes.elements = [...document.elements, ...elements]
  }
  if (overlays.length) {
    if (document.overlays.length + overlays.length > LAYER_LIMITS.overlays)
      throw new Error(`This artboard holds at most ${LAYER_LIMITS.overlays} image layers.`)
    changes.overlays = [
      ...document.overlays,
      ...overlays.map((layer) => overlaySchema.parse(layer)),
    ]
  }
  return changes
}

/** Sample code each screen block starts with; replace it in the inspector. */
export const SCREEN_BLOCK_CODE: Record<
  Exclude<ScreenBlock, 'browser-window' | 'device'>,
  { code: string; title: string }
> = {
  terminal: { title: 'zsh', code: '$ npx acme deploy\n✔ Built in 4.2s\n✔ Deployed to production' },
  'code-snippet': {
    title: 'index.ts',
    code: "import { Acme } from '@acme/sdk'\n\nconst acme = new Acme()\nawait acme.ship({ feature: 'canvas' })",
  },
  'api-response': {
    title: 'GET /v1/releases/latest',
    code: '{\n  "id": "rel_42",\n  "status": "published",\n  "features": 3\n}',
  },
}
