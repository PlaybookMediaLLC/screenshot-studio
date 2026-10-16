import { z } from 'zod'

/**
 * Composition elements: the editable objects that sit on the canvas beside
 * the screenshot (numbered step badges, cursors, spotlights, zoom
 * callouts). Every element is a box in canvas fractions, so it means the
 * same thing at any canvas size, in the editor, in previews, and in every
 * export size.
 *
 * Adding a type: a schema here, an entry in ELEMENT_TYPES, and a renderer
 * and inspector in components/canvas/elements.
 */

const unit = z.number().min(0).max(1)
const color = z
  .string()
  .regex(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i, 'Use a #hex or rgb() color.')

/** Fields every element has. Geometry is in fractions of the canvas. */
const elementBase = {
  id: z.string().min(1).max(80),
  /** Box centre, as fractions of the canvas width and height. */
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  /** Box size, as fractions of the canvas width and height. */
  width: z.number().min(0.005).max(2),
  height: z.number().min(0.005).max(2),
  /** Degrees, clockwise. */
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  /** Locked elements cannot be moved on the canvas. */
  locked: z.boolean().default(false),
  name: z.string().max(80).optional(),
}

const dropShadow = z.object({
  blur: z.number().min(0).max(80),
  color,
  enabled: z.boolean(),
  offsetX: z.number().min(-80).max(80),
  offsetY: z.number().min(-80).max(80),
})

/** How a step badge writes its number. */
export const badgeNumberingSchema = z.enum(['numeric', 'alpha', 'roman'])
/** A step badge's shape. */
export const badgeShapeSchema = z.enum(['circle', 'square', 'pill'])

const badgeSchema = z.object({
  ...elementBase,
  type: z.literal('badge'),
  props: z.object({
    background: color,
    borderColor: color,
    borderWidth: z.number().min(0).max(12),
    color,
    /** Fraction of the badge height used for the label. */
    fontScale: z.number().min(0.2).max(0.9),
    /** The step number; written per `numbering`. */
    number: z.number().int().min(1).max(999),
    numbering: badgeNumberingSchema,
    shadow: dropShadow,
    shape: badgeShapeSchema,
  }),
})

/** The pointer a cursor shows. */
export const cursorKindSchema = z.enum(['arrow', 'pointer', 'text', 'grab', 'crosshair'])

const cursorSchema = z.object({
  ...elementBase,
  type: z.literal('cursor'),
  props: z.object({
    /** Ring drawn around the hotspot, as if just clicked. */
    click: z.object({ color, enabled: z.boolean(), size: z.number().min(0.5).max(4) }),
    fill: color,
    kind: cursorKindSchema,
    shadow: dropShadow,
    stroke: color,
  }),
})

/** A spotlight's region shape. */
export const spotlightShapeSchema = z.enum(['rectangle', 'ellipse'])

const spotlightSchema = z.object({
  ...elementBase,
  type: z.literal('spotlight'),
  props: z.object({
    /** Colour laid over everything outside the region. */
    color,
    /** 0-1: how dark the surroundings get. */
    dim: z.number().min(0).max(1),
    /** Soft edge, as a fraction of the region's shorter side. */
    feather: z.number().min(0).max(1),
    /** Corner radius for rectangles, as a fraction of the shorter side. */
    radius: z.number().min(0).max(0.5),
    shape: spotlightShapeSchema,
  }),
})

/** A zoom callout's frame shape. */
export const calloutShapeSchema = z.enum(['rectangle', 'rounded', 'circle'])

const calloutSchema = z.object({
  ...elementBase,
  type: z.literal('callout'),
  props: z.object({
    borderColor: color,
    borderWidth: z.number().min(0).max(24),
    /** Line from the callout to its source region. */
    connector: z.boolean(),
    shadow: dropShadow,
    shape: calloutShapeSchema,
    /**
     * Centre of the magnified region, as fractions of the screenshot itself,
     * so the callout follows the screenshot when it moves, scales, or is
     * replaced. The region is the callout's size divided by `zoom`.
     */
    source: z.object({ x: unit, y: unit }),
    /** Outline drawn around the source region on the screenshot. */
    showSource: z.boolean(),
    /** Magnification relative to the screenshot as drawn. */
    zoom: z.number().min(1).max(10),
  }),
})

