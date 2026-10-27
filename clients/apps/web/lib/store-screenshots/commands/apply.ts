import { getDeviceModel } from '../devices'
import {
  createDeviceLayer,
  createTextLayer,
  DEFAULT_IMAGE_FILTERS,
  DEFAULT_IMAGE_FRAMING,
  hashRichText,
  IDENTITY_TRANSFORM,
  newId,
  plainRichText,
} from '../document/factory'
import {
  layerSchema,
  type DeviceFrame,
  type DeviceLayer,
  type Panorama,
  type StoreDocument,
  type StoreLayer,
  type StoreSlideV2,
  type TextLayer,
  type TextRole,
  type TextStyleOverrides,
  type TranslationStatus,
} from '../document/schema'
import { applyBrandKit } from '../brand-kits'
import { getLayoutPreset, resolveLayoutId } from '../engine/presets'
import { applyTemplateToDocument } from '../templates'
import type { ArrangeMove, Command, LayerOwner, LayerPatch, StyleGroup, TextResetScope } from './schema'

/**
 * The command reducer. Pure: `applyCommand(document, command, now)` returns
 * a new document (or the same object when the command changes nothing) and
 * never mutates its input. Every layer it writes is re-validated, so a bad
 * patch is dropped instead of corrupting the document.
 */

/** Most slides a project may hold. */
export const MAX_PROJECT_SLIDES = 30

const TYPOGRAPHY_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'align',
  'verticalAlign',
  'italic',
  'uppercase',
  'autoFit',
  'minFontSize',
  'maxLines',
  'wrap',
] as const satisfies ReadonlyArray<keyof TextStyleOverrides>

function pick(style: TextStyleOverrides, keys: ReadonlyArray<keyof TextStyleOverrides>): TextStyleOverrides {
  const picked: Record<string, unknown> = {}
  for (const key of keys) if (style[key] !== undefined) picked[key] = style[key]
  return picked as TextStyleOverrides
}

function omit(style: TextStyleOverrides, keys: ReadonlyArray<keyof TextStyleOverrides>): TextStyleOverrides {
  const rest: Record<string, unknown> = { ...style }
  for (const key of keys) delete rest[key]
  return rest as TextStyleOverrides
}

function validLayer(next: StoreLayer, previous: StoreLayer): StoreLayer {
  const parsed = layerSchema.safeParse(next)
  return parsed.success ? parsed.data : previous
}

function slideIndex(document: StoreDocument, slideId: string): number {
  return document.slides.findIndex((slide) => slide.id === slideId)
}

function mapSlides(
  document: StoreDocument,
  ids: readonly string[],
  update: (slide: StoreSlideV2, index: number) => StoreSlideV2
): StoreDocument {
  const wanted = new Set(ids)
  let changed = false
  const slides = document.slides.map((slide, index) => {
    if (!wanted.has(slide.id)) return slide
    const next = update(slide, index)
    if (next !== slide) changed = true
    return next
  })
  return changed ? { ...document, slides } : document
}

function withLayers(
  document: StoreDocument,
  owner: LayerOwner,
  update: (layers: StoreLayer[]) => StoreLayer[]
): StoreDocument {
  if (owner.kind === 'slide') {
    return mapSlides(document, [owner.id], (slide) => {
      const layers = update(slide.layers)
      return layers === slide.layers ? slide : { ...slide, layers }
    })
  }
  let changed = false
  const panoramas = document.panoramas.map((panorama) => {
    if (panorama.id !== owner.id) return panorama
    const layers = update(panorama.layers)
    if (layers === panorama.layers) return panorama
    changed = true
    return { ...panorama, layers }
  })
  return changed ? { ...document, panoramas } : document
}

function mapLayers(
  layers: StoreLayer[],
  ids: readonly string[],
  update: (layer: StoreLayer) => StoreLayer
): StoreLayer[] {
  const wanted = new Set(ids)
  let changed = false
  const next = layers.map((layer) => {
    if (!wanted.has(layer.id)) return layer
    const updated = validLayer(update(layer), layer)
    if (updated !== layer) changed = true
    return updated
  })
  return changed ? next : layers
}

