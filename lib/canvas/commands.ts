import { z } from 'zod'
import { designDocumentSchema } from '@/lib/design/document'
import { adaptDocumentToSize } from '@/lib/export/adapt'
import {
  canvasComponentSchema,
  componentInstanceSchema,
  componentFromInstance,
  drawInstance,
  reconcileInstance,
} from './components'
import { layerGroupSchema, pruneGroups } from './layers'
import { canvasStoreGroupSchema, storeTargetIdSchema } from './store-groups'
import { storeDocumentSchema } from '@/lib/store-screenshots/document/schema'
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
  /** A layer edit made outside the editor (move, align, delete, group) with the artboard's groups after it. */
  z.object({
    type: z.literal('set-artboard-layers'),
    id,
    document: designDocumentSchema,
    groups: z.array(layerGroupSchema).max(40),
  }),
  /** A new component, and the layers it was made from turned into its first instance. */
  z.object({
    type: z.literal('add-component'),
    component: canvasComponentSchema,
    artboardId: id,
    instance: componentInstanceSchema,
    document: designDocumentSchema,
  }),
  z.object({
    type: z.literal('insert-instance'),
    artboardId: id,
    instance: componentInstanceSchema,
  }),
  /** Push one instance's layers to its main component and redraw every instance. */
  z.object({ type: z.literal('update-component'), artboardId: id, instanceId: id }),
  z.object({ type: z.literal('reset-instance'), artboardId: id, instanceId: id }),
  z.object({ type: z.literal('detach-instance'), artboardId: id, instanceId: id }),
  z.object({
    type: z.literal('rename-component'),
    componentId: id,
    name: z.string().trim().min(1).max(80),
  }),
  /** Delete a component; its instances stay as plain layers. */
  z.object({ type: z.literal('remove-component'), componentId: id }),
  z.object({ type: z.literal('add-store-group'), storeGroup: canvasStoreGroupSchema }),
  z.object({
    type: z.literal('move-store-group'),
    id,
    x: workspaceCoordinateSchema,
    y: workspaceCoordinateSchema,
  }),
  /** An edit made in the store editor: the group's whole native store document. */
  z.object({ type: z.literal('edit-store-group'), id, document: storeDocumentSchema }),
  z.object({ type: z.literal('set-store-target'), id, targetId: storeTargetIdSchema }),
  z.object({ type: z.literal('rename-store-group'), id, name: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal('remove-store-group'), id }),
])
/** One of {@link canvasCommandSchema}. */
export type CanvasCommand = z.infer<typeof canvasCommandSchema>

function artboardOf(canvas: CanvasDocument, artboardId: string): Artboard {
  const artboard = canvas.artboards.find((item) => item.id === artboardId)
  if (!artboard) throw new Error('That artboard is no longer on this canvas.')
  return artboard
}

function storeGroupOf(canvas: CanvasDocument, groupId: string) {
  const item = canvas.storeGroups.find((entry) => entry.group.id === groupId)
  if (!item) throw new Error('That store group is no longer on this canvas.')
  return item
}

function componentOf(canvas: CanvasDocument, componentId: string) {
  const component = canvas.components.find((item) => item.id === componentId)
  if (!component) throw new Error('That component is no longer on this canvas.')
  return component
}

function instanceOf(artboard: Artboard, instanceId: string) {
  const instance = artboard.instances.find((item) => item.id === instanceId)
  if (!instance) throw new Error('That component instance is no longer on this artboard.')
  return instance
}

/** Keep an artboard's groups and instances true to its document after any document change. */
function settleArtboard(canvas: CanvasDocument, artboard: Artboard) {
  artboard.groups = pruneGroups(artboard.document, artboard.groups)
  artboard.instances = artboard.instances.flatMap((instance) => {
    const component = canvas.components.find((item) => item.id === instance.componentId)
    if (!component) return []
    const next = reconcileInstance(artboard.document, component, instance)
    return next ? [next] : []
  })
}

