import { defaultDeviceFrame } from '../devices'
import { DEFAULT_FONT_FAMILY } from '../fonts'
import {
  STORE_DOCUMENT_VERSION,
  type AnimationSettings,
  type Background,
  type DeviceFrame,
  type DeviceLayer,
  type ImageFilters,
  type ImageFraming,
  type LayerTransform,
  type LayoutId,
  type RichText,
  type StatusBar,
  type StoreAsset,
  type StoreDocument,
  type StoreLayer,
  type StoreSlideV2,
  type TextLayer,
  type TextRole,
  type TextStyle,
  type Theme,
} from './schema'

/** A new random identifier. */
export function newId(): string {
  return crypto.randomUUID()
}

/** The identity transform. */
export const IDENTITY_TRANSFORM: LayerTransform = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  tiltX: 0,
  tiltY: 0,
})

/** Screenshot framing that fills the screen edge to edge. */
export const DEFAULT_IMAGE_FRAMING: ImageFraming = Object.freeze({
  mode: 'fill',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
})

/** Neutral screenshot filters. */
export const DEFAULT_IMAGE_FILTERS: ImageFilters = Object.freeze({
  brightness: 100,
  contrast: 100,
  saturation: 100,
})

/**
 * A hidden status bar at the conventional 9:41. It is off by default so a
 * screenshot that already has a status bar is never covered without consent.
 */
export const DEFAULT_STATUS_BAR: StatusBar = Object.freeze({
  visible: false,
  time: '9:41',
  battery: 100,
  signal: 4,
  wifi: 3,
  carrier: '',
  appearance: 'auto',
  cover: true,
})

/** Default typography for each role. Colors are automatic (contrast aware). */
export const DEFAULT_TEXT_STYLES: Record<TextRole, TextStyle> = Object.freeze({
  heading: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 96,
    fontWeight: 600,
    lineHeight: 1.05,
    letterSpacing: -0.035,
    align: 'center',
    verticalAlign: 'top',
    color: null,
    italic: false,
    uppercase: false,
    autoFit: true,
    minFontSize: 56,
    maxLines: 3,
    wrap: true,
  },
  subheading: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 43,
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: -0.01,
    align: 'center',
    verticalAlign: 'top',
    color: null,
    italic: false,
    uppercase: false,
    autoFit: true,
    minFontSize: 30,
    maxLines: 3,
    wrap: true,
  },
  body: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 40,
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: -0.01,
    align: 'center',
    verticalAlign: 'top',
    color: null,
    italic: false,
    uppercase: false,
    autoFit: false,
    minFontSize: 28,
    maxLines: 0,
    wrap: true,
  },
})

/** Default animated preview settings. */
export const DEFAULT_ANIMATION: AnimationSettings = Object.freeze({
  slideDuration: 2.5,
  slideDurations: {},
  transition: 'slide',
  transitionDuration: 0.5,
  kenBurns: 0.04,
  textReveal: 'rise',
  deviceMotion: 'rise',
  fps: 30,
})

/** The default project theme. */
export function createDefaultTheme(): Theme {
  return {
    background: { kind: 'linear', from: '#FAFAFA', to: '#F3D7F7', angle: 180 },
    textStyles: structuredClone(DEFAULT_TEXT_STYLES),
    deviceFrame: defaultDeviceFrame(),
    shadow: 35,
    palette: ['#111111', '#FFFFFF', '#6D28D9', '#F43F5E', '#0EA5E9', '#22C55E'],
  }
}

/** Display names for text roles. */
export const TEXT_ROLE_LABELS: Record<TextRole, string> = {
  heading: 'Heading',
  subheading: 'Subheading',
  body: 'Text',
}

/** Flow order of a text role: headings first, then subheadings, then body text. */
export function defaultTextSlot(role: TextRole): number {
  return role === 'heading' ? 0 : role === 'subheading' ? 1 : 2
}

/** Plain text as rich text. */
export function plainRichText(text: string): RichText {
  return [{ text }]
}

/** A new text layer that joins the layout's copy flow. */
export function createTextLayer(
  role: TextRole,
  text: string,
  overrides: Partial<Omit<TextLayer, 'type' | 'role'>> = {}
): TextLayer {
  return {
    id: newId(),
    name: TEXT_ROLE_LABELS[role],
    hidden: false,
    locked: false,
    groupId: null,
    opacity: 1,
    transform: { ...IDENTITY_TRANSFORM },
    type: 'text',
    role,
    placement: { mode: 'auto', slot: defaultTextSlot(role) },
    content: plainRichText(text),
    style: {},
    translations: {},
    localeOverrides: {},
    ...overrides,
  }
}

/** A new device layer bound to a layout slot. */
export function createDeviceLayer(
  assetId: string | null,
  slot = 0,
  frame: DeviceFrame = defaultDeviceFrame(),
  overrides: Partial<Omit<DeviceLayer, 'type'>> = {}
): DeviceLayer {
  return {
    id: newId(),
    name: slot === 0 ? 'Device' : `Device ${slot + 1}`,
    hidden: false,
    locked: false,
    groupId: null,
    opacity: 1,
    transform: { ...IDENTITY_TRANSFORM },
    type: 'device',
    placement: { mode: 'auto', slot },
    assetId,
    frame: { ...frame },
    image: { ...DEFAULT_IMAGE_FRAMING },
    filters: { ...DEFAULT_IMAGE_FILTERS },
    statusBar: { ...DEFAULT_STATUS_BAR },
    ...overrides,
  }
}