const PROP_KEYS: Record<string, ReadonlyArray<string>> = {
  annotation: ['kind', 'height', 'text', 'caption', 'color', 'fill', 'textColor', 'strokeWidth', 'value', 'curve', 'shape'],
  callout: ['deviceLayerId', 'region', 'shape', 'borderWidth', 'borderColor', 'shadow', 'connector'],
  image: ['assetId'],
  text: [],
  device: [],
}

/** Apply a layer patch to one layer. Unknown or mismatched fields are ignored. */
export function patchLayer(layer: StoreLayer, patch: LayerPatch): StoreLayer {
  const next: Record<string, unknown> = { ...layer }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.hidden !== undefined) next.hidden = patch.hidden
  if (patch.locked !== undefined) next.locked = patch.locked
  if (patch.opacity !== undefined) next.opacity = patch.opacity
  if (patch.groupId !== undefined) next.groupId = patch.groupId
  if (patch.transform) next.transform = { ...layer.transform, ...patch.transform }
  if (patch.placement) next.placement = patch.placement
  if (layer.type === 'text') {
    if (patch.content) next.content = patch.content
    if (patch.role) next.role = patch.role
    if (patch.style !== undefined) next.style = patch.style === null ? {} : { ...layer.style, ...patch.style }
  }
  if (layer.type === 'device') {
    if (patch.assetId !== undefined) next.assetId = patch.assetId
    if (patch.frame) next.frame = { ...layer.frame, ...patch.frame }
    if (patch.image) next.image = { ...layer.image, ...patch.image }
    if (patch.filters) next.filters = { ...layer.filters, ...patch.filters }
    if (patch.statusBar) next.statusBar = { ...layer.statusBar, ...patch.statusBar }
  }
  if (patch.props) {
    for (const key of PROP_KEYS[layer.type] ?? []) {
      if (key in patch.props) next[key] = patch.props[key]
    }
  }
  return next as StoreLayer
}

function frameForSlot(document: StoreDocument, family: string | undefined): DeviceFrame {
  const themeFrame = document.theme.deviceFrame
  const themeFamily = getDeviceModel(themeFrame.modelId).family
  if (!family || family === themeFamily) return { ...themeFrame }
  if (family === 'tablet') return { ...themeFrame, modelId: 'ipad-pro-13', finishId: 'space-black' }
  if (family === 'phone') return { ...themeFrame, modelId: 'iphone-17-pro', finishId: 'deep-blue' }
  return { ...themeFrame }
}

function firstDeviceAsset(slide: StoreSlideV2 | undefined): string | null {
  const device = slide?.layers.find((layer): layer is DeviceLayer => layer.type === 'device')
  return device?.assetId ?? null
}

/**
 * Give a slide one device per slot of its layout. New devices show the
 * slide's own screenshot or the next slide's, so a Duo starts with two
 * different screens. Devices beyond the layout's slots are kept, not deleted.
 */
export function ensureLayoutSlots(document: StoreDocument, index: number): StoreDocument {
  const slide = document.slides[index]
  const preset = getLayoutPreset(resolveLayoutId(document, index))
  const used = new Set(
    slide.layers.flatMap((layer) =>
      layer.type === 'device' && layer.placement.mode === 'auto' ? [layer.placement.slot] : []
    )
  )
  const additions: StoreLayer[] = []
  preset.slots.forEach((spec, slot) => {
    if (used.has(slot)) return
    const neighbour = document.slides[(index + slot) % document.slides.length]
    const assetId = slot === 0 ? firstDeviceAsset(slide) : (firstDeviceAsset(neighbour) ?? firstDeviceAsset(slide))
    additions.push(createDeviceLayer(assetId, slot, frameForSlot(document, spec.family)))
  })
  if (additions.length === 0) return document
  const slides = [...document.slides]
  slides[index] = { ...slide, layers: [...additions, ...slide.layers] }
  return { ...document, slides }
}

function ensureAllLayoutSlots(document: StoreDocument): StoreDocument {
  return document.slides.reduce((current, _slide, index) => ensureLayoutSlots(current, index), document)
}

/** Reorder so each panorama's slides stay together, in panorama order, at the first member's position. */
export function keepPanoramasTogether(order: string[], panoramas: Panorama[]): string[] {
  let result = [...order]
  for (const panorama of panoramas) {
    const members = panorama.slideIds.filter((id) => result.includes(id))
    if (members.length < 2) continue
    const first = Math.min(...members.map((id) => result.indexOf(id)))
    const rest = result.filter((id) => !members.includes(id))
    const before = result.slice(0, first).filter((id) => !members.includes(id)).length
    result = [...rest.slice(0, before), ...members, ...rest.slice(before)]
  }
  return result
}

