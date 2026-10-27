import { z } from 'zod'
import type { DesignDocument } from '@/lib/design/document'

/**
 * Layers inside one artboard, addressed across the native document's
 * sections. Selecting, moving, grouping and component instances all work on
 * these references; the native document stays the only place layers live.
 *
 * Geometry is in canvas fractions, so a move means the same thing at any
 * artboard size: `dx` is a fraction of the artboard's width, `dy` of its
 * height.
 */

const id = z.string().min(1).max(80)

/** The layer sections a reference can point into. Redactions and the main image are not movable layers here. */
export const layerKindSchema = z.enum(['text', 'overlay', 'annotation', 'element', 'mockup'])
/** One of {@link layerKindSchema}. */
export type LayerKind = z.infer<typeof layerKindSchema>

/** One layer in one artboard's native document. */
export const layerRefSchema = z.object({ kind: layerKindSchema, id })
/** One of {@link layerRefSchema}. */
export type LayerRef = z.infer<typeof layerRefSchema>

/** Layers that select and move together. Membership is by reference; the layers stay where they are drawn. */
export const layerGroupSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  layers: z.array(layerRefSchema).min(2).max(60),
})
/** One of {@link layerGroupSchema}. */
export type LayerGroup = z.infer<typeof layerGroupSchema>

/** The DOM attribute the stage draws each layer kind with. */
export const LAYER_ATTRIBUTES: Record<LayerKind, string> = {
  text: 'data-text-overlay-id',
  overlay: 'data-overlay-id',
  annotation: 'data-annotation-id',
  element: 'data-element-id',
  mockup: 'data-device-id',
}

/** A stable string for a reference, for sets and maps. */
export const layerKey = (ref: LayerRef) => `${ref.kind}:${ref.id}`

/** Whether two references name the same layer. */
export const sameLayer = (a: LayerRef, b: LayerRef) => a.kind === b.kind && a.id === b.id

type Sections = {
  texts: DesignDocument['texts']
  overlays: DesignDocument['overlays']
  annotations: DesignDocument['annotations']
  elements: DesignDocument['elements']
  mockups: NonNullable<DesignDocument['devices']>['mockups']
}

function sections(document: DesignDocument): Sections {
  return {
    texts: document.texts,
    overlays: document.overlays,
    annotations: document.annotations,
    elements: document.elements,
    mockups: document.devices?.mockups ?? [],
  }
}

const SECTION: Record<LayerKind, keyof Sections> = {
  text: 'texts',
  overlay: 'overlays',
  annotation: 'annotations',
  element: 'elements',
  mockup: 'mockups',
}

/** Every layer that has an id, bottom to top within each section. */
export function layerRefs(document: DesignDocument): LayerRef[] {
  const all = sections(document)
  return (Object.keys(SECTION) as LayerKind[]).flatMap((kind) =>
    (all[SECTION[kind]] as { id?: string }[]).flatMap((layer) =>
      layer.id ? [{ kind, id: layer.id }] : []
    )
  )
}

/** Whether the document still has this layer. */
export function hasLayer(document: DesignDocument, ref: LayerRef): boolean {
  return (sections(document)[SECTION[ref.kind]] as { id?: string }[]).some(
    (layer) => layer.id === ref.id
  )
}

/** The layer a reference points to, or undefined. */
export function findLayer(document: DesignDocument, ref: LayerRef): unknown {
  return (sections(document)[SECTION[ref.kind]] as { id?: string }[]).find(
    (layer) => layer.id === ref.id
  )
}

/**
 * The document with an id on every layer that lacks one. Documents from v1
 * or the AI may omit ids; grouping and components need them to be stable.
 */
