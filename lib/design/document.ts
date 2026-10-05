import { z } from 'zod'
import { designCatalog, frameTypes, isKnownBackground } from './catalog'

/**
 * DesignDocument v1: one editor composition as portable JSON.
 *
 * A document is a template plus overrides. `template` names one of the
 * editor's own presets or image templates and is applied through the store's
 * `applyVisualPreset`, exactly as clicking it in the editor would; every other
 * section overrides that starting point. Sections left out keep the
 * template's (or the editor's default) value.
 *
 * It covers every capability the editor renders (canvas, background, pattern,
 * grain, main image styling, frames, shadows, 3D, filters, device mockups,
 * text, overlays, annotations, redaction, animation) in units that do not
 * depend on the browser window:
 *
 * - positions and sizes are fractions of the canvas (0-1), except text
 *   positions, which are percentages like the editor's own text layer;
 * - font sizes are fractions of the canvas width.
 *
 * `applyDesignDocument` converts these to the editor's on-screen pixels when
 * a design is loaded, so the same document renders identically in the editor,
 * the headless renderer, and any viewport.
 *
 * Image sources are references, never inline data: `asset:<uuid>` for a
 * workspace asset, or a same-origin path for built-in media.
 */

export const DESIGN_DOCUMENT_VERSION = 1

const sourceRef = z
  .string()
  .regex(
    /^(asset:[0-9a-f-]{36}|\/[\w./-]+)$/i,
    'Use asset:<id> for workspace images or a /path for built-in media.'
  )

const unit = z.number().min(0).max(1)
const percent = z.number().min(0).max(100)
const color = z
  .string()
  .regex(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i, 'Use a #hex or rgb() color.')
const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]])

const fontIds = designCatalog.fonts.map((font) => font.id)
const overlayPaths: ReadonlySet<string> = new Set([
  ...designCatalog.arrowOverlays,
  ...designCatalog.shadowOverlays,
])
const mockupIds = designCatalog.mockups.map((mockup) => mockup.id)

const shadowSchema = z.object({
  blur: z.number().min(0).max(200).default(24),
  color: color.default('#000000'),
  enabled: z.boolean().default(true),
  offsetX: z.number().min(-200).max(200).default(0),
  offsetY: z.number().min(-200).max(200).default(12),
  opacity: z.number().min(0).max(1).default(0.35),
  spread: z.number().min(-100).max(100).default(0),
})

