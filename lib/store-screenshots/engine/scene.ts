import { z } from 'zod'
import {
  deviceGeometry,
  getDeviceFinish,
  getDeviceModel,
  type DeviceFinish,
  type DeviceGeometry,
  type DeviceModel,
} from '../devices'
import {
  REFERENCE_SLIDE_WIDTH,
  type AnnotationLayer,
  type Background,
  type CalloutLayer,
  type DeviceLayer,
  type ImageFilters,
  type ImageFraming,
  type LayerTransform,
  type LayoutId,
  type Panorama,
  type RichText,
  type StatusBar,
  type StoreDocument,
  type StoreLayer,
  type TextLayer,
  type TextRole,
  type TextStyle,
} from '../document/schema'
import type { PixelSize } from '../targets'
import {
  CONTRAST_LARGE,
  CONTRAST_NORMAL,
  isLargeText,
  parseHex,
  pickReadableColor,
  relativeLuminance,
  sampleBackground,
  worstContrast,
} from './color'
import { clamp, rectCenter, rotatedBounds, rotatePoint, type Point, type Rect } from './geometry'
import { getLayoutPreset, resolveLayoutId, type LayoutPreset } from './presets'
import {
  directionForLocale,
  hasVisibleText,
  localizedContent,
  resolveTextStyle,
  type TextDirection,
  type TextMeasurer,
  type TranslationState,
} from './text'

/**
 * Scene evaluation: the one place that turns a document into positioned,
 * fully resolved drawing instructions for a slide at a pixel size.
 *
 * The editor canvas, filmstrip, template and store previews, image export,
 * and animated frames all render a `Scene`, so what the user approves is what
 * is exported. Evaluation is pure: identical inputs give identical scenes.
 */

/** Aspect (height / width) the built-in layouts were designed at. */
export const REFERENCE_ASPECT = 2868 / REFERENCE_SLIDE_WIDTH

/** Scale at which stores show a screenshot in a product page, for legibility checks. */
export const STORE_PREVIEW_SCALE = 300 / REFERENCE_SLIDE_WIDTH

/** Minimum space between the copy block and devices, as a share of slide height. */
const COPY_DEVICE_GAP = 0.025

/** Top margin used when a slide has no copy, as a share of slide height. */
const EMPTY_COPY_MARGIN = 0.035

/** Step by which auto-fit shrinks type. */
const AUTO_FIT_STEP = 0.94

/** Why a layer is on the slide but not drawn. */
export const hiddenReasonSchema = z.enum(['hidden', 'layout', 'empty'])

/** Hidden reason. */
export type HiddenReason = z.infer<typeof hiddenReasonSchema>

/** Fields shared by every scene node. Boxes are in output pixels, before rotation. */
export type SceneNodeBase = {
  layerId: string
  name: string
  box: Rect
  rotation: number
  tiltX: number
  tiltY: number
  opacity: number
  locked: boolean
  groupId: string | null
  /** Belongs to a panorama group rather than this slide alone. */
  panorama: boolean
}

/** A resolved text block. */
export type SceneText = SceneNodeBase & {
  type: 'text'
  role: TextRole
  flow: boolean
  content: RichText
  style: TextStyle
  fontSizePx: number
  color: string
  autoColor: boolean
  /** Worst-case WCAG contrast against the background behind the text. */
  contrast: number
  /** Contrast the text needs at store preview scale. */
  requiredContrast: number
  lines: number
  /** The text needs more room than its box or line limit allows, even after auto-fit. */
  overflow: boolean
  /** Auto-fit reduced the size below the authored size. */
  shrunk: boolean
  /** Tight bounds of the glyphs, for overlap checks. */
  ink: Rect
  direction: TextDirection
  translation: TranslationState
}