export function ensureLayerIds(document: DesignDocument, newId: () => string): DesignDocument {
  const next = structuredClone(document)
  for (const layer of [
    ...next.texts,
    ...next.overlays,
    ...next.annotations,
    ...(next.devices?.mockups ?? []),
  ])
    layer.id ??= newId()
  return next
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const shiftPoint = (point: { x: number; y: number }, dx: number, dy: number) => ({
  x: clamp(point.x + dx, 0, 1),
  y: clamp(point.y + dy, 0, 1),
})

/** Move the named layers by a fraction of the artboard. Positions stay inside each section's bounds. */
export function translateLayers(
  document: DesignDocument,
  refs: readonly LayerRef[],
  dx: number,
  dy: number
): DesignDocument {
  const moving = new Set(refs.map(layerKey))
  const picked = (kind: LayerKind, layer: { id?: string }) =>
    Boolean(layer.id && moving.has(layerKey({ kind, id: layer.id })))
  const next = structuredClone(document)
  for (const text of next.texts)
    if (picked('text', text))
      text.position = {
        x: clamp(text.position.x + dx * 100, 0, 100),
        y: clamp(text.position.y + dy * 100, 0, 100),
      }
  for (const overlay of next.overlays)
    if (picked('overlay', overlay)) overlay.position = shiftPoint(overlay.position, dx, dy)
  for (const shape of next.annotations)
    if (picked('annotation', shape)) {
      shape.start = shiftPoint(shape.start, dx, dy)
      shape.end = shiftPoint(shape.end, dx, dy)
      if (shape.control) shape.control = shiftPoint(shape.control, dx, dy)
    }
  for (const element of next.elements)
    if (picked('element', element)) {
      element.x = clamp(element.x + dx, -0.5, 1.5)
      element.y = clamp(element.y + dy, -0.5, 1.5)
    }
  for (const mockup of next.devices?.mockups ?? [])
    if (picked('mockup', mockup)) mockup.position = shiftPoint(mockup.position, dx, dy)
  return next
}

/** Move each named layer by its own offset, in artboard fractions. Used by align and distribute. */
export function offsetLayers(
  document: DesignDocument,
  offsets: readonly { ref: LayerRef; dx: number; dy: number }[]
): DesignDocument {
  return offsets.reduce(
    (current, { ref, dx, dy }) => translateLayers(current, [ref], dx, dy),
    document
  )
}

/** The document without the named layers. */
export function removeLayers(document: DesignDocument, refs: readonly LayerRef[]): DesignDocument {
  const removed = new Set(refs.map(layerKey))
  const keep = (kind: LayerKind) => (layer: { id?: string }) =>
    !layer.id || !removed.has(layerKey({ kind, id: layer.id }))
  const next = structuredClone(document)
  next.texts = next.texts.filter(keep('text'))
  next.overlays = next.overlays.filter(keep('overlay'))
  next.annotations = next.annotations.filter(keep('annotation'))
  next.elements = next.elements.filter(keep('element'))
  if (next.devices) next.devices.mockups = next.devices.mockups.filter(keep('mockup'))
  return next
}

/** Show or hide the named layers. Hidden layers stay in the document and out of exports. */
export function setLayersVisible(
  document: DesignDocument,
  refs: readonly LayerRef[],
  visible: boolean
): DesignDocument {
  const chosen = new Set(refs.map(layerKey))
  const next = structuredClone(document)
  const apply = (kind: LayerKind, layers: { id?: string; visible?: boolean }[]) => {
    for (const layer of layers)
      if (layer.id && chosen.has(layerKey({ kind, id: layer.id }))) layer.visible = visible
  }
  apply('text', next.texts)
  apply('overlay', next.overlays)
  apply('annotation', next.annotations)
  apply('element', next.elements)
  apply('mockup', next.devices?.mockups ?? [])
  return next
}

/** The section limits of the native document; copies that would pass them are refused. */
const LIMITS: Record<keyof Sections, number> = {
  texts: 20,
  overlays: 40,
  annotations: 30,
  elements: 60,
  mockups: 6,
}

/**
 * Copies of the named layers above the originals, offset by (dx, dy) in
 * artboard fractions. Returns the copies' references in the same order.
 */
export function duplicateLayers(
  document: DesignDocument,
  refs: readonly LayerRef[],
  newId: () => string,
  offset = { dx: 0.02, dy: 0.02 }
): { document: DesignDocument; copies: LayerRef[] } {
  let next = structuredClone(document)
  const copies: LayerRef[] = []
  for (const ref of refs) {
    const layer = findLayer(next, ref) as { id?: string } | undefined
    if (!layer) continue
    const key = SECTION[ref.kind]
    const list = (key === 'mockups' ? (next.devices ??= { mockups: [] }).mockups : next[key]) as {
      id?: string
    }[]
    if (list.length >= LIMITS[key])
      throw new Error(`An artboard holds at most ${LIMITS[key]} ${key}.`)
    const copy = { ...structuredClone(layer), id: newId() }
    list.push(copy)
    copies.push({ kind: ref.kind, id: copy.id })
  }
  next = translateLayers(next, copies, offset.dx, offset.dy)
  return { document: next, copies }
}

/** Groups that still name at least two existing layers, trimmed to the layers that exist. */
export function pruneGroups(document: DesignDocument, groups: readonly LayerGroup[]): LayerGroup[] {
  return groups.flatMap((group) => {
    const layers = group.layers.filter((ref) => hasLayer(document, ref))
    return layers.length >= 2 ? [{ ...group, layers }] : []
  })
}

/** The group a layer belongs to, if any. */
export function groupOf(groups: readonly LayerGroup[], ref: LayerRef): LayerGroup | undefined {
  return groups.find((group) => group.layers.some((member) => sameLayer(member, ref)))
}

/**
 * Groups after grouping the given layers. A layer belongs to one group: the
 * layers leave any group they were in, and groups left with fewer than two
 * layers dissolve. Grouping whole groups nests by flattening their members.
 */
export function groupLayers(
  groups: readonly LayerGroup[],
  refs: readonly LayerRef[],
  group: { id: string; name: string }
): LayerGroup[] {
  const members = new Map<string, LayerRef>()
  for (const ref of refs) {
    const existing = groupOf(groups, ref)
    for (const member of existing ? existing.layers : [ref]) members.set(layerKey(member), member)
  }
  if (members.size < 2) throw new Error('Select at least two layers to group.')
  const rest = groups.flatMap((item) => {
    const layers = item.layers.filter((member) => !members.has(layerKey(member)))
    return layers.length >= 2 ? [{ ...item, layers }] : []
  })
  return [...rest, layerGroupSchema.parse({ ...group, layers: [...members.values()] })]
}

/** Groups after dissolving one; its layers stay where they are. */
export function ungroupLayers(groups: readonly LayerGroup[], groupId: string): LayerGroup[] {
  return groups.filter((group) => group.id !== groupId)
}