/** Any composition element. */
export const canvasElementSchema = z.discriminatedUnion('type', [
  badgeSchema,
  cursorSchema,
  spotlightSchema,
  calloutSchema,
])

/** A composition element, as stored in the editor and in documents. */
export type CanvasElement = z.infer<typeof canvasElementSchema>
/** The element types. */
export const elementTypeSchema = z.enum(['badge', 'cursor', 'spotlight', 'callout'])
/** An element type. */
export type ElementType = z.infer<typeof elementTypeSchema>
/** One element type's own properties. */
export type ElementProps<Type extends ElementType> = Extract<CanvasElement, { type: Type }>['props']
/** An element of one type. */
export type ElementOf<Type extends ElementType> = Extract<CanvasElement, { type: Type }>

const SOFT_SHADOW = { blur: 12, color: 'rgba(0,0,0,0.35)', enabled: true, offsetX: 0, offsetY: 4 }

/**
 * A new element of a type, centred where asked. Badges and cursors keep a
 * square box on a canvas of `aspect` (width / height).
 */
export function createElement(
  type: ElementType,
  options: { aspect: number; id: string; x?: number; y?: number; number?: number }
): CanvasElement {
  const { aspect, id } = options
  const x = options.x ?? 0.5
  const y = options.y ?? 0.5
  const square = (size: number) => ({ height: size, width: size / aspect })
  switch (type) {
    case 'badge':
      return canvasElementSchema.parse({
        ...square(0.07),
        id,
        props: {
          background: '#ef4444',
          borderColor: '#ffffff',
          borderWidth: 3,
          color: '#ffffff',
          fontScale: 0.55,
          number: options.number ?? 1,
          numbering: 'numeric',
          shadow: SOFT_SHADOW,
          shape: 'circle',
        },
        type,
        x,
        y,
      })
    case 'cursor':
      return canvasElementSchema.parse({
        ...square(0.06),
        id,
        props: {
          click: { color: 'rgba(59,130,246,0.55)', enabled: false, size: 1.6 },
          fill: '#111111',
          kind: 'arrow',
          shadow: { ...SOFT_SHADOW, blur: 6, offsetY: 2 },
          stroke: '#ffffff',
        },
        type,
        x,
        y,
      })
    case 'spotlight':
      return canvasElementSchema.parse({
        height: 0.3,
        id,
        props: { color: '#000000', dim: 0.6, feather: 0.15, radius: 0.12, shape: 'rectangle' },
        type,
        width: 0.3,
        x,
        y,
      })
    case 'callout':
      return canvasElementSchema.parse({
        ...square(0.3),
        id,
        props: {
          borderColor: '#ffffff',
          borderWidth: 4,
          connector: true,
          shadow: SOFT_SHADOW,
          shape: 'rounded',
          source: { x: 0.5, y: 0.35 },
          showSource: true,
          zoom: 2.5,
        },
        type,
        x: Math.min(0.85, x + 0.2),
        y: Math.max(0.15, y - 0.15),
      })
  }
}

/** A step number written in a badge's numbering style. */
export function formatBadgeNumber(value: number, numbering: z.infer<typeof badgeNumberingSchema>): string {
  if (numbering === 'alpha') {
    let label = ''
    let rest = value
    while (rest > 0) {
      rest -= 1
      label = String.fromCharCode(65 + (rest % 26)) + label
      rest = Math.floor(rest / 26)
    }
    return label
  }
  if (numbering === 'roman') {
    const numerals: [number, string][] = [
      [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ]
    let label = ''
    let rest = value
    for (const [amount, numeral] of numerals) {
      while (rest >= amount) {
        label += numeral
        rest -= amount
      }
    }
    return label
  }
  return String(value)
}

/** The next free step number, so a new badge continues the sequence. */
export function nextBadgeNumber(elements: readonly CanvasElement[]): number {
  return elements.reduce((max, element) => (element.type === 'badge' ? Math.max(max, element.props.number) : max), 0) + 1
}