/** A resolved device. */
export type SceneDevice = SceneNodeBase & {
  type: 'device'
  model: DeviceModel
  finish: DeviceFinish
  frame: DeviceLayer['frame']
  geometry: DeviceGeometry
  assetId: string | null
  imageAspect: number
  /** Screen rectangle inside the box, in pixels relative to the box. */
  screen: Rect
  /** Screenshot rectangle relative to the screen, in pixels. */
  image: Rect
  framing: ImageFraming
  filters: ImageFilters
  statusBar: StatusBar & { textColor: string; coverColor: string }
  shadow: number
  slot: number | null
}

/** A free image (logo, sticker). */
export type SceneImage = SceneNodeBase & { type: 'image'; assetId: string }

/** A resolved annotation. */
export type SceneAnnotation = SceneNodeBase & {
  type: 'annotation'
  annotation: Pick<
    AnnotationLayer,
    | 'kind'
    | 'text'
    | 'caption'
    | 'color'
    | 'fill'
    | 'textColor'
    | 'strokeWidth'
    | 'value'
    | 'curve'
    | 'shape'
  >
  /** Output pixels per reference pixel, for stroke and type sizes. */
  unit: number
}

/** A resolved magnified callout. */
export type SceneCallout = SceneNodeBase & {
  type: 'callout'
  callout: Pick<CalloutLayer, 'shape' | 'borderWidth' | 'borderColor' | 'shadow' | 'connector' | 'region'>
  sourceAssetId: string | null
  filters: ImageFilters
  /** Source image rectangle relative to the callout box, in pixels. */
  image: Rect
  /** Where the magnified region sits on the slide, for the connector line. */
  anchor: Point | null
  /** The region is outside the device's visible screen. */
  regionHidden: boolean
  unit: number
}

/** Any scene node. */
export type SceneNode = SceneText | SceneDevice | SceneImage | SceneAnnotation | SceneCallout

/** The background as painted on one slide. */
export type SceneBackground = {
  fill: Background
  /** Width of the painted area: the slide, or the whole panorama. */
  spanWidth: number
  /** Left offset of this slide inside the painted area. */
  offsetX: number
}

/** A fully evaluated slide. */
export type Scene = {
  slideId: string
  width: number
  height: number
  layoutId: LayoutId
  background: SceneBackground
  /** Paint order, bottom to top. */
  nodes: SceneNode[]
  hidden: Array<{ layerId: string; reason: HiddenReason }>
  /** Where the layout reserved space for copy, if anywhere. */
  copyRegion: Rect | null
  /** Margins text should stay inside. */
  safeArea: Rect
  /** Panorama position of this slide, if it belongs to one. */
  panorama: { id: string; index: number; count: number } | null
  locale: string
}

/** Inputs for evaluation. */
export type EvaluateOptions = {
  size: PixelSize
  /** Export target id, for target-specific overrides. */
  targetId: string
  locale: string
  measurer: TextMeasurer
}

type Context = {
  document: StoreDocument
  W: number
  H: number
  unit: number
  typeScale: number
  locale: string
  measurer: TextMeasurer
  overrides: Record<string, Partial<LayerTransform>>
  background: SceneBackground
}

/** Type scale for a target shape: wider slides get proportionally smaller type. */
export function typeScaleFor(size: PixelSize): number {
  return clamp(Math.sqrt(size.height / size.width / REFERENCE_ASPECT), 0.62, 1.15)
}

/**
 * Where a screenshot sits inside a screen. Matches CSS `object-fit` (cover
 * for fill, contain otherwise) followed by `translate(offset%) scale(s)`
 * about the screen centre.
 */
export function screenImageRect(
  screenWidth: number,
  screenHeight: number,
  imageAspect: number,
  framing: ImageFraming
): Rect {
  const screenAspect = screenWidth / screenHeight
  const cover = framing.mode === 'fill'
  const fitWidth = cover === imageAspect > screenAspect
  const baseWidth = fitWidth ? screenHeight * imageAspect : screenWidth
  const baseHeight = fitWidth ? screenHeight : screenWidth / imageAspect
  const scale = framing.mode === 'custom' ? framing.scale : 1
  const offsetX = framing.mode === 'custom' ? (framing.offsetX / 100) * screenWidth : 0
  const offsetY = framing.mode === 'custom' ? (framing.offsetY / 100) * screenHeight : 0
  const width = baseWidth * scale
  const height = baseHeight * scale
  return {
    x: (screenWidth - width) / 2 + offsetX,
    y: (screenHeight - height) / 2 + offsetY,
    width,
    height,
  }
}

