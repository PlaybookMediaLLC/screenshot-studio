import { z } from 'zod'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { canvasElementSchema } from '@/lib/editor/elements/schema'
import { documentCanvasSize } from '@/lib/export/adapt'
import { findLayer, layerKindSchema, type LayerKind, type LayerRef } from './layers'

/**
 * Reusable components with overrides. A component's main layers are native
 * layers, kept with the artboard size and frame they were made in. An
 * instance places them in an artboard at a pixel offset; its layers live in
 * that artboard's native document like any other, with ids derived from the
 * instance and the main layer, so the editor, previews and exports need
 * nothing new.
 *
 * Editing an instance layer records what changed as an override of that
 * layer. Moving every layer of an instance together moves the instance.
 * Updating the main component redraws every instance, keeping each one's
 * overrides; resetting drops them; detaching leaves plain layers.
 */

const id = z.string().min(1).max(80)
const pixels = z.number().int().min(1).max(8192)

const sectionsSchema = designDocumentSchema.shape
const textLayerSchema = sectionsSchema.texts.unwrap().element
const overlayLayerSchema = sectionsSchema.overlays.unwrap().element
const annotationLayerSchema = sectionsSchema.annotations.unwrap().element
const mockupLayerSchema = sectionsSchema.devices.unwrap().shape.mockups.unwrap().element
const withId = <T extends z.ZodType<{ id?: string }>>(schema: T) =>
  schema.refine((layer) => Boolean(layer.id), 'Component layers need ids.')

/** One main layer of a component, with the section it belongs to. */
export const componentLayerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), layer: withId(textLayerSchema) }),
  z.object({ kind: z.literal('overlay'), layer: withId(overlayLayerSchema) }),
  z.object({ kind: z.literal('annotation'), layer: withId(annotationLayerSchema) }),
  z.object({ kind: z.literal('element'), layer: canvasElementSchema }),
  z.object({ kind: z.literal('mockup'), layer: withId(mockupLayerSchema) }),
])
/** One of {@link componentLayerSchema}. */
export type ComponentLayer = z.infer<typeof componentLayerSchema>

/** A pixel rectangle. */
const pixelRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(8192),
  height: z.number().positive().max(8192),
})

/** A reusable set of layers. */
export const canvasComponentSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  /** Bumped each time the main layers change. */
  version: z.number().int().positive(),
  /** The artboard size the main layers' fractions refer to. */
  size: z.object({ width: pixels, height: pixels }),
  /** The component's frame inside that artboard; instances place this corner. */
  frame: pixelRectSchema,
  layers: z.array(componentLayerSchema).min(1).max(40),
})
/** One of {@link canvasComponentSchema}. */
export type CanvasComponent = z.infer<typeof canvasComponentSchema>

/** Changed fields of one instance layer, by main layer id. Only these stop following the main component. */
export const layerOverridesSchema = z.record(id, z.record(z.string(), z.unknown()))
/** One of {@link layerOverridesSchema}. */
export type LayerOverrides = z.infer<typeof layerOverridesSchema>

/** One placement of a component in an artboard. */
export const componentInstanceSchema = z.object({
  id: z.string().min(1).max(40),
  componentId: id,
  /** The component version this instance last drew. */
  version: z.number().int().positive(),
  /** Where the frame's top-left corner sits, in artboard pixels. */
  x: z.number().finite().min(-8192).max(16384),
  y: z.number().finite().min(-8192).max(16384),
  scale: z.number().min(0.05).max(20).default(1),
  overrides: layerOverridesSchema.default({}),
})
/** One of {@link componentInstanceSchema}. */
export type ComponentInstance = z.infer<typeof componentInstanceSchema>

/** The id an instance gives its copy of a main layer. */
export const instanceLayerId = (instanceId: string, mainId: string) => `${instanceId}.${mainId}`

/** The main layer id behind an instance layer id, or null when the layer is not the instance's. */
export function mainLayerId(instanceId: string, layerId: string): string | null {
  return layerId.startsWith(`${instanceId}.`) ? layerId.slice(instanceId.length + 1) : null
}

type Size = { width: number; height: number }
type Point = { x: number; y: number }
type Layer = Record<string, unknown> & { id?: string }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The geometry fields of each layer kind; a uniform change of these is a move. */
const GEOMETRY: Record<LayerKind, string[]> = {
  text: ['position'],
  overlay: ['position'],
  annotation: ['start', 'end', 'control'],
  element: ['x', 'y'],
  mockup: ['position'],
}