function withOrder(document: StoreDocument, order: string[]): StoreDocument {
  const byId = new Map(document.slides.map((slide) => [slide.id, slide]))
  if (order.length !== document.slides.length || order.some((id) => !byId.has(id))) return document
  const normalized = keepPanoramasTogether(order, document.panoramas)
  if (normalized.every((id, index) => document.slides[index].id === id)) return document
  return { ...document, slides: normalized.map((id) => byId.get(id)!) }
}

function cloneLayer(layer: StoreLayer, idMap: Map<string, string>): StoreLayer {
  const copy = structuredClone(layer)
  copy.id = idMap.get(layer.id) ?? newId()
  if (copy.type === 'callout') copy.deviceLayerId = idMap.get(copy.deviceLayerId) ?? copy.deviceLayerId
  return copy
}

function cloneSlide(slide: StoreSlideV2): StoreSlideV2 {
  const idMap = new Map(slide.layers.map((layer) => [layer.id, newId()]))
  const groupMap = new Map<string, string>()
  const layers = slide.layers.map((layer) => {
    const copy = cloneLayer(layer, idMap)
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, newId())
      copy.groupId = groupMap.get(copy.groupId)!
    }
    return copy
  })
  const targetOverrides = Object.fromEntries(
    Object.entries(slide.targetOverrides).map(([target, overrides]) => [
      target,
      Object.fromEntries(Object.entries(overrides).map(([layerId, value]) => [idMap.get(layerId) ?? layerId, value])),
    ])
  )
  return {
    ...structuredClone(slide),
    id: newId(),
    name: `${slide.name} copy`.slice(0, 80),
    backgroundSpan: null,
    layers,
    targetOverrides,
  }
}

function layersOfRole(slide: StoreSlideV2, role: TextRole): TextLayer[] {
  return slide.layers.filter((layer): layer is TextLayer => layer.type === 'text' && layer.role === role)
}

function devicesOf(slide: StoreSlideV2): DeviceLayer[] {
  return slide.layers.filter((layer): layer is DeviceLayer => layer.type === 'device')
}

function applyStyle(source: StoreSlideV2, target: StoreSlideV2, groups: StyleGroup[]): StoreSlideV2 {
  let next = target
  const has = (group: StyleGroup) => groups.includes(group)
  if (has('background')) next = { ...next, background: structuredClone(source.background), backgroundSpan: null }
  if (has('layout')) next = { ...next, layout: source.layout }
  const roles: TextRole[] = ['heading', 'subheading', 'body']
  const updateText = has('typography') || has('textColors') || has('textPosition')
  const sourceDevices = devicesOf(source)
  const updateDevices =
    sourceDevices.length > 0 && (has('deviceFrame') || has('devicePlacement') || has('screenFraming'))
  if (!updateText && !updateDevices) return next

  const positionInRole = new Map<string, number>()
  for (const role of roles) layersOfRole(next, role).forEach((layer, index) => positionInRole.set(layer.id, index))
  let deviceIndex = 0
  const layers = next.layers.map((layer) => {
    if (layer.type === 'text' && updateText) {
      const sources = layersOfRole(source, layer.role)
      const reference = sources[positionInRole.get(layer.id) ?? 0] ?? sources[0]
      let style = layer.style
      if (has('typography')) {
        style = { ...omit(style, TYPOGRAPHY_KEYS), ...(reference ? pick(reference.style, TYPOGRAPHY_KEYS) : {}) }
      }
      if (has('textColors')) {
        style = { ...omit(style, ['color']), ...(reference ? pick(reference.style, ['color']) : {}) }
      }
      const position =
        has('textPosition') && reference
          ? { transform: { ...reference.transform }, placement: structuredClone(reference.placement) }
          : {}
      return validLayer({ ...layer, style, ...position }, layer)
    }
    if (layer.type === 'device' && updateDevices) {
      const reference = sourceDevices[Math.min(deviceIndex, sourceDevices.length - 1)]
      deviceIndex += 1
      return validLayer(
        {
          ...layer,
          ...(has('deviceFrame') ? { frame: { ...reference.frame } } : {}),
          ...(has('devicePlacement') ? { transform: { ...reference.transform } } : {}),
          ...(has('screenFraming') ? { image: { ...reference.image }, filters: { ...reference.filters } } : {}),
        },
        layer
      )
    }
    return layer
  })
  return { ...next, layers }
}