function transformFor(context: Context, layer: StoreLayer): LayerTransform {
  return { ...layer.transform, ...context.overrides[layer.id] }
}

function nodeBase(layer: StoreLayer, box: Rect, transform: LayerTransform, rotation: number): SceneNodeBase {
  return {
    layerId: layer.id,
    name: layer.name,
    box,
    rotation,
    tiltX: transform.tiltX,
    tiltY: transform.tiltY,
    opacity: layer.opacity,
    locked: layer.locked,
    groupId: layer.groupId,
    panorama: false,
  }
}

function centeredBox(cx: number, cy: number, width: number, height: number): Rect {
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

function inkRect(box: Rect, measuredWidth: number, align: TextStyle['align']): Rect {
  const width = Math.min(box.width, measuredWidth)
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.width - width : box.x + (box.width - width) / 2
  return { x, y: box.y, width, height: box.height }
}

type MeasuredText = {
  layer: TextLayer
  content: RichText
  translation: TranslationState
  style: TextStyle
  fontSizePx: number
  baseSizePx: number
  minSizePx: number
  height: number
  width: number
  lines: number
}

function measureText(context: Context, item: MeasuredText, widthPx: number): MeasuredText {
  const result = context.measurer({
    content: item.content,
    style: item.style,
    fontSizePx: item.fontSizePx,
    widthPx,
    direction: directionForLocale(context.locale),
  })
  return { ...item, height: result.height, width: result.width, lines: result.lines }
}

function fitLines(context: Context, item: MeasuredText, widthPx: number): MeasuredText {
  let current = measureText(context, item, widthPx)
  if (!item.style.autoFit || item.style.maxLines === 0) return current
  while (current.lines > item.style.maxLines && current.fontSizePx > current.minSizePx) {
    current = measureText(
      context,
      { ...current, fontSizePx: Math.max(current.minSizePx, current.fontSizePx * AUTO_FIT_STEP) },
      widthPx
    )
  }
  return current
}

function prepareText(context: Context, layer: TextLayer, scale: number): MeasuredText | null {
  const { content, state } = localizedContent(
    layer,
    context.locale,
    context.document.localization.sourceLocale
  )
  if (!hasVisibleText(content)) return null
  const style = resolveTextStyle(layer, context.document.theme, context.locale)
  const transform = transformFor(context, layer)
  const factor = context.unit * context.typeScale * scale * transform.scale
  return {
    layer,
    content,
    translation: state,
    style,
    fontSizePx: style.fontSize * factor,
    baseSizePx: style.fontSize * factor,
    minSizePx: Math.min(style.fontSize, style.minFontSize) * factor,
    height: 0,
    width: 0,
    lines: 0,
  }
}

function textNode(
  context: Context,
  item: MeasuredText,
  box: Rect,
  flow: boolean,
  align: TextStyle['align'],
  overflow: boolean
): SceneText {
  const transform = transformFor(context, item.layer)
  const ink = inkRect(box, item.width, align)
  const samples = sampleBackground(
    context.background.fill,
    context.document.assets,
    { width: context.background.spanWidth, height: context.H },
    rotatedBounds(ink, transform.rotation),
    context.background.offsetX
  )
  const previewSize = (item.fontSizePx / context.unit) * STORE_PREVIEW_SCALE
  const requiredContrast = isLargeText(previewSize, item.style.fontWeight) ? CONTRAST_LARGE : CONTRAST_NORMAL
  const tone = item.layer.role === 'heading' ? 'strong' : 'muted'
  const auto = item.style.color === null
  const picked = auto ? pickReadableColor(samples, tone, requiredContrast) : null
  const color = picked?.color ?? item.style.color ?? '#111111'
  return {
    ...nodeBase(item.layer, box, transform, transform.rotation),
    type: 'text',
    role: item.layer.role,
    flow,
    content: item.content,
    style: { ...item.style, align },
    fontSizePx: item.fontSizePx,
    color,
    autoColor: auto,
    contrast: picked?.contrast ?? worstContrast(parseHex(color), samples),
    requiredContrast,
    lines: item.lines,
    overflow,
    shrunk: item.fontSizePx < item.baseSizePx - 0.5,
    ink,
    direction: directionForLocale(context.locale),
    translation: item.translation,
  }
}

type CopyLayout = { nodes: Map<string, SceneText>; region: Rect | null; bottom: number | null; top: number | null }

function layoutCopy(context: Context, preset: LayoutPreset, layers: TextLayer[]): CopyLayout {
  const { W, H } = context
  const columnWidth = (preset.copy.width / 100) * W
  const columnX = (preset.copy.x / 100) * W
  let items = layers
    .map((layer) => prepareText(context, layer, preset.copy.scale))
    .filter((item): item is MeasuredText => item !== null)
    .map((item) => fitLines(context, item, columnWidth))
  if (items.length === 0) return { nodes: new Map(), region: null, bottom: null, top: null }

  const gapBefore = (item: MeasuredText) => Math.max(0.016 * W, 0.35 * item.fontSizePx)
  const totalHeight = (list: MeasuredText[]) =>
    list.reduce((sum, item, index) => sum + item.height + (index > 0 ? gapBefore(item) : 0), 0)
  const maxHeight = (preset.copy.maxHeight / 100) * H
  while (
    totalHeight(items) > maxHeight &&
    items.some((item) => item.style.autoFit && item.fontSizePx > item.minSizePx)
  ) {
    items = items.map((item) =>
      item.style.autoFit && item.fontSizePx > item.minSizePx
        ? measureText(
            context,
            { ...item, fontSizePx: Math.max(item.minSizePx, item.fontSizePx * AUTO_FIT_STEP) },
            columnWidth
          )
        : item
    )
  }
  const copyHeight = totalHeight(items)
  const tooTall = copyHeight > maxHeight + 0.5
  const margin = (preset.copy.margin / 100) * H
  const top =
    preset.copy.anchor === 'top'
      ? margin
      : preset.copy.anchor === 'bottom'
        ? H - margin - copyHeight
        : (H - copyHeight) / 2

  const nodes = new Map<string, SceneText>()
  let y = top
  items.forEach((item, index) => {
    if (index > 0) y += gapBefore(item)
    const transform = transformFor(context, item.layer)
    const localeOffset = item.layer.localeOverrides[context.locale]
    const box: Rect = {
      x: columnX + ((transform.offsetX + (localeOffset?.offsetX ?? 0)) / 100) * W,
      y: y + ((transform.offsetY + (localeOffset?.offsetY ?? 0)) / 100) * H,
      width: columnWidth,
      height: item.height,
    }
    const align = item.layer.localeOverrides[context.locale]?.style.align ?? item.layer.style.align ?? preset.copy.align
    const lineOverflow = item.style.maxLines > 0 && item.lines > item.style.maxLines
    nodes.set(item.layer.id, textNode(context, item, box, true, align, tooTall || lineOverflow))
    y += item.height
  })
  return {
    nodes,
    region: { x: columnX, y: top, width: columnWidth, height: copyHeight },
    top,
    bottom: top + copyHeight,
  }
}

function freeTextNode(context: Context, layer: TextLayer): SceneText | null {
  if (layer.placement.mode !== 'free') return null
  const prepared = prepareText(context, layer, 1)
  if (!prepared) return null
  const width = (layer.placement.width / 100) * context.W
  const item = fitLines(context, prepared, width)
  const transform = transformFor(context, layer)
  const localeOffset = layer.localeOverrides[context.locale]
  const cx = ((layer.placement.x + transform.offsetX + (localeOffset?.offsetX ?? 0)) / 100) * context.W
  const cy = ((layer.placement.y + transform.offsetY + (localeOffset?.offsetY ?? 0)) / 100) * context.H
  const lineOverflow = item.style.maxLines > 0 && item.lines > item.style.maxLines
  return textNode(context, item, centeredBox(cx, cy, width, item.height), false, item.style.align, lineOverflow)
}

function imageAspectOf(context: Context, assetId: string | null, fallback: number): number {
  const asset = assetId ? context.document.assets[assetId] : undefined
  return asset ? asset.width / asset.height : fallback
}

function deviceNode(context: Context, layer: DeviceLayer, box: Rect, rotation: number, slot: number | null): SceneDevice {
  const model = getDeviceModel(layer.frame.modelId)
  const imageAspect = imageAspectOf(context, layer.assetId, model.screenAspect)
  const geometry = deviceGeometry(layer.frame, imageAspect)
  const screen: Rect = {
    x: geometry.screen.x * box.width,
    y: geometry.screen.y * box.height,
    width: geometry.screen.width * box.width,
    height: geometry.screen.height * box.height,
  }
  const asset = layer.assetId ? context.document.assets[layer.assetId] : undefined
  const topLuminance = relativeLuminance(parseHex(asset?.topColor ?? '#FFFFFF'))
  const appearance = layer.statusBar.appearance === 'auto' ? (topLuminance > 0.4 ? 'dark' : 'light') : layer.statusBar.appearance
  return {
    ...nodeBase(layer, box, transformFor(context, layer), rotation),
    type: 'device',
    model,
    finish: getDeviceFinish(model, layer.frame.finishId),
    frame: layer.frame,
    geometry,
    assetId: layer.assetId,
    imageAspect,
    screen,
    image: screenImageRect(screen.width, screen.height, imageAspect, layer.image),
    framing: layer.image,
    filters: layer.filters,
    statusBar: {
      ...layer.statusBar,
      visible: layer.statusBar.visible && model.statusBar && layer.frame.style !== 'screen-only',
      textColor: appearance === 'dark' ? '#000000' : '#FFFFFF',
      coverColor: asset?.topColor ?? '#000000',
    },
    shadow: context.document.theme.shadow,
    slot,
  }
}

function layoutDevices(
  context: Context,
  preset: LayoutPreset,
  devices: DeviceLayer[],
  copy: CopyLayout
): { nodes: Map<string, SceneDevice>; outOfLayout: string[] } {
  const { W, H } = context
  const nodes = new Map<string, SceneDevice>()
  const outOfLayout: string[] = []
  const gap = COPY_DEVICE_GAP * H
  const limitTop =
    preset.copy.anchor === 'top' && copy.bottom !== null ? copy.bottom + gap : EMPTY_COPY_MARGIN * H
  const limitBottom = preset.copy.anchor === 'bottom' && copy.top !== null ? copy.top - gap : null

  for (const layer of devices) {
    if (layer.placement.mode !== 'auto') continue
    const spec = preset.slots[layer.placement.slot]
    if (!spec) {
      outOfLayout.push(layer.id)
      continue
    }
    const model = getDeviceModel(layer.frame.modelId)
    const geometry = deviceGeometry(layer.frame, imageAspectOf(context, layer.assetId, model.screenAspect))
    let width = (spec.width / 100) * W
    let height = width / geometry.aspect
    let cx = (spec.x / 100) * W
    let cy = (spec.y / 100) * H
    let bounds = rotatedBounds(centeredBox(cx, cy, width, height), spec.rotation)
    if (bounds.y < limitTop) {
      cy += limitTop - bounds.y
      bounds = rotatedBounds(centeredBox(cx, cy, width, height), spec.rotation)
    }
    if (limitBottom !== null && bounds.y + bounds.height > limitBottom) {
      cy -= bounds.y + bounds.height - limitBottom
      bounds = rotatedBounds(centeredBox(cx, cy, width, height), spec.rotation)
    }
    const top = bounds.y
    const allowedHeight =
      limitBottom !== null ? limitBottom - Math.max(top, EMPTY_COPY_MARGIN * H) : (H - top) / (1 - spec.bleed)
    if (bounds.height > allowedHeight && allowedHeight > 0) {
      const factor = allowedHeight / bounds.height
      width *= factor
      height *= factor
      cy = (limitBottom !== null ? limitBottom - bounds.height * factor : top) + (bounds.height * factor) / 2
    }
    const transform = transformFor(context, layer)
    width *= transform.scale
    height *= transform.scale
    cx += (transform.offsetX / 100) * W
    cy += (transform.offsetY / 100) * H
    nodes.set(
      layer.id,
      deviceNode(context, layer, centeredBox(cx, cy, width, height), spec.rotation + transform.rotation, layer.placement.slot)
    )
  }
  return { nodes, outOfLayout }
}

function freeDeviceNode(context: Context, layer: DeviceLayer): SceneDevice | null {
  if (layer.placement.mode !== 'free') return null
  const model = getDeviceModel(layer.frame.modelId)
  const geometry = deviceGeometry(layer.frame, imageAspectOf(context, layer.assetId, model.screenAspect))
  const transform = transformFor(context, layer)
  const width = (layer.placement.width / 100) * context.W * transform.scale
  const height = width / geometry.aspect
  const cx = ((layer.placement.x + transform.offsetX) / 100) * context.W
  const cy = ((layer.placement.y + transform.offsetY) / 100) * context.H
  return deviceNode(context, layer, centeredBox(cx, cy, width, height), transform.rotation, null)
}

/** Map a point in a device's screenshot (0-1 coordinates) to slide pixels. */
export function deviceImagePointToSlide(device: SceneDevice, u: number, v: number): Point {
  const local = {
    x: device.box.x + device.screen.x + device.image.x + u * device.image.width,
    y: device.box.y + device.screen.y + device.image.y + v * device.image.height,
  }
  return rotatePoint(local, rectCenter(device.box), device.rotation)
}

/** Map a slide point to the screenshot's 0-1 coordinates under a device. */
export function slidePointToDeviceImage(device: SceneDevice, point: Point): Point {
  const local = rotatePoint(point, rectCenter(device.box), -device.rotation)
  return {
    x: (local.x - device.box.x - device.screen.x - device.image.x) / device.image.width,
    y: (local.y - device.box.y - device.screen.y - device.image.y) / device.image.height,
  }
}

function calloutNode(context: Context, layer: CalloutLayer, devices: Map<string, SceneDevice>): SceneCallout {
  const transform = transformFor(context, layer)
  const source = devices.get(layer.deviceLayerId) ?? null
  const asset = source?.assetId ? context.document.assets[source.assetId] : undefined
  const imageWidth = asset?.width ?? 1
  const imageHeight = asset?.height ?? 1
  const regionAspect = (layer.region.width * imageWidth) / (layer.region.height * imageHeight)
  const width = (layer.placement.width / 100) * context.W * transform.scale
  const height = layer.shape === 'rounded' ? width / regionAspect : width
  const cx = ((layer.placement.x + transform.offsetX) / 100) * context.W
  const cy = ((layer.placement.y + transform.offsetY) / 100) * context.H
  const box = centeredBox(cx, cy, width, height)
  const scale = Math.max(width / (layer.region.width * imageWidth), height / (layer.region.height * imageHeight))
  const drawnWidth = imageWidth * scale
  const drawnHeight = imageHeight * scale
  const regionCenter = { x: layer.region.x + layer.region.width / 2, y: layer.region.y + layer.region.height / 2 }
  const image: Rect = {
    x: width / 2 - regionCenter.x * drawnWidth,
    y: height / 2 - regionCenter.y * drawnHeight,
    width: drawnWidth,
    height: drawnHeight,
  }
  let anchor: Point | null = null
  let regionHidden = source === null
  if (source) {
    anchor = deviceImagePointToSlide(source, regionCenter.x, regionCenter.y)
    const onScreen = {
      x: source.image.x + regionCenter.x * source.image.width,
      y: source.image.y + regionCenter.y * source.image.height,
    }
    regionHidden =
      onScreen.x < 0 || onScreen.y < 0 || onScreen.x > source.screen.width || onScreen.y > source.screen.height
  }
  return {
    ...nodeBase(layer, box, transform, transform.rotation),
    type: 'callout',
    callout: {
      shape: layer.shape,
      borderWidth: layer.borderWidth,
      borderColor: layer.borderColor,
      shadow: layer.shadow,
      connector: layer.connector,
      region: layer.region,
    },
    sourceAssetId: source?.assetId ?? null,
    filters: source?.filters ?? { brightness: 100, contrast: 100, saturation: 100 },
    image,
    anchor,
    regionHidden,
    unit: context.unit,
  }
}

function freeNode(context: Context, layer: StoreLayer): SceneImage | SceneAnnotation | null {
  const transform = transformFor(context, layer)
  if (layer.type === 'image') {
    const aspect = imageAspectOf(context, layer.assetId, 1)
    const width = (layer.placement.width / 100) * context.W * transform.scale
    const cx = ((layer.placement.x + transform.offsetX) / 100) * context.W
    const cy = ((layer.placement.y + transform.offsetY) / 100) * context.H
    return {
      ...nodeBase(layer, centeredBox(cx, cy, width, width / aspect), transform, transform.rotation),
      type: 'image',
      assetId: layer.assetId,
    }
  }
  if (layer.type === 'annotation') {
    const width = (layer.placement.width / 100) * context.W * transform.scale
    const height = (layer.height / 100) * context.H * transform.scale
    const cx = ((layer.placement.x + transform.offsetX) / 100) * context.W
    const cy = ((layer.placement.y + transform.offsetY) / 100) * context.H
    return {
      ...nodeBase(layer, centeredBox(cx, cy, width, height), transform, transform.rotation),
      type: 'annotation',
      annotation: {
        kind: layer.kind,
        text: layer.text,
        caption: layer.caption,
        color: layer.color,
        fill: layer.fill,
        textColor: layer.textColor,
        strokeWidth: layer.strokeWidth,
        value: layer.value,
        curve: layer.curve,
        shape: layer.shape,
      },
      unit: context.unit * transform.scale,
    }
  }
  return null
}

/** The panorama a slide belongs to, and its position in it. */
export function panoramaFor(
  document: StoreDocument,
  slideId: string
): { panorama: Panorama; index: number } | null {
  for (const panorama of document.panoramas) {
    const index = panorama.slideIds.indexOf(slideId)
    if (index !== -1) return { panorama, index }
  }
  return null
}

function evaluateLayers(
  context: Context,
  preset: LayoutPreset,
  layers: StoreLayer[],
  panoramaLayers: boolean
): { nodes: SceneNode[]; hidden: Scene['hidden']; copy: CopyLayout } {
  const hidden: Scene['hidden'] = []
  const visible = layers.filter((layer) => {
    if (!layer.hidden) return true
    hidden.push({ layerId: layer.id, reason: 'hidden' })
    return false
  })
  const flowText = panoramaLayers
    ? []
    : visible
        .filter((layer): layer is TextLayer => layer.type === 'text' && layer.placement.mode === 'auto')
        .map((layer, order) => ({ layer, order, slot: layer.placement.mode === 'auto' ? layer.placement.slot : 0 }))
        .sort((a, b) => a.slot - b.slot || a.order - b.order)
        .map(({ layer }) => layer)
  const copy = layoutCopy(context, preset, flowText)
  const autoDevices = panoramaLayers
    ? []
    : visible.filter((layer): layer is DeviceLayer => layer.type === 'device' && layer.placement.mode === 'auto')
  const devices = layoutDevices(context, preset, autoDevices, copy)
  devices.outOfLayout.forEach((layerId) => hidden.push({ layerId, reason: 'layout' }))

  const deviceNodes = new Map(devices.nodes)
  for (const layer of visible) {
    if (layer.type !== 'device' || layer.placement.mode !== 'free') continue
    const node = freeDeviceNode(context, layer)
    if (node) deviceNodes.set(layer.id, node)
  }

  const nodes: SceneNode[] = []
  for (const layer of visible) {
    let node: SceneNode | null = null
    if (layer.type === 'text') {
      node = layer.placement.mode === 'auto' ? (copy.nodes.get(layer.id) ?? null) : freeTextNode(context, layer)
      if (!node) hidden.push({ layerId: layer.id, reason: 'empty' })
    } else if (layer.type === 'device') {
      node = deviceNodes.get(layer.id) ?? null
    } else if (layer.type === 'callout') {
      node = calloutNode(context, layer, deviceNodes)
    } else {
      node = freeNode(context, layer)
    }
    if (node) nodes.push(panoramaLayers ? { ...node, panorama: true } : node)
  }
  return { nodes, hidden, copy }
}

function shiftNode(node: SceneNode, dx: number): SceneNode {
  const box = { ...node.box, x: node.box.x + dx }
  if (node.type === 'text') return { ...node, box, ink: { ...node.ink, x: node.ink.x + dx } }
  if (node.type === 'callout' && node.anchor) return { ...node, box, anchor: { x: node.anchor.x + dx, y: node.anchor.y } }
  return { ...node, box }
}

/** Evaluate one slide at a pixel size. */
export function evaluateSlide(document: StoreDocument, slideIndex: number, options: EvaluateOptions): Scene {
  const slide = document.slides[slideIndex]
  if (!slide) throw new RangeError(`No slide at index ${slideIndex}`)
  const { width: W, height: H } = options.size
  const layoutId = resolveLayoutId(document, slideIndex)
  const preset = getLayoutPreset(layoutId)
  const membership = panoramaFor(document, slide.id)
  const background: SceneBackground = membership
    ? {
        fill: membership.panorama.background,
        spanWidth: W * membership.panorama.slideIds.length,
        offsetX: W * membership.index,
      }
    : slide.backgroundSpan
      ? {
          fill: slide.background ?? document.theme.background,
          spanWidth: W * slide.backgroundSpan.count,
          offsetX: W * slide.backgroundSpan.index,
        }
      : { fill: slide.background ?? document.theme.background, spanWidth: W, offsetX: 0 }
  const context: Context = {
    document,
    W,
    H,
    unit: W / REFERENCE_SLIDE_WIDTH,
    typeScale: typeScaleFor(options.size),
    locale: options.locale,
    measurer: options.measurer,
    overrides: slide.targetOverrides[options.targetId] ?? {},
    background,
  }

  const nodes: SceneNode[] = []
  const hidden: Scene['hidden'] = []
  if (membership) {
    const span = membership.panorama.slideIds.length
    const panoramaContext: Context = { ...context, W: W * span, overrides: {}, background: { ...background, offsetX: 0 } }
    const evaluated = evaluateLayers(panoramaContext, preset, membership.panorama.layers, true)
    const offset = -W * membership.index
    for (const node of evaluated.nodes) {
      const shifted = shiftNode(node, offset)
      const bounds = rotatedBounds(shifted.box, shifted.rotation)
      if (bounds.x + bounds.width > 0 && bounds.x < W) nodes.push(shifted)
    }
  }
  const evaluated = evaluateLayers(context, preset, slide.layers, false)
  nodes.push(...evaluated.nodes)
  hidden.push(...evaluated.hidden)

  return {
    slideId: slide.id,
    width: W,
    height: H,
    layoutId,
    background,
    nodes,
    hidden,
    copyRegion: evaluated.copy.region,
    safeArea: { x: W * 0.04, y: H * 0.025, width: W * 0.92, height: H * 0.95 },
    panorama: membership
      ? { id: membership.panorama.id, index: membership.index, count: membership.panorama.slideIds.length }
      : null,
    locale: options.locale,
  }
}