/** A new slide. Layers are bottom to top. */
export function createSlide({
  name,
  layers,
  background = null,
  layout = null,
}: {
  name: string
  layers: StoreLayer[]
  background?: Background | null
  layout?: LayoutId | null
}): StoreSlideV2 {
  return { id: newId(), name, layout, background, backgroundSpan: null, layers, targetOverrides: {} }
}

/**
 * A standard slide: one device showing `assetId` with a heading (and a
 * subheading when given) above it.
 */
export function createStandardSlide(
  name: string,
  assetId: string | null,
  heading: string,
  subheading = '',
  frame?: DeviceFrame
): StoreSlideV2 {
  const layers: StoreLayer[] = [createDeviceLayer(assetId, 0, frame)]
  if (heading) layers.push(createTextLayer('heading', heading))
  if (subheading) layers.push(createTextLayer('subheading', subheading))
  return createSlide({ name, layers })
}

/** Metadata for an asset whose analysis is not available yet. */
export function createAssetMeta(input: {
  id?: string
  name: string
  mime: string
  width: number
  height: number
  bytes: number
  src?: string | null
  colorGrid?: string[]
  topColor?: string
}): StoreAsset {
  return {
    id: input.id ?? newId(),
    name: input.name,
    mime: input.mime,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    bytes: input.bytes,
    src: input.src ?? null,
    colorGrid: input.colorGrid ?? [],
    topColor: input.topColor ?? '#FFFFFF',
  }
}

/** A new project document. */
export function createDocument({
  name,
  slides,
  assets = {},
  theme = createDefaultTheme(),
  templateId = 'classic',
}: {
  name: string
  slides: StoreSlideV2[]
  assets?: Record<string, StoreAsset>
  theme?: Theme
  templateId?: string
}): StoreDocument {
  const now = Date.now()
  return {
    version: STORE_DOCUMENT_VERSION,
    id: newId(),
    name,
    templateId,
    theme,
    assets,
    slides,
    panoramas: [],
    localization: { sourceLocale: 'en-US', locales: [] },
    animation: structuredClone(DEFAULT_ANIMATION),
    fonts: [],
    brandKitId: null,
    copySuggestions: [],
    productBrief: '',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }
}

/** Bundled sample screens used by the starter template. */
export const STARTER_SCREENS = [
  { src: '/store-screenshot-create.png', name: 'Prepare', heading: 'Prepare for your\nnext challenge', to: '#E8DDF5', angle: 168 },
  { src: '/store-screenshot-learn.png', name: 'Learn', heading: 'Go deep\nand learn', to: '#CDEAF4', angle: 178 },
  { src: '/store-screenshot-voice.png', name: 'Voice', heading: 'Chat in\nvoice mode', to: '#EED8F1', angle: 186 },
  { src: '/store-screenshot-write.png', name: 'Reimagine', heading: 'Reimagine\nany photo', to: '#C7EAF3', angle: 180 },
  { src: '/store-screenshot-ideas.png', name: 'Ideas', heading: 'See your ideas\ncome to life', to: '#EBD9E8', angle: 158 },
  { src: '/store-screenshot-butterfly.png', name: 'Discover', heading: 'Learn anything\nyour way', to: '#D8E5F5', angle: 198 },
  { src: '/store-screenshot-writing.png', name: 'Writing', heading: 'Get writing that\nsounds like you', to: '#F0D5ED', angle: 182 },
  { src: '/store-screenshot-inspiration.png', name: 'Inspiration', heading: 'Find creative\ninspiration', to: '#C2E8F3', angle: 176 },
] as const

/** Native size of the bundled sample screens. */
export const STARTER_SCREEN_SIZE = { width: 337, height: 727 } as const

/** Asset metadata for a bundled public image. */
export function publicAsset(src: string, name: string): StoreAsset {
  return createAssetMeta({
    id: `public:${src}`,
    name,
    mime: 'image/png',
    width: STARTER_SCREEN_SIZE.width,
    height: STARTER_SCREEN_SIZE.height,
    bytes: 0,
    src,
    colorGrid: [],
    topColor: '#FFFFFF',
  })
}

/** The eight-slide starter set shown to first-time visitors. */
export function createStarterDocument(): StoreDocument {
  const assets: Record<string, StoreAsset> = {}
  const slides = STARTER_SCREENS.map((screen) => {
    const asset = publicAsset(screen.src, screen.name)
    assets[asset.id] = asset
    const slide = createStandardSlide(screen.name, asset.id, screen.heading)
    slide.background = { kind: 'linear', from: '#FAFAFA', to: screen.to, angle: screen.angle }
    return slide
  })
  return createDocument({ name: 'Starter set', slides, assets })
}

/** A one-slide project to start from scratch. */
export function createScratchDocument(): StoreDocument {
  const screen = STARTER_SCREENS[0]
  const asset = publicAsset(screen.src, 'Screenshot 1')
  const slide = createStandardSlide('Screenshot 1', asset.id, screen.heading)
  return createDocument({ name: 'Untitled set', slides: [slide], assets: { [asset.id]: asset } })
}

/**
 * A stable fingerprint of rich text (FNV-1a over its canonical JSON). A
 * translation stores the fingerprint of the source it was made from.
 */
export function hashRichText(content: RichText): string {
  const input = JSON.stringify(
    content.map((span) => [
      span.text,
      span.bold ?? false,
      span.italic ?? false,
      span.color ?? '',
      span.highlight ?? '',
      span.gradient ? `${span.gradient.from}${span.gradient.to}` : '',
      span.decoration ?? 'none',
    ])
  )
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Plain text of rich text. */
export function richTextToPlain(content: RichText): string {
  return content.map((span) => span.text).join('')
}