export const designDocumentSchema = z.object({
  version: z.literal(DESIGN_DOCUMENT_VERSION),
  /** An editor template or preset id from the catalog's templates section. */
  template: z.string().max(80).optional(),
  canvas: z
    .object({
      aspectRatio: enumOf(designCatalog.aspectRatios),
      /** Breathing room around the main image, in editor px (capped at 8% of the canvas). */
      padding: z.number().min(0).max(200),
    })
    .partial()
    .optional(),
  background: z
    .object({
      blur: z.number().min(0).max(50).default(0),
      noise: z.number().min(0).max(100).default(0),
      opacity: z.number().min(0).max(1).default(1),
      radius: z.number().min(0).max(100).optional(),
      type: z.enum(['gradient', 'solid', 'image']),
      value: z.string().min(1).max(500),
    })
    .refine((background) => isKnownBackground(background.type, background.value), {
      message: 'Unknown background. Pick a value from the design catalog.',
      path: ['value'],
    })
    .optional(),
  pattern: z
    .object({
      blur: z.number().min(0).max(20).default(0),
      color: color.default('#ffffff'),
      enabled: z.boolean().default(true),
      opacity: z.number().min(0).max(1).default(0.15),
      rotation: z.number().min(-180).max(180).default(0),
      scale: z.number().min(0.1).max(5).default(1),
      spacing: z.number().min(4).max(200).default(24),
      type: enumOf(designCatalog.patterns).default('grid'),
    })
    .optional(),
  mode: z.enum(['screenshot', 'browser', 'device']).optional(),
  image: z.object({
    src: sourceRef.nullable().default(null),
    scale: z.number().min(10).max(200).optional(),
    opacity: z.number().min(0).max(1).optional(),
    radius: z.number().min(0).max(100).optional(),
    offset: z
      .object({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5) })
      .optional(),
    rotation: z.number().min(-180).max(180).optional(),
    shadow: z
      .object({
        custom: shadowSchema.optional(),
        preset: enumOf(designCatalog.shadowPresets).optional(),
      })
      .optional(),
    frame: z
      .object({
        color: color.default('#ffffff'),
        opacity: z.number().min(0).max(1).default(1),
        padding: z.number().min(0).max(100).default(0),
        title: z.string().max(200).optional(),
        type: enumOf(frameTypes),
        width: z.number().min(0).max(40).default(0),
      })
      .optional(),
    browserHeaderSize: z.number().min(50).max(200).optional(),
    perspective: z
      .object({
        perspective: z.number().min(200).max(5000).default(2400),
        rotateX: z.number().min(-60).max(60).default(0),
        rotateY: z.number().min(-60).max(60).default(0),
        rotateZ: z.number().min(-180).max(180).default(0),
        scale: z.number().min(0.3).max(2).default(1),
        translateX: z.number().min(-30).max(30).default(0),
        translateY: z.number().min(-30).max(30).default(0),
      })
      .optional(),
    filters: z
      .object({
        blur: z.number().min(0).max(20),
        brightness: z.number().min(0).max(200),
        contrast: z.number().min(0).max(200),
        grayscale: z.number().min(0).max(100),
        hueRotate: z.number().min(0).max(360),
        invert: z.number().min(0).max(100),
        saturate: z.number().min(0).max(200),
        sepia: z.number().min(0).max(100),
      })
      .partial()
      .optional(),
  }),
  devices: z
    .object({
      layoutId: enumOf(designCatalog.deviceLayouts).optional(),
      mockups: z
        .array(
          z.object({
            definitionId: enumOf(mockupIds),
            opacity: z.number().min(0).max(1).default(1),
            position: z.object({ x: unit, y: unit }),
            rotation: z.number().min(-180).max(180).default(0),
            screen: z
              .object({
                fit: z.enum(['cover', 'contain']).default('cover'),
                /** null reuses the main image. */
                src: sourceRef.nullable().default(null),
              })
              .default({ fit: 'cover', src: null }),
            size: z.number().min(0.05).max(1),
          })
        )
        .max(6)
        .default([]),
    })
    .optional(),
  texts: z
    .array(
      z.object({
        color: color.default('#ffffff'),
        fontFamily: enumOf(fontIds).default('inter'),
        /** Fraction of the canvas width; 0.05 is a large headline. */
        fontSize: z.number().min(0.005).max(0.3),
        fontWeight: z.string().max(10).default('bold'),
        opacity: z.number().min(0).max(1).default(1),
        orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
        position: z.object({ x: percent, y: percent }),
        shadow: shadowSchema
          .pick({ blur: true, color: true, enabled: true, offsetX: true, offsetY: true })
          .optional(),
        text: z.string().min(1).max(300),
      })
    )
    .max(20)
    .default([]),
  overlays: z
    .array(
      z.object({
        flipX: z.boolean().default(false),
        flipY: z.boolean().default(false),
        layer: z.enum(['front', 'back']).default('front'),
        opacity: z.number().min(0).max(1).default(1),
        /** Centre of the overlay. */
        position: z.object({ x: unit, y: unit }),
        rotation: z.number().min(-180).max(180).default(0),
        /** Fraction of the canvas width. */
        size: z.number().min(0.01).max(2),
        src: z
          .string()
          .refine(
            (src) => overlayPaths.has(src) || src.startsWith('asset:'),
            'Use an overlay path from the design catalog or asset:<id>.'
          ),
      })
    )
    .max(20)
    .default([]),
  annotations: z
    .array(
      z.object({
        end: z.object({ x: unit, y: unit }),
        fillColor: z.string().max(40).default('transparent'),
        opacity: z.number().min(0).max(1).default(1),
        start: z.object({ x: unit, y: unit }),
        strokeColor: color.default('#ef4444'),
        strokeWidth: z.number().min(1).max(40).default(4),
        type: z.enum(['arrow', 'curved-arrow', 'rectangle', 'circle', 'line']),
      })
    )
    .max(30)
    .default([]),
  redactions: z
    .array(
      z.object({
        amount: z.number().min(1).max(60).default(16),
        position: z.object({ x: unit, y: unit }),
        size: z.object({ height: unit, width: unit }),
        style: z.enum(['blur', 'mosaic']).default('blur'),
      })
    )
    .max(20)
    .default([]),
  animation: z.object({ presetId: enumOf(designCatalog.animationPresets) }).optional(),
})