function resetText(layer: TextLayer, scope: TextResetScope): TextLayer {
  const position = scope === 'position' || scope === 'all'
  const style = scope === 'style' || scope === 'all'
  const localeOverrides = Object.fromEntries(
    Object.entries(layer.localeOverrides).map(([locale, override]) => [
      locale,
      {
        style: style ? {} : override.style,
        offsetX: position ? 0 : override.offsetX,
        offsetY: position ? 0 : override.offsetY,
      },
    ])
  )
  return {
    ...layer,
    transform: position ? { ...IDENTITY_TRANSFORM } : layer.transform,
    style: style ? {} : layer.style,
    localeOverrides,
  }
}

function resetLayer(layer: StoreLayer): StoreLayer {
  if (layer.type === 'text') return resetText(layer, 'all')
  if (layer.type === 'device') {
    return {
      ...layer,
      transform: { ...IDENTITY_TRANSFORM },
      image: { ...DEFAULT_IMAGE_FRAMING },
      filters: { ...DEFAULT_IMAGE_FILTERS },
    }
  }
  return { ...layer, transform: { ...IDENTITY_TRANSFORM } }
}

function arrange(layers: StoreLayer[], ids: readonly string[], move: ArrangeMove): StoreLayer[] {
  const selected = new Set(ids)
  const picked = layers.filter((layer) => selected.has(layer.id))
  if (picked.length === 0) return layers
  const rest = layers.filter((layer) => !selected.has(layer.id))
  if (move === 'front') return [...rest, ...picked]
  if (move === 'back') return [...picked, ...rest]
  const next = [...layers]
  const step = move === 'forward' ? 1 : -1
  const indices = next.map((layer, index) => (selected.has(layer.id) ? index : -1)).filter((index) => index >= 0)
  const ordered = step === 1 ? [...indices].reverse() : indices
  for (const index of ordered) {
    const swap = index + step
    if (swap < 0 || swap >= next.length || selected.has(next[swap].id)) continue
    ;[next[index], next[swap]] = [next[swap], next[index]]
  }
  return next.every((layer, index) => layer === layers[index]) ? layers : next
}

function removeSlides(document: StoreDocument, ids: readonly string[]): StoreDocument {
  const removed = new Set(ids)
  const slides = document.slides.filter((slide) => !removed.has(slide.id))
  if (slides.length === 0 || slides.length === document.slides.length) return document
  const panoramas = document.panoramas
    .map((panorama) => ({ ...panorama, slideIds: panorama.slideIds.filter((id) => !removed.has(id)) }))
    .filter((panorama) => panorama.slideIds.length >= 2)
  return { ...document, slides, panoramas }
}

function detachPanorama(document: StoreDocument, panorama: Panorama): StoreDocument {
  const count = panorama.slideIds.length
  let next = document
  panorama.slideIds.forEach((slideId, index) => {
    next = mapSlides(next, [slideId], (slide) => {
      const copies: StoreLayer[] = []
      for (const layer of panorama.layers) {
        if (!('placement' in layer) || layer.placement.mode !== 'free') continue
        const x = layer.placement.x * count - index * 100
        const width = layer.placement.width * count
        if (x + width / 2 < 0 || x - width / 2 > 100) continue
        const copy = cloneLayer(layer, new Map())
        if ('placement' in copy && copy.placement.mode === 'free') copy.placement = { ...copy.placement, x, width }
        copies.push(validLayer(copy, layer))
      }
      return {
        ...slide,
        background: structuredClone(panorama.background),
        backgroundSpan: { count, index },
        layers: [...copies, ...slide.layers],
      }
    })
  })
  return { ...next, panoramas: next.panoramas.filter((item) => item.id !== panorama.id) }
}

function setTranslation(
  layer: TextLayer,
  locale: string,
  content: TextLayer['content'],
  status: TranslationStatus,
  now: number
): TextLayer {
  return {
    ...layer,
    translations: {
      ...layer.translations,
      [locale]: { content, status, sourceHash: hashRichText(layer.content), updatedAt: now },
    },
  }
}

