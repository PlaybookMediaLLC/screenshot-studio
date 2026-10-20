import { z } from 'zod'
import { designDocumentSchema } from '@/lib/design/document'
import { adaptDocumentToSize } from '@/lib/export/adapt'
import {
  artboardSchema,
  canvasDocumentSchema,
  claimStatusSchema,
  productContextSchema,
  workspaceCoordinateSchema,
  type Artboard,
  type CanvasDocument,
} from './document'

/**
 * Every change to a canvas document is one of these commands, applied by
 * {@link applyCanvasCommand} as one undo step. Commands are deterministic:
 * new IDs and positions arrive in the command, so applying it twice to the
 * same document gives the same result.
 */

const id = z.string().min(1).max(80)
const ids = z.array(id).min(1).max(200)
const position = z.object({ id, x: workspaceCoordinateSchema, y: workspaceCoordinateSchema })
const pixels = z.number().int().min(16).max(8192)

/** Where an artboard goes in the drawing order. Later artboards draw on top. */
export const stackMoveSchema = z.enum(['front', 'back'])
/** One of {@link stackMoveSchema}. */
export type StackMove = z.infer<typeof stackMoveSchema>

/** A typed change to a canvas document. */
export const canvasCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add-artboards'),
    artboards: z.array(artboardSchema).min(1).max(200),
  }),
  z.object({ type: z.literal('move-artboards'), positions: z.array(position).min(1).max(200) }),
  z.object({ type: z.literal('rename-artboard'), id, name: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal('remove-artboards'), ids }),
  z.object({
    type: z.literal('duplicate-artboards'),
    copies: z
      .array(position.extend({ sourceId: id, name: z.string().trim().min(1).max(120) }))
      .min(1)
      .max(200),
  }),
  z.object({ type: z.literal('stack-artboards'), ids, move: stackMoveSchema }),
  z.object({ type: z.literal('resize-artboard'), id, width: pixels, height: pixels }),
  z.object({ type: z.literal('native-edit'), id, document: designDocumentSchema }),
  z.object({
    type: z.literal('update-documents'),
    documents: z
      .array(z.object({ id, document: designDocumentSchema }))
      .min(1)
      .max(200),
  }),
  z.object({ type: z.literal('set-context'), context: productContextSchema }),
  z.object({ type: z.literal('set-artboard-context'), id, context: productContextSchema }),
  z.object({ type: z.literal('set-claim-status'), id, layerId: id, status: claimStatusSchema }),
])
/** One of {@link canvasCommandSchema}. */
export type CanvasCommand = z.infer<typeof canvasCommandSchema>

function artboardOf(canvas: CanvasDocument, artboardId: string): Artboard {
  const artboard = canvas.artboards.find((item) => item.id === artboardId)
  if (!artboard) throw new Error('That artboard is no longer on this canvas.')
  return artboard
}

/** The canvas after a command, validated. The input is never mutated. */
export function applyCanvasCommand(canvas: CanvasDocument, raw: CanvasCommand): CanvasDocument {
  const command = canvasCommandSchema.parse(raw)
  const next = structuredClone(canvas)
  switch (command.type) {
    case 'add-artboards':
      next.artboards.push(...command.artboards)
      break
    case 'move-artboards':
      for (const { id, x, y } of command.positions) {
        const artboard = artboardOf(next, id)
        artboard.x = x
        artboard.y = y
      }
      break
    case 'rename-artboard':
      artboardOf(next, command.id).name = command.name
      break
    case 'remove-artboards': {
      const removed = new Set(command.ids)
      next.artboards = next.artboards.filter((artboard) => !removed.has(artboard.id))
      break
    }
    case 'duplicate-artboards':
      for (const copy of command.copies) {
        const source = artboardOf(canvas, copy.sourceId)
        next.artboards.push({
          ...structuredClone(source),
          id: copy.id,
          name: copy.name,
          x: copy.x,
          y: copy.y,
        })
      }
      break
    case 'stack-artboards': {
      const moving = new Set(command.ids)
      const picked = next.artboards.filter((artboard) => moving.has(artboard.id))
      const rest = next.artboards.filter((artboard) => !moving.has(artboard.id))
      next.artboards = command.move === 'front' ? [...rest, ...picked] : [...picked, ...rest]
      break
    }
    case 'resize-artboard': {
      const artboard = artboardOf(next, command.id)
      // The composition is laid out again for the new size, never stretched.
      artboard.document = adaptDocumentToSize(artboard.document, {
        width: command.width,
        height: command.height,
      })
      break
    }
    case 'native-edit':
      artboardOf(next, command.id).document = command.document
      break
    case 'update-documents':
      for (const { id, document } of command.documents) artboardOf(next, id).document = document
      break
    case 'set-context':
      next.context = command.context
      break
    case 'set-artboard-context':
      artboardOf(next, command.id).context = command.context
      break
    case 'set-claim-status': {
      const claim = artboardOf(next, command.id).provenance.find(
        (entry) => entry.layerId === command.layerId
      )
      if (!claim) throw new Error('That layer has no generated claim to confirm.')
      claim.status = command.status
      break
    }
  }
  return canvasDocumentSchema.parse(next)
}
