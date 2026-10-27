import { defaultDeviceFrame } from '../devices'
import { normalizeStoreProject } from '../project'
import { resolveStoreLayout } from '../layouts'
import type {
  StoreDeviceStyle as V1DeviceStyle,
  StoreProject as V1Project,
  StoreSlide as V1Slide,
} from '../types'
import {
  createAssetMeta,
  createDefaultTheme,
  createDeviceLayer,
  createDocument,
  createTextLayer,
  DEFAULT_STATUS_BAR,
  IDENTITY_TRANSFORM,
  newId,
  publicAsset,
  STARTER_SCREENS,
} from './factory'
import {
  STORE_DOCUMENT_VERSION,
  storeDocumentSchema,
  type Background,
  type DeviceFrame,
  type StoreAsset,
  type StoreDocument,
  type StoreLayer,
  type StoreSlideV2,
  type TextStyleOverrides,
} from './schema'

/**
 * Upgrades stored documents to the current schema.
 *
 * Version 1 kept image bytes inline as data URLs on each slide and modeled a
 * slide as fixed fields (headline, subhead, up to two devices, extra texts,
 * one overlay). Version 2 moves image bytes into project assets and models a
 * slide as an ordered layer list. The conversion is lossless for everything
 * version 1 could express; see `docs/store-screenshots.md` for the mapping.
 */

/** An image that must be copied into the asset store after migration. */
export type PendingAsset = { assetId: string; src: string; name: string }

/** Result of reading a stored document. */
export type MigrationResult = {
  document: StoreDocument
  /** Assets whose bytes or measurements still need to be ingested. */
  pendingAssets: PendingAsset[]
  /** The version the stored document had. */
  fromVersion: number
}

/** Version 1 sizes were container-query percentages of the slide width. */
const V1_UNIT_TO_PX = 13.2

/** Version 1 template default text colors, treated as automatic in version 2. */
const V1_DEFAULT_TEXT_COLORS = new Set(['#ffffff', '#111111', '#e4e4e7', '#52525b'])

const STARTER_NAME_BY_SRC = new Map<string, string>(
  STARTER_SCREENS.map((screen) => [screen.src, screen.name])
)

function v1Frame(style: V1DeviceStyle): DeviceFrame {
  return style === 'screen-only'
    ? { ...defaultDeviceFrame(), style: 'screen-only' }
    : defaultDeviceFrame()
}

function v1Background(
  slide: V1Slide,
  assetFor: (src: string, name: string) => string
): Background | null {
  if (slide.backgroundImageOverride) {
    return {
      kind: 'image',
      assetId: assetFor(slide.backgroundImageOverride.src, slide.backgroundImageOverride.name),
      fit: 'cover',
      focusX: 50,
      focusY: 50,
      color: slide.backgroundOverride?.from ?? '#000000',
    }
  }
  if (!slide.backgroundOverride) return null
  const { from, to, angle } = slide.backgroundOverride
  return from.toLowerCase() === to.toLowerCase()
    ? { kind: 'solid', color: from }
    : { kind: 'linear', from, to, angle }
}

function themeColor(value: string): string | null {
  return V1_DEFAULT_TEXT_COLORS.has(value.toLowerCase()) ? null : value
}