/** A layer's anchor in pixels of the artboard it is drawn in. */
function anchor(kind: LayerKind, layer: Layer, size: Size): Point {
  if (kind === 'text') {
    const position = layer.position as Point
    return { x: (position.x / 100) * size.width, y: (position.y / 100) * size.height }
  }
  if (kind === 'element')
    return { x: (layer.x as number) * size.width, y: (layer.y as number) * size.height }
  const point = (kind === 'annotation' ? layer.start : layer.position) as Point
  return { x: point.x * size.width, y: point.y * size.height }
}

/**
 * A layer redrawn from one pixel space into another: `map` moves pixel
 * points, `scale` grows sizes. Results stay inside each section's bounds.
 */
function transformLayer(
  kind: LayerKind,
  source: Layer,
  from: Size,
  to: Size,
  map: (point: Point) => Point,
  scale: number
): Layer {
  const layer = structuredClone(source)
  const unit = (point: Point) => {
    const moved = map({ x: point.x * from.width, y: point.y * from.height })
    return { x: clamp(moved.x / to.width, 0, 1), y: clamp(moved.y / to.height, 0, 1) }
  }
  const width = (fraction: number) => (fraction * from.width * scale) / to.width
  switch (kind) {
    case 'text': {
      const position = layer.position as Point
      const moved = map({
        x: (position.x / 100) * from.width,
        y: (position.y / 100) * from.height,
      })
      layer.position = {
        x: clamp((moved.x / to.width) * 100, 0, 100),
        y: clamp((moved.y / to.height) * 100, 0, 100),
      }
      layer.fontSize = clamp(width(layer.fontSize as number), 0.005, 0.3)
      if (typeof layer.maxWidth === 'number')
        layer.maxWidth = clamp(width(layer.maxWidth), 0.05, 1.5)
      break
    }
    case 'overlay':
      layer.position = unit(layer.position as Point)
      layer.size = clamp(width(layer.size as number), 0.01, 2)
      break
    case 'annotation':
      layer.start = unit(layer.start as Point)
      layer.end = unit(layer.end as Point)
      if (layer.control) layer.control = unit(layer.control as Point)
      layer.strokeWidth = clamp(Math.round((layer.strokeWidth as number) * scale), 1, 40)
      break
    case 'element': {
      const moved = map({
        x: (layer.x as number) * from.width,
        y: (layer.y as number) * from.height,
      })
      layer.x = clamp(moved.x / to.width, -0.5, 1.5)
      layer.y = clamp(moved.y / to.height, -0.5, 1.5)
      layer.width = clamp(width(layer.width as number), 0.005, 2)
      layer.height = clamp(((layer.height as number) * from.height * scale) / to.height, 0.005, 2)
      break
    }
    case 'mockup':
      layer.position = unit(layer.position as Point)
      layer.size = clamp(width(layer.size as number), 0.05, 1)
      break
  }
  return layer
}

const SECTION: Record<LayerKind, 'texts' | 'overlays' | 'annotations' | 'elements' | 'mockups'> = {
  text: 'texts',
  overlay: 'overlays',
  annotation: 'annotations',
  element: 'elements',
  mockup: 'mockups',
}
const LIMITS = { texts: 20, overlays: 40, annotations: 30, elements: 60, mockups: 6 } as const

function sectionOf(document: DesignDocument, kind: LayerKind): Layer[] {
  const key = SECTION[kind]
  return (
    key === 'mockups' ? (document.devices ??= { mockups: [] }).mockups : document[key]
  ) as Layer[]
}

/** The instance's layers as the main component draws them, without overrides, by main layer id. */
function baseLayers(
  component: CanvasComponent,
  instance: Pick<ComponentInstance, 'id' | 'x' | 'y' | 'scale'>,
  size: Size
): Map<string, { kind: LayerKind; layer: Layer }> {
  const map = (point: Point) => ({
    x: instance.x + (point.x - component.frame.x) * instance.scale,
    y: instance.y + (point.y - component.frame.y) * instance.scale,
  })
  return new Map(
    component.layers.map(({ kind, layer }) => [
      layer.id!,
      {
        kind,
        layer: {
          ...transformLayer(kind, layer as Layer, component.size, size, map, instance.scale),
          id: instanceLayerId(instance.id, layer.id!),
        },
      },
    ])
  )
}