function applyCopySuggestion(document: StoreDocument, suggestionId: string, now: number): StoreDocument {
  const suggestion = document.copySuggestions.find((item) => item.id === suggestionId)
  if (!suggestion) return document
  const index = slideIndex(document, suggestion.slideId)
  if (index === -1) return document
  const source = document.localization.sourceLocale
  const slide = document.slides[index]
  const previous = {
    headline: layersOfRole(slide, 'heading')[0]?.content.map((span) => span.text).join('') ?? '',
    subheadline: layersOfRole(slide, 'subheading')[0]?.content.map((span) => span.text).join('') ?? '',
  }
  const write = (layers: StoreLayer[], role: TextRole, text: string): StoreLayer[] => {
    if (!text) return layers
    const existing = layers.find((layer): layer is TextLayer => layer.type === 'text' && layer.role === role)
    if (!existing) {
      const created = createTextLayer(role, suggestion.locale === source ? text : '')
      const layer = suggestion.locale === source ? created : setTranslation(created, suggestion.locale, plainRichText(text), 'draft', now)
      return [...layers, layer]
    }
    return layers.map((layer) => {
      if (layer.id !== existing.id || layer.type !== 'text') return layer
      return suggestion.locale === source
        ? { ...layer, content: plainRichText(text) }
        : setTranslation(layer, suggestion.locale, plainRichText(text), 'draft', now)
    })
  }
  const layers = write(write(slide.layers, 'heading', suggestion.headline), 'subheading', suggestion.subheadline)
  const slides = [...document.slides]
  slides[index] = { ...slide, layers }
  const keepPrevious =
    suggestion.locale === source && (previous.headline || previous.subheadline)
      ? [
          {
            id: newId(),
            slideId: slide.id,
            locale: source,
            headline: previous.headline,
            subheadline: previous.subheadline,
            tone: 'previous',
            createdAt: now,
            appliedAt: null,
          },
        ]
      : []
  return {
    ...document,
    slides,
    copySuggestions: [
      ...document.copySuggestions.map((item) => (item.id === suggestionId ? { ...item, appliedAt: now } : item)),
      ...keepPrevious,
    ].slice(-200),
  }
}