/** Convert a normalized version 1 project. Pure: no I/O. */
export function migrateV1Project(project: V1Project): MigrationResult {
  const pendingAssets: PendingAsset[] = []
  const assets: Record<string, StoreAsset> = {}
  const assetIdBySrc = new Map<string, string>()

  const assetFor = (src: string, name: string): string => {
    const existing = assetIdBySrc.get(src)
    if (existing) return existing
    const starterName = STARTER_NAME_BY_SRC.get(src)
    if (starterName) {
      const asset = publicAsset(src, starterName)
      assets[asset.id] = asset
      assetIdBySrc.set(src, asset.id)
      return asset.id
    }
    const asset = createAssetMeta({
      name: name || 'Image',
      mime: /^data:([^;,]+)/.exec(src)?.[1] ?? 'image/png',
      width: 1290,
      height: 2796,
      bytes: 0,
      src: src.startsWith('data:') ? null : src,
    })
    assets[asset.id] = asset
    assetIdBySrc.set(src, asset.id)
    pendingAssets.push({ assetId: asset.id, src, name: asset.name })
    return asset.id
  }

  const theme = createDefaultTheme()
  const v1Theme = project.theme
  theme.background =
    v1Theme.background.from.toLowerCase() === v1Theme.background.to.toLowerCase()
      ? { kind: 'solid', color: v1Theme.background.from }
      : { kind: 'linear', ...v1Theme.background }
  theme.textStyles.heading.fontFamily = v1Theme.fontFamily
  theme.textStyles.subheading.fontFamily = v1Theme.fontFamily
  theme.textStyles.body.fontFamily = v1Theme.fontFamily
  theme.textStyles.heading.color = themeColor(v1Theme.headlineColor)
  theme.textStyles.subheading.color = themeColor(v1Theme.subheadColor)
  theme.textStyles.body.color = themeColor(v1Theme.subheadColor)
  theme.deviceFrame = v1Frame(v1Theme.deviceStyle)
  theme.shadow = v1Theme.shadow

  const v1Slides = project.slides
  const slides: StoreSlideV2[] = v1Slides.map((slide, index) => {
    const layoutId = resolveStoreLayout(project.templateId, index, slide.layoutOverride)
    const isDuo = layoutId === 'duo'
    const byId = (id: string | null): V1Slide | undefined =>
      id ? v1Slides.find((candidate) => candidate.id === id) : undefined
    const primarySource = isDuo ? (byId(slide.duoLeftSlideId) ?? slide) : slide
    const secondarySource = byId(slide.duoRightSlideId) ?? v1Slides[(index + 1) % v1Slides.length]
    const layers: StoreLayer[] = []

    const deviceFrom = (
      source: V1Slide,
      slot: number,
      styleOverride: V1DeviceStyle | null,
      transform: V1Slide['device']
    ): StoreLayer =>
      createDeviceLayer(
        source.src ? assetFor(source.src, source.name) : null,
        slot,
        styleOverride ? v1Frame(styleOverride) : { ...theme.deviceFrame },
        {
          name: isDuo ? (slot === 0 ? 'Left device' : 'Right device') : 'Device',
          image: { ...source.image },
          filters: { ...source.filters },
          statusBar: { ...DEFAULT_STATUS_BAR },
          transform: {
            offsetX: transform.offsetX,
            offsetY: transform.offsetY,
            scale: transform.scale,
            rotation: transform.rotation,
            tiltX: transform.rotateX,
            tiltY: transform.rotateY,
          },
        }
      )

    layers.push(deviceFrom(primarySource, 0, slide.deviceStyleOverride, slide.device))
    if (isDuo) {
      layers.push(
        deviceFrom(secondarySource, 1, slide.secondaryDeviceStyleOverride, slide.secondaryDevice)
      )
    }

    if (slide.headline) {
      const style: TextStyleOverrides = {}
      if (slide.headlineColorOverride) style.color = slide.headlineColorOverride
      layers.push(
        createTextLayer('heading', slide.headline, {
          style,
          transform: {
            ...IDENTITY_TRANSFORM,
            offsetX: slide.copyPosition.offsetX + slide.headingOffset.x,
            offsetY: slide.copyPosition.offsetY + slide.headingOffset.y,
          },
        })
      )
    }
    if (slide.subhead) {
      const style: TextStyleOverrides = {}
      if (slide.subheadColorOverride) style.color = slide.subheadColorOverride
      layers.push(
        createTextLayer('subheading', slide.subhead, {
          style,
          transform: {
            ...IDENTITY_TRANSFORM,
            offsetX: slide.copyPosition.offsetX + slide.subheadingOffset.x,
            offsetY: slide.copyPosition.offsetY + slide.subheadingOffset.y,
          },
        })
      )
    }
    slide.extraTexts.forEach((text, textIndex) => {
      const role = text.kind === 'heading' ? 'heading' : 'subheading'
      const style: TextStyleOverrides = {
        fontSize: Math.round(text.fontSize * V1_UNIT_TO_PX),
        fontWeight: text.bold ? 700 : role === 'heading' ? 600 : 500,
        italic: text.italic,
        autoFit: false,
      }
      if (text.color) style.color = text.color
      layers.push(
        createTextLayer(role, text.text, {
          name: `Text ${textIndex + 1}`,
          placement: { mode: 'free', x: text.x, y: text.y, width: 84 },
          style,
        })
      )
    })
    if (slide.overlay) {
      layers.push({
        id: newId(),
        name: slide.overlay.name || 'Overlay',
        hidden: false,
        locked: false,
        groupId: null,
        opacity: slide.overlay.opacity,
        transform: { ...IDENTITY_TRANSFORM },
        type: 'image',
        placement: {
          mode: 'free',
          x: slide.overlay.x,
          y: slide.overlay.y,
          width: slide.overlay.size,
        },
        assetId: assetFor(slide.overlay.src, slide.overlay.name),
      })
    }

    return {
      id: slide.id,
      name: slide.name.replace(/\.[^/.]+$/, '').slice(0, 80) || `Screenshot ${index + 1}`,
      layout: slide.layoutOverride,
      background: v1Background(slide, assetFor),
      backgroundSpan: null,
      layers,
      targetOverrides: {},
    }
  })

  const document = createDocument({
    name: 'My screenshot set',
    slides,
    assets,
    theme,
    templateId: project.templateId,
  })
  document.createdAt = project.createdAt
  document.updatedAt = project.updatedAt
  return { document, pendingAssets, fromVersion: 1 }
}

/** Why a stored document could not be read. */
export class StoreDocumentError extends Error {
  /** Create an error describing an unreadable document. */
  constructor(message: string) {
    super(message)
    this.name = 'StoreDocumentError'
  }
}

/**
 * Read any stored document version. Version 2 documents are validated;
 * version 1 documents are normalized then converted. Documents from a newer
 * build are refused rather than silently downgraded.
 */
export function readStoreDocument(value: unknown): MigrationResult {
  if (typeof value !== 'object' || value === null) {
    throw new StoreDocumentError('The saved project is empty or unreadable.')
  }
  const version = (value as { version?: unknown }).version
  if (typeof version === 'number' && version > STORE_DOCUMENT_VERSION) {
    throw new StoreDocumentError(
      'This project was saved by a newer version of Shots. Reload the page to update.'
    )
  }
  if (version === STORE_DOCUMENT_VERSION) {
    const parsed = storeDocumentSchema.safeParse(value)
    if (!parsed.success) {
      throw new StoreDocumentError(`The saved project is invalid: ${parsed.error.issues[0]?.message}`)
    }
    return { document: parsed.data, pendingAssets: [], fromVersion: STORE_DOCUMENT_VERSION }
  }
  const v1 = normalizeStoreProject(value)
  if (!v1) throw new StoreDocumentError('The saved project has no readable screenshots.')
  return migrateV1Project(v1)
}
