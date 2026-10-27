import { z } from 'zod'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { documentCanvasSize } from '@/lib/export/adapt'
import { deliverySchema } from '@/lib/creative-sets/document'
import { canvasComponentSchema, componentInstanceSchema } from './components'
import { layerGroupSchema } from './layers'
import { canvasStoreGroupSchema } from './store-groups'

/**
 * A canvas workspace (RFC 032): finite artboards placed on an unbounded plane.
 *
 * Workspace coordinates and design coordinates never mix. An artboard's `x`
 * and `y` place its top-left corner on the plane, in workspace units where one
 * unit is one exported pixel. Everything inside the artboard is its native
 * `DesignDocument`, in the editor's normalized units, and renders through the
 * editor's one renderer. Moving an artboard never changes what it exports.
 */

const id = z.string().min(1).max(80)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
/** A workspace coordinate. The plane feels unbounded; storage stays finite. */
export const workspaceCoordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000)

/** Where an artboard was copied from. Copies never write back to their source. */
export const artboardOriginSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('project'),
    id,
    revision: z.number().int().nonnegative(),
    copiedAt: z.string().datetime(),
    documentHash: hash,
  }),
  z.object({
    kind: z.literal('story-set'),
    id,
    outputId: id,
    revision: z.number().int().positive(),
    copiedAt: z.string().datetime(),
    documentHash: hash,
  }),
  z.object({
    kind: z.literal('design'),
    id,
    campaignId: id.nullable(),
    copiedAt: z.string().datetime(),
    documentHash: hash,
  }),
  z.object({ kind: z.literal('recipe'), id, version: z.number().int().positive() }),
])
/** One of {@link artboardOriginSchema}. */
export type ArtboardOrigin = z.infer<typeof artboardOriginSchema>

/** The product records a workspace or artboard explains. Every field is optional. */
export const productContextSchema = z.object({
  releaseId: id.optional(),
  campaignId: id.optional(),
  productSurfaceId: id.optional(),
  feature: z.string().trim().max(200).optional(),
  audience: z.string().trim().max(300).optional(),
  objective: z.string().trim().max(300).optional(),
})
/** One of {@link productContextSchema}. */
export type ProductContext = z.infer<typeof productContextSchema>

/** A product record a generated layer quotes. */
export const evidenceReferenceSchema = z.object({
  kind: z.enum(['release', 'release-feature', 'product-profile', 'product-surface']),
  id,
  label: z.string().max(300),
  url: z.string().url().max(2000).optional(),
})
/** One of {@link evidenceReferenceSchema}. */
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>

/**
 * How trustworthy a generated layer's words are. `verified` quotes a product
 * record; `suggested` is marketing language nobody has confirmed; `confirmed`
 * is suggested language a person accepted.
 */
export const claimStatusSchema = z.enum(['verified', 'suggested', 'confirmed'])
/** One of {@link claimStatusSchema}. */
export type ClaimStatus = z.infer<typeof claimStatusSchema>

/** What generated one text layer, and the text it generated, so edits stay visible. */
export const layerProvenanceSchema = z.object({
  layerId: id,
  status: claimStatusSchema,
  generated: z.string().max(300),
  reference: evidenceReferenceSchema.optional(),
})
/** One of {@link layerProvenanceSchema}. */
export type LayerProvenance = z.infer<typeof layerProvenanceSchema>

/** One finite composition on the plane: a native document at a workspace position. */
export const artboardSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  x: workspaceCoordinateSchema,
  y: workspaceCoordinateSchema,
  document: designDocumentSchema,
  origin: artboardOriginSchema.optional(),
  context: productContextSchema.optional(),
  provenance: z.array(layerProvenanceSchema).max(100).default([]),
  /** Layers that select and move together. */
  groups: z.array(layerGroupSchema).max(40).default([]),
  /** Component instances drawn in this artboard. */
  instances: z.array(componentInstanceSchema).max(40).default([]),
})
/** One of {@link artboardSchema}. */
export type Artboard = z.infer<typeof artboardSchema>
/** An artboard before defaults are applied. */
export type ArtboardInput = z.input<typeof artboardSchema>

/** Version 1 of the canvas document. */
export const canvasDocumentSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('canvas'),
    artboards: z.array(artboardSchema).max(200),
    context: productContextSchema.default({}),
    deliveries: z.array(deliverySchema).max(1000).default([]),
    /** Reusable components; their instances live in artboards. */
    components: z.array(canvasComponentSchema).max(100).default([]),
    /** App Store and Google Play screenshot groups, drawn by the store renderer. */
    storeGroups: z.array(canvasStoreGroupSchema).max(20).default([]),
  })
  .superRefine((canvas, context) => {
    if (new Set(canvas.artboards.map((artboard) => artboard.id)).size !== canvas.artboards.length)
      context.addIssue({ code: 'custom', message: 'Artboards need unique IDs.' })
    if (new Set(canvas.components.map((item) => item.id)).size !== canvas.components.length)
      context.addIssue({ code: 'custom', message: 'Components need unique IDs.' })
    if (new Set(canvas.storeGroups.map((item) => item.group.id)).size !== canvas.storeGroups.length)
      context.addIssue({ code: 'custom', message: 'Store groups need unique IDs.' })
  })
/** A stored canvas workspace. */
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>

/** A rectangle in workspace units. */
export const workspaceRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
/** One of {@link workspaceRectSchema}. */
export type WorkspaceRect = z.infer<typeof workspaceRectSchema>

/** The artboard's export size, which is also its size on the plane. */
export function artboardSize(artboard: Pick<Artboard, 'document'>) {
  return documentCanvasSize(artboard.document)
}

/** Where the artboard sits on the plane. */
export function artboardRect(artboard: Pick<Artboard, 'x' | 'y' | 'document'>): WorkspaceRect {
  const size = artboardSize(artboard)
  return { x: artboard.x, y: artboard.y, width: size.width, height: size.height }
}

/** The smallest rectangle around every given rectangle, or null for none. */
export function boundsOf(rects: readonly WorkspaceRect[]): WorkspaceRect | null {
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** An empty canvas, the starting point every new workspace shares. */
export function emptyCanvasDocument(): CanvasDocument {
  return canvasDocumentSchema.parse({ version: 1, kind: 'canvas', artboards: [] })
}

/** A document at an explicit pixel size with a plain background and nothing else. */
export function sizedDesignDocument(
  size: { width: number; height: number },
  background = '#ffffff'
): DesignDocument {
  return designDocumentSchema.parse({
    version: 2,
    canvas: {
      aspectRatio: 'custom',
      padding: 0,
      size: { width: Math.round(size.width), height: Math.round(size.height) },
    },
    background: { type: 'solid', value: background, radius: 0 },
    image: {},
  })
}

/** Parse a stored canvas, reporting a document a newer app wrote as unreadable rather than guessing. */
export function readCanvasDocument(raw: unknown): CanvasDocument | null {
  const parsed = canvasDocumentSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