/** The instance's layers with its overrides applied, by main layer id. */
export function instanceLayers(
  component: CanvasComponent,
  instance: ComponentInstance,
  size: Size
): Map<string, { kind: LayerKind; layer: Layer }> {
  const layers = baseLayers(component, instance, size)
  for (const [mainId, item] of layers) {
    const override = instance.overrides[mainId]
    if (override) item.layer = { ...item.layer, ...structuredClone(override), id: item.layer.id }
  }
  return layers
}

/**
 * The document with the instance drawn from its component: its layers are
 * replaced in place, layers whose main layer is gone are removed, and new
 * main layers are added on top of their section.
 */
export function drawInstance(
  document: DesignDocument,
  component: CanvasComponent,
  instance: ComponentInstance
): DesignDocument {
  const next = structuredClone(document)
  const layers = instanceLayers(component, instance, documentCanvasSize(document))
  const placed = new Set<string>()
  for (const kind of layerKindSchema.options) {
    const list = sectionOf(next, kind)
    const kept: Layer[] = []
    for (const layer of list) {
      const mainId = layer.id ? mainLayerId(instance.id, layer.id) : null
      if (mainId === null) {
        kept.push(layer)
        continue
      }
      const drawn = layers.get(mainId)
      if (drawn && drawn.kind === kind) {
        kept.push(drawn.layer)
        placed.add(mainId)
      }
    }
    for (const [mainId, drawn] of layers)
      if (drawn.kind === kind && !placed.has(mainId)) {
        kept.push(drawn.layer)
        placed.add(mainId)
      }
    if (kept.length > LIMITS[SECTION[kind]])
      throw new Error(`This artboard has no room for another ${kind} layer.`)
    list.splice(0, list.length, ...kept)
  }
  return designDocumentSchema.parse(next)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The instance after an edit of its artboard: when every instance layer
 * moved by the same amount the instance moved; any other difference from
 * the main component is kept as an override of that layer. A deleted
 * instance layer becomes a hidden one, so resetting brings it back; an
 * instance with no layers left is gone (null).
 */
export function reconcileInstance(
  document: DesignDocument,
  component: CanvasComponent,
  instance: ComponentInstance
): ComponentInstance | null {
  const size = documentCanvasSize(document)
  const actual = new Map<string, Layer>()
  for (const kind of layerKindSchema.options)
    for (const layer of sectionOf(structuredClone(document), kind)) {
      const mainId = layer.id ? mainLayerId(instance.id, layer.id) : null
      if (mainId !== null) actual.set(mainId, layer)
    }
  if (!actual.size) return null
  let base = baseLayers(component, instance, size)
  const shifts = [...actual].flatMap(([mainId, layer]) => {
    const drawn = base.get(mainId)
    if (!drawn) return []
    const from = anchor(drawn.kind, drawn.layer, size)
    const to = anchor(drawn.kind, layer, size)
    return [{ x: to.x - from.x, y: to.y - from.y }]
  })
  const first = shifts[0]
  let next = { ...instance }
  if (
    first &&
    shifts.length === component.layers.length &&
    Math.hypot(first.x, first.y) > 0.5 &&
    shifts.every((shift) => Math.abs(shift.x - first.x) < 0.5 && Math.abs(shift.y - first.y) < 0.5)
  ) {
    next = { ...next, x: instance.x + first.x, y: instance.y + first.y }
    base = baseLayers(component, next, size)
  }
  const overrides: LayerOverrides = {}
  for (const [mainId, drawn] of base) {
    const layer = actual.get(mainId)
    if (!layer) {
      overrides[mainId] = { visible: false }
      continue
    }
    const changed: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(drawn.layer), ...Object.keys(layer)])) {
      if (key === 'id') continue
      // Geometry within half a pixel of the main component still follows it.
      if (
        GEOMETRY[drawn.kind].includes(key) &&
        nearlySame(drawn.layer[key], layer[key], size, drawn.kind)
      )
        continue
      if (!same(drawn.layer[key], layer[key])) changed[key] = structuredClone(layer[key])
    }
    if (Object.keys(changed).length) overrides[mainId] = changed
  }
  return componentInstanceSchema.parse({ ...next, overrides })
}