function applyInner(document: StoreDocument, command: Command, now: number): StoreDocument {
  switch (command.type) {
    case 'slides.add': {
      const room = MAX_PROJECT_SLIDES - document.slides.length
      if (room <= 0) return document
      const added = command.slides.slice(0, room)
      const index = Math.min(command.index ?? document.slides.length, document.slides.length)
      const slides = [...document.slides.slice(0, index), ...added, ...document.slides.slice(index)]
      const assets = { ...document.assets }
      command.assets.forEach((asset) => (assets[asset.id] = asset))
      return { ...document, slides, assets }
    }
    case 'slides.duplicate': {
      const wanted = new Set(command.slideIds)
      const room = MAX_PROJECT_SLIDES - document.slides.length
      let added = 0
      const slides = document.slides.flatMap((slide) => {
        if (!wanted.has(slide.id) || added >= room) return [slide]
        added += 1
        return [slide, cloneSlide(slide)]
      })
      return added === 0 ? document : { ...document, slides }
    }
    case 'slides.delete':
      return removeSlides(document, command.slideIds)
    case 'slides.move': {
      const order = document.slides.map((slide) => slide.id)
      const moving = new Set(command.slideIds)
      for (const panorama of document.panoramas) {
        if (panorama.slideIds.some((id) => moving.has(id))) panorama.slideIds.forEach((id) => moving.add(id))
      }
      const block = order.filter((id) => moving.has(id))
      const rest = order.filter((id) => !moving.has(id))
      const at = Math.max(0, Math.min(command.toIndex, rest.length))
      return withOrder(document, [...rest.slice(0, at), ...block, ...rest.slice(at)])
    }
    case 'slides.reorder':
      return withOrder(document, command.order)
    case 'slides.patch':
      return mapSlides(document, command.slideIds, (slide) => ({
        ...slide,
        ...(command.patch.name !== undefined ? { name: command.patch.name } : {}),
        ...(command.patch.background !== undefined
          ? { background: command.patch.background, backgroundSpan: null }
          : {}),
      }))
    case 'slides.setLayout': {
      let next = mapSlides(document, command.slideIds, (slide) =>
        slide.layout === command.layout ? slide : { ...slide, layout: command.layout }
      )
      for (const id of command.slideIds) {
        const index = slideIndex(next, id)
        if (index !== -1) next = ensureLayoutSlots(next, index)
      }
      return next
    }
    case 'slides.applyStyle': {
      const source = document.slides.find((slide) => slide.id === command.sourceSlideId)
      if (!source) return document
      let next = mapSlides(
        document,
        command.slideIds.filter((id) => id !== source.id),
        (slide) => applyStyle(source, slide, command.groups)
      )
      if (command.groups.includes('layout')) {
        for (const id of command.slideIds) {
          const index = slideIndex(next, id)
          if (index !== -1) next = ensureLayoutSlots(next, index)
        }
      }
      return next
    }
    case 'slides.patchText':
      return mapSlides(document, command.slideIds, (slide) => ({
        ...slide,
        layers: mapLayers(
          slide.layers,
          slide.layers.filter((layer) => layer.type === 'text' && command.roles.includes(layer.role)).map((layer) => layer.id),
          (layer) => patchLayer(layer, { style: command.style })
        ),
      }))
    case 'slides.patchDevices':
      return mapSlides(document, command.slideIds, (slide) => ({
        ...slide,
        layers: mapLayers(
          slide.layers,
          devicesOf(slide).map((layer) => layer.id),
          (layer) => patchLayer(layer, { frame: command.frame, transform: command.transform })
        ),
      }))
    case 'layers.add':
      return withLayers(document, command.owner, (layers) => {
        const valid = command.layers.filter((layer) => layerSchema.safeParse(layer).success)
        if (valid.length === 0) return layers
        const index = Math.min(command.index ?? layers.length, layers.length)
        return [...layers.slice(0, index), ...valid, ...layers.slice(index)]
      })
    case 'layers.patch':
      return withLayers(document, command.owner, (layers) =>
        mapLayers(layers, command.layerIds, (layer) => patchLayer(layer, command.patch))
      )
    case 'layers.setTransforms': {
      const ids = Object.keys(command.transforms)
      if (command.targetId && command.owner.kind === 'slide') {
        const targetId = command.targetId
        return mapSlides(document, [command.owner.id], (slide) => {
          const forTarget = { ...(slide.targetOverrides[targetId] ?? {}) }
          for (const id of ids) forTarget[id] = { ...(forTarget[id] ?? {}), ...command.transforms[id] }
          return { ...slide, targetOverrides: { ...slide.targetOverrides, [targetId]: forTarget } }
        })
      }
      return withLayers(document, command.owner, (layers) =>
        mapLayers(layers, ids, (layer) => patchLayer(layer, { transform: command.transforms[layer.id] }))
      )
    }
    case 'layers.duplicate':
      return withLayers(document, command.owner, (layers) => {
        const wanted = new Set(command.layerIds)
        const idMap = new Map(command.layerIds.map((id) => [id, newId()]))
        const groupMap = new Map<string, string>()
        return layers.flatMap((layer) => {
          if (!wanted.has(layer.id)) return [layer]
          const copy = cloneLayer(layer, idMap)
          copy.name = `${layer.name} copy`.slice(0, 80)
          if (copy.groupId) {
            if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, newId())
            copy.groupId = groupMap.get(copy.groupId)!
          }
          const placement = command.placements[layer.id]
          if (placement) copy.placement = placement
          else if (copy.placement.mode === 'free') {
            copy.placement = { ...copy.placement, x: copy.placement.x + 3, y: copy.placement.y + 2 }
          } else if (copy.type === 'text') {
            copy.placement = { mode: 'auto', slot: copy.placement.slot + 1 }
          }
          const valid = layerSchema.safeParse(copy)
          return valid.success ? [layer, valid.data] : [layer]
        })
      })
    case 'layers.delete':
      return withLayers(document, command.owner, (layers) => {
        const removed = new Set(command.layerIds)
        const next = layers.filter(
          (layer) => !removed.has(layer.id) && !(layer.type === 'callout' && removed.has(layer.deviceLayerId))
        )
        return next.length === layers.length ? layers : next
      })
    case 'layers.arrange':
      return withLayers(document, command.owner, (layers) => arrange(layers, command.layerIds, command.move))
    case 'layers.reorder':
      return withLayers(document, command.owner, (layers) => {
        const byId = new Map(layers.map((layer) => [layer.id, layer]))
        if (command.order.length !== layers.length || command.order.some((id) => !byId.has(id))) return layers
        return command.order.map((id) => byId.get(id)!)
      })
    case 'layers.group':
      return withLayers(document, command.owner, (layers) =>
        mapLayers(layers, command.layerIds, (layer) => ({ ...layer, groupId: command.groupId }))
      )
    case 'layers.ungroup':
      return withLayers(document, command.owner, (layers) => {
        const groups = new Set(
          layers.filter((layer) => command.layerIds.includes(layer.id) && layer.groupId).map((layer) => layer.groupId)
        )
        return mapLayers(
          layers,
          layers.filter((layer) => groups.has(layer.groupId)).map((layer) => layer.id),
          (layer) => ({ ...layer, groupId: null })
        )
      })
    case 'reset.devices':
      return withLayers(document, command.owner, (layers) =>
        mapLayers(
          layers,
          layers.filter((layer) => layer.type === 'device' && command.layerIds.includes(layer.id)).map((layer) => layer.id),
          (layer) => ({ ...layer, transform: { ...IDENTITY_TRANSFORM } })
        )
      )
    case 'reset.text':
      return withLayers(document, command.owner, (layers) =>
        mapLayers(
          layers,
          layers.filter((layer) => layer.type === 'text' && command.layerIds.includes(layer.id)).map((layer) => layer.id),
          (layer) => (layer.type === 'text' ? resetText(layer, command.scope) : layer)
        )
      )
    case 'reset.layer':
      return withLayers(document, command.owner, (layers) => mapLayers(layers, [command.layerId], resetLayer))
    case 'reset.slide': {
      let next = mapSlides(document, [command.slideId], (slide) => ({
        ...slide,
        layout: null,
        background: null,
        backgroundSpan: null,
        targetOverrides: {},
        layers: slide.layers.map(resetLayer),
      }))
      const index = slideIndex(next, command.slideId)
      if (index !== -1) next = ensureLayoutSlots(next, index)
      return next
    }
    case 'targetOverride.set':
      return mapSlides(document, [command.slideId], (slide) => {
        const forTarget = { ...(slide.targetOverrides[command.targetId] ?? {}) }
        if (command.transform === null) delete forTarget[command.layerId]
        else forTarget[command.layerId] = { ...(forTarget[command.layerId] ?? {}), ...command.transform }
        const targetOverrides = { ...slide.targetOverrides, [command.targetId]: forTarget }
        if (Object.keys(forTarget).length === 0) delete targetOverrides[command.targetId]
        return { ...slide, targetOverrides }
      })
    case 'theme.patch':
      return { ...document, theme: { ...document.theme, ...command.patch } }
    case 'theme.patchText': {
      const theme = {
        ...document.theme,
        textStyles: {
          ...document.theme.textStyles,
          [command.role]: { ...document.theme.textStyles[command.role], ...command.style },
        },
      }
      if (!command.clearOverrides) return { ...document, theme }
      const keys = Object.keys(command.style) as Array<keyof TextStyleOverrides>
      const clear = (layers: StoreLayer[]) =>
        layers.map((layer) =>
          layer.type === 'text' && layer.role === command.role ? { ...layer, style: omit(layer.style, keys) } : layer
        )
      return {
        ...document,
        theme,
        slides: document.slides.map((slide) => ({ ...slide, layers: clear(slide.layers) })),
        panoramas: document.panoramas.map((panorama) => ({ ...panorama, layers: clear(panorama.layers) })),
      }
    }
    case 'assets.add': {
      const assets = { ...document.assets }
      command.assets.forEach((asset) => (assets[asset.id] = asset))
      return { ...document, assets }
    }
    case 'assets.patch': {
      const asset = document.assets[command.assetId]
      if (!asset) return document
      return { ...document, assets: { ...document.assets, [asset.id]: { ...asset, ...command.patch } } }
    }
    case 'text.translate': {
      let next = document
      for (const entry of command.entries) {
        if (entry.locale === document.localization.sourceLocale) continue
        next = withLayers(next, { kind: 'slide', id: entry.slideId }, (layers) =>
          mapLayers(layers, [entry.layerId], (layer) =>
            layer.type === 'text' ? setTranslation(layer, entry.locale, entry.content, entry.status, now) : layer
          )
        )
      }
      return next
    }
    case 'text.setTranslationStatus':
      return withLayers(document, { kind: 'slide', id: command.slideId }, (layers) =>
        mapLayers(layers, [command.layerId], (layer) => {
          if (layer.type !== 'text') return layer
          const translation = layer.translations[command.locale]
          if (!translation) return layer
          const translations = { ...layer.translations }
          if (command.status === null) delete translations[command.locale]
          else {
            translations[command.locale] = {
              ...translation,
              status: command.status,
              sourceHash: command.status === 'approved' ? hashRichText(layer.content) : translation.sourceHash,
              updatedAt: now,
            }
          }
          return { ...layer, translations }
        })
      )
    case 'text.setLocaleOverride':
      return withLayers(document, { kind: 'slide', id: command.slideId }, (layers) =>
        mapLayers(layers, [command.layerId], (layer) => {
          if (layer.type !== 'text') return layer
          const current = layer.localeOverrides[command.locale] ?? { style: {}, offsetX: 0, offsetY: 0 }
          return {
            ...layer,
            localeOverrides: {
              ...layer.localeOverrides,
              [command.locale]: {
                style: command.style ? { ...current.style, ...command.style } : current.style,
                offsetX: command.offsetX ?? current.offsetX,
                offsetY: command.offsetY ?? current.offsetY,
              },
            },
          }
        })
      )
    case 'locales.set': {
      const locales = [...new Set(command.locales)].filter((locale) => locale !== document.localization.sourceLocale)
      return { ...document, localization: { ...document.localization, locales } }
    }
    case 'panorama.create': {
      const members = command.slideIds.filter((id) => slideIndex(document, id) !== -1)
      if (members.length < 2 || document.panoramas.some((panorama) => panorama.slideIds.some((id) => members.includes(id)))) {
        return document
      }
      const first = document.slides.find((slide) => slide.id === members[0])!
      const panorama: Panorama = {
        id: newId(),
        slideIds: members,
        background: structuredClone(first.background ?? document.theme.background),
        layers: [],
      }
      const next = mapSlides({ ...document, panoramas: [...document.panoramas, panorama] }, members, (slide) => ({
        ...slide,
        backgroundSpan: null,
      }))
      const byId = new Map(next.slides.map((slide) => [slide.id, slide]))
      const order = keepPanoramasTogether(next.slides.map((slide) => slide.id), next.panoramas)
      return { ...next, slides: order.map((id) => byId.get(id)!) }
    }
    case 'panorama.patch':
      return {
        ...document,
        panoramas: document.panoramas.map((panorama) =>
          panorama.id === command.panoramaId ? { ...panorama, background: command.background } : panorama
        ),
      }
    case 'panorama.detach': {
      const panorama = document.panoramas.find((item) => item.id === command.panoramaId)
      return panorama ? detachPanorama(document, panorama) : document
    }
    case 'panorama.remove':
      return { ...document, panoramas: document.panoramas.filter((item) => item.id !== command.panoramaId) }
    case 'project.patch': {
      const { animation, ...rest } = command.patch
      const next = {
        ...document,
        ...rest,
        ...(animation ? { animation: { ...document.animation, ...animation } } : {}),
      }
      return command.patch.templateId && command.patch.templateId !== document.templateId
        ? ensureAllLayoutSlots(next)
        : next
    }
    case 'copy.remember':
      return {
        ...document,
        copySuggestions: [
          ...document.copySuggestions,
          ...command.suggestions.map((item) => ({ ...item, createdAt: now, appliedAt: null })),
        ].slice(-200),
      }
    case 'copy.apply':
      return applyCopySuggestion(document, command.suggestionId, now)
    case 'template.apply':
      return ensureAllLayoutSlots(applyTemplateToDocument(document, command.template))
    case 'brandKit.apply':
      return applyBrandKit(document, command.kit, command.slideIds, command.parts)
  }
}

/** Apply a command. Returns the input unchanged when the command is a no-op. */
export function applyCommand(document: StoreDocument, command: Command, now = Date.now()): StoreDocument {
  const next = applyInner(document, command, now)
  return next === document ? document : { ...next, updatedAt: now }
}

/** Apply several commands as one step. */
export function applyCommands(document: StoreDocument, commands: Command[], now = Date.now()): StoreDocument {
  return commands.reduce((current, command) => applyCommand(current, command, now), document)
}