export type DesignDocument = z.output<typeof designDocumentSchema>
export type DesignDocumentInput = z.input<typeof designDocumentSchema>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge a patch into a document. Objects merge key by key; arrays and
 * scalars replace. `null` clears an optional section. The result is
 * re-validated, so a patch can never produce a document the editor can't load.
 */
export function patchDesignDocument(document: DesignDocument, patch: unknown): DesignDocument {
  const merge = (base: unknown, change: unknown): unknown => {
    if (change === undefined) return base
    if (isPlainObject(base) && isPlainObject(change)) {
      const result: Record<string, unknown> = { ...base }
      for (const [key, value] of Object.entries(change)) {
        result[key] = value === null && !(key === 'src') ? undefined : merge(base[key], value)
      }
      return result
    }
    return change
  }
  return designDocumentSchema.parse(merge(document, patch))
}

/** Every `asset:<id>` the document references, for ownership checks and resolution. */
export function getDesignAssetIds(document: DesignDocument): string[] {
  const refs = [
    document.image.src,
    document.background?.type === 'image' ? document.background.value : null,
    ...(document.devices?.mockups ?? []).map((mockup) => mockup.screen.src),
    ...document.overlays.map((overlay) => overlay.src),
  ]
  return [
    ...new Set(
      refs
        .filter((ref): ref is string => typeof ref === 'string' && ref.startsWith('asset:'))
        .map((ref) => ref.slice('asset:'.length))
    ),
  ]
}

const shape = designDocumentSchema.shape

/**
 * A section schema with its top-level default removed. Defaults belong to new
 * documents; in a change set an omitted field must stay omitted, or a change
 * to the background would reset the headline and the screenshot.
 */
function changeable<T extends z.ZodType>(schema: T) {
  return (schema instanceof z.ZodDefault ? schema.removeDefault() : schema) as z.ZodType<
    z.output<T>
  >
}

const imageChanges = z.object(
  Object.fromEntries(
    Object.entries(shape.image.shape).map(([key, field]) => [key, changeable(field).optional()])
  ) as {
    [K in keyof typeof shape.image.shape]: z.ZodOptional<
      z.ZodType<z.output<(typeof shape.image.shape)[K]>>
    >
  }
)

/** Any section of a DesignDocument; omitted sections are left as they are. */
export const designChangesSchema = z
  .object({
    animation: shape.animation,
    annotations: changeable(shape.annotations).optional(),
    background: shape.background,
    canvas: shape.canvas,
    devices: shape.devices,
    image: imageChanges.optional(),
    mode: shape.mode,
    overlays: changeable(shape.overlays).optional(),
    pattern: shape.pattern,
    redactions: changeable(shape.redactions).optional(),
    template: shape.template,
    texts: changeable(shape.texts).optional(),
  })
  .describe(
    'Sections to change. Objects merge field by field; arrays (texts, overlays, annotations, ' +
      'redactions, devices.mockups) replace the whole list, so resend items you want to keep.'
  )

/** Drop keys a validator filled with undefined so they cannot clear the base document. */
export function definedChanges(changes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        value && typeof value === 'object' && !Array.isArray(value)
          ? definedChanges(value as Record<string, unknown>)
          : value,
      ])
  )
}