function nearlySame(a: unknown, b: unknown, size: Size, kind: LayerKind): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const span = kind === 'element' ? Math.max(size.width, size.height) : 1
    return Math.abs(a - b) * span < 0.5
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const p = a as Point
    const q = b as Point
    const factor = kind === 'text' ? 100 : 1
    return (
      Math.abs(p.x - q.x) * (size.width / factor) < 0.5 &&
      Math.abs(p.y - q.y) * (size.height / factor) < 0.5
    )
  }
  return a === b
}

/**
 * A component made from layers of one artboard, and the instance those
 * layers become. `frame` is the layers' bounds in artboard pixels.
 */
export function createComponent(
  document: DesignDocument,
  refs: readonly LayerRef[],
  {
    componentId,
    instanceId,
    name,
    frame,
    newId,
  }: {
    componentId: string
    instanceId: string
    name: string
    frame: z.infer<typeof pixelRectSchema>
    /** Short ids for the main layers; instance layer ids join them with the instance id. */
    newId: () => string
  }
): { component: CanvasComponent; instance: ComponentInstance; document: DesignDocument } {
  const size = documentCanvasSize(document)
  const renames = new Map<string, string>()
  const layers = refs.flatMap((ref): ComponentLayer[] => {
    const layer = findLayer(document, ref) as Layer | undefined
    if (!layer?.id) return []
    const mainId = newId()
    renames.set(`${ref.kind}:${layer.id}`, mainId)
    return [
      componentLayerSchema.parse({
        kind: ref.kind,
        layer: { ...structuredClone(layer), id: mainId },
      }),
    ]
  })
  if (!layers.length) throw new Error('Select the layers to make a component from.')
  const component = canvasComponentSchema.parse({
    id: componentId,
    name,
    version: 1,
    size: { width: Math.round(size.width), height: Math.round(size.height) },
    frame,
    layers,
  })
  const instance = componentInstanceSchema.parse({
    id: instanceId,
    componentId,
    version: 1,
    x: frame.x,
    y: frame.y,
  })
  // The selected layers become the first instance in place.
  const renamed = structuredClone(document)
  for (const kind of layerKindSchema.options)
    for (const layer of sectionOf(renamed, kind)) {
      const mainId = layer.id ? renames.get(`${kind}:${layer.id}`) : undefined
      if (mainId) layer.id = instanceLayerId(instanceId, mainId)
    }
  return { component, instance, document: designDocumentSchema.parse(renamed) }
}

/**
 * The component after pushing one instance's current layers to it: the
 * instance's overrides become the main layers, and its version goes up.
 */
export function componentFromInstance(
  document: DesignDocument,
  component: CanvasComponent,
  instance: ComponentInstance
): CanvasComponent {
  const size = documentCanvasSize(document)
  const drawn = instanceLayers(component, instance, size)
  const inverse = (point: Point) => ({
    x: component.frame.x + (point.x - instance.x) / instance.scale,
    y: component.frame.y + (point.y - instance.y) / instance.scale,
  })
  const layers = component.layers.flatMap(({ kind, layer: main }): ComponentLayer[] => {
    const item = drawn.get(main.id!)
    if (!item) return []
    const back = transformLayer(kind, item.layer, size, component.size, inverse, 1 / instance.scale)
    return [componentLayerSchema.parse({ kind, layer: { ...back, id: main.id } })]
  })
  return canvasComponentSchema.parse({ ...component, version: component.version + 1, layers })
}

/** A native document holding a component's main layers, so uploads and recovery treat them like any layers. */
export function componentDocument(component: CanvasComponent): DesignDocument {
  const pick = (kind: LayerKind) =>
    component.layers.filter((item) => item.kind === kind).map((item) => item.layer)
  return designDocumentSchema.parse({
    version: 2,
    canvas: { aspectRatio: 'custom', padding: 0, size: component.size },
    background: { type: 'solid', value: '#ffffff', radius: 0 },
    image: {},
    texts: pick('text'),
    overlays: pick('overlay'),
    annotations: pick('annotation'),
    elements: pick('element'),
    devices: { mockups: pick('mockup') },
  })
}

/** The component with its main layers read back from {@link componentDocument}. */
export function withComponentDocument(
  component: CanvasComponent,
  document: DesignDocument
): CanvasComponent {
  const layers = component.layers.map((item) => {
    const updated = findLayer(document, { kind: item.kind, id: item.layer.id! })
    return componentLayerSchema.parse({ kind: item.kind, layer: updated ?? item.layer })
  })
  return { ...component, layers }
}