/** Redraw every instance of a component across the canvas. */
function redrawComponent(canvas: CanvasDocument, componentId: string) {
  const component = componentOf(canvas, componentId)
  for (const artboard of canvas.artboards)
    for (const instance of artboard.instances)
      if (instance.componentId === componentId) {
        instance.version = component.version
        artboard.document = drawInstance(artboard.document, component, instance)
      }
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
      settleArtboard(next, artboard)
      break
    }
    case 'native-edit': {
      const artboard = artboardOf(next, command.id)
      artboard.document = command.document
      settleArtboard(next, artboard)
      break
    }
    case 'update-documents':
      for (const { id, document } of command.documents) {
        const artboard = artboardOf(next, id)
        artboard.document = document
        settleArtboard(next, artboard)
      }
      break
    case 'set-artboard-layers': {
      const artboard = artboardOf(next, command.id)
      artboard.document = command.document
      artboard.groups = command.groups
      settleArtboard(next, artboard)
      break
    }
    case 'add-component': {
      if (next.components.some((item) => item.id === command.component.id))
        throw new Error('That component already exists.')
      next.components.push(command.component)
      const artboard = artboardOf(next, command.artboardId)
      artboard.document = command.document
      artboard.instances.push(command.instance)
      settleArtboard(next, artboard)
      break
    }
    case 'insert-instance': {
      const artboard = artboardOf(next, command.artboardId)
      const component = componentOf(next, command.instance.componentId)
      if (artboard.instances.some((item) => item.id === command.instance.id))
        throw new Error('That instance is already on this artboard.')
      const instance = { ...command.instance, version: component.version }
      artboard.instances.push(instance)
      artboard.document = drawInstance(artboard.document, component, instance)
      break
    }
    case 'update-component': {
      const artboard = artboardOf(next, command.artboardId)
      const instance = instanceOf(artboard, command.instanceId)
      const index = next.components.findIndex((item) => item.id === instance.componentId)
      next.components[index] = componentFromInstance(
        artboard.document,
        componentOf(next, instance.componentId),
        instance
      )
      // The pushed instance now matches its main component exactly.
      instance.overrides = {}
      redrawComponent(next, instance.componentId)
      break
    }
    case 'reset-instance': {
      const artboard = artboardOf(next, command.artboardId)
      const instance = instanceOf(artboard, command.instanceId)
      instance.overrides = {}
      artboard.document = drawInstance(
        artboard.document,
        componentOf(next, instance.componentId),
        instance
      )
      break
    }
    case 'detach-instance': {
      const artboard = artboardOf(next, command.artboardId)
      instanceOf(artboard, command.instanceId)
      artboard.instances = artboard.instances.filter((item) => item.id !== command.instanceId)
      break
    }
    case 'rename-component':
      componentOf(next, command.componentId).name = command.name
      break
    case 'add-store-group':
      if (next.storeGroups.some((item) => item.group.id === command.storeGroup.group.id))
        throw new Error('That store group is already on this canvas.')
      next.storeGroups.push(command.storeGroup)
      break
    case 'move-store-group': {
      const item = storeGroupOf(next, command.id)
      item.x = command.x
      item.y = command.y
      break
    }
    case 'edit-store-group':
      storeGroupOf(next, command.id).group.document = command.document
      break
    case 'set-store-target':
      storeGroupOf(next, command.id).targetId = command.targetId
      break
    case 'rename-store-group':
      storeGroupOf(next, command.id).group.name = command.name
      break
    case 'remove-store-group':
      storeGroupOf(next, command.id)
      next.storeGroups = next.storeGroups.filter((item) => item.group.id !== command.id)
      break
    case 'remove-component':
      componentOf(next, command.componentId)
      next.components = next.components.filter((item) => item.id !== command.componentId)
      for (const artboard of next.artboards)
        artboard.instances = artboard.instances.filter(
          (item) => item.componentId !== command.componentId
        )
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
