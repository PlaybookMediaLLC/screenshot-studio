import { z } from 'zod'
import { newId } from './document/factory'
import {
  assetSchema,
  backgroundSchema,
  deviceFrameSchema,
  fontSourceSchema,
  hexColorSchema,
  idSchema,
  textStyleOverridesSchema,
  type StoreDocument,
  type StoreLayer,
  type TextRole,
} from './document/schema'
import { createImageLayer } from './document/elements'

/**
 * Brand kits: colors, fonts, logo, default background, device style, and
 * typography that can be applied to any project, slide, or selection. Kits
 * are stored in the browser library and are independent of projects.
 */

/** A brand kit. */
export const brandKitSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  palette: z.array(hexColorSchema).min(1).max(12),
  headingFont: z.string().min(1).max(200),
  bodyFont: z.string().min(1).max(200),
  fontSources: z.array(fontSourceSchema).max(8),
  textStyles: z.object({ heading: textStyleOverridesSchema, subheading: textStyleOverridesSchema, body: textStyleOverridesSchema }),
  background: backgroundSchema,
  deviceFrame: deviceFrameSchema,
  /** Logo image and any custom font files, with their metadata so projects can reference them. */
  assets: z.array(assetSchema).max(10),
  logoAssetId: idSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

/** Which parts of a kit to apply. */
export const brandKitPartsSchema = z.object({
  colors: z.boolean(),
  fonts: z.boolean(),
  background: z.boolean(),
  device: z.boolean(),
  logo: z.boolean(),
  /** Keep text styles a slide sets on purpose; only fill in what it inherits. */
  keepOverrides: z.boolean(),
})

/** Brand kit. */
export type BrandKit = z.infer<typeof brandKitSchema>
/** Parts to apply. */
export type BrandKitParts = z.infer<typeof brandKitPartsSchema>

/** A kit capturing a project's current style. */
export function brandKitFromDocument(document: StoreDocument, name: string): BrandKit {
  const now = Date.now()
  return {
    id: newId(),
    name: name.trim().slice(0, 80) || 'Brand kit',
    palette: [...document.theme.palette],
    headingFont: document.theme.textStyles.heading.fontFamily,
    bodyFont: document.theme.textStyles.body.fontFamily,
    fontSources: [...document.fonts],
    textStyles: {
      heading: { fontWeight: document.theme.textStyles.heading.fontWeight, fontSize: document.theme.textStyles.heading.fontSize, letterSpacing: document.theme.textStyles.heading.letterSpacing, color: document.theme.textStyles.heading.color },
      subheading: { fontWeight: document.theme.textStyles.subheading.fontWeight, color: document.theme.textStyles.subheading.color },
      body: { fontWeight: document.theme.textStyles.body.fontWeight, color: document.theme.textStyles.body.color },
    },
    background: structuredClone(document.theme.background),
    deviceFrame: { ...document.theme.deviceFrame },
    assets: document.fonts.flatMap((font) => (font.assetId && document.assets[font.assetId] ? [document.assets[font.assetId]] : [])),
    logoAssetId: null,
    createdAt: now,
    updatedAt: now,
  }
}

const FONT_KEYS = ['fontFamily', 'fontWeight', 'fontSize', 'letterSpacing', 'lineHeight']

/**
 * Apply a kit. With `slideIds` null it restyles the whole project through
 * the theme; with a selection it writes slide-level values to those slides
 * only, leaving every other slide untouched.
 */
export function applyBrandKit(document: StoreDocument, kit: BrandKit, slideIds: string[] | null, parts: BrandKitParts): StoreDocument {
  const roleStyle = (role: TextRole) => ({
    ...(parts.fonts ? { fontFamily: role === 'heading' ? kit.headingFont : kit.bodyFont } : {}),
    ...(parts.fonts ? Object.fromEntries(Object.entries(kit.textStyles[role]).filter(([key]) => key !== 'color')) : {}),
    ...(parts.colors && kit.textStyles[role].color !== undefined ? { color: kit.textStyles[role].color } : {}),
  })
  const assets = { ...document.assets }
  for (const asset of kit.assets) assets[asset.id] = asset
  const fonts = parts.fonts ? [...document.fonts.filter((font) => !kit.fontSources.some((item) => item.family === font.family)), ...kit.fontSources].slice(0, 20) : document.fonts
  const wanted = slideIds ? new Set(slideIds) : null
  const logo = parts.logo && kit.logoAssetId ? kit.logoAssetId : null

  const slides = document.slides.map((slide) => {
    if (wanted && !wanted.has(slide.id)) return slide
    let layers: StoreLayer[] = slide.layers.map((layer) => {
      if (layer.type === 'text' && (parts.fonts || parts.colors)) {
        const kitStyle = roleStyle(layer.role)
        if (!wanted) {
          const replaced = [...(parts.fonts ? FONT_KEYS : []), ...(parts.colors ? ['color'] : [])]
          const cleared = parts.keepOverrides ? layer.style : Object.fromEntries(Object.entries(layer.style).filter(([key]) => !replaced.includes(key)))
          return { ...layer, style: cleared }
        }
        return { ...layer, style: parts.keepOverrides ? { ...kitStyle, ...layer.style } : { ...layer.style, ...kitStyle } }
      }
      if (layer.type === 'device' && parts.device) return { ...layer, frame: { ...kit.deviceFrame } }
      return layer
    })
    if (logo && !layers.some((layer) => layer.type === 'image' && layer.assetId === logo)) {
      const logoLayer = createImageLayer(logo, `${kit.name} logo`)
      logoLayer.placement = { mode: 'free', x: 50, y: 96, width: 18 }
      layers = [...layers, logoLayer]
    }
    return {
      ...slide,
      layers,
      ...(parts.background ? { background: wanted ? structuredClone(kit.background) : null, backgroundSpan: null } : {}),
    }
  })

  const theme = wanted
    ? { ...document.theme, palette: parts.colors ? [...kit.palette] : document.theme.palette }
    : {
        ...document.theme,
        palette: parts.colors ? [...kit.palette] : document.theme.palette,
        background: parts.background ? structuredClone(kit.background) : document.theme.background,
        deviceFrame: parts.device ? { ...kit.deviceFrame } : document.theme.deviceFrame,
        textStyles: {
          heading: { ...document.theme.textStyles.heading, ...roleStyle('heading') },
          subheading: { ...document.theme.textStyles.subheading, ...roleStyle('subheading') },
          body: { ...document.theme.textStyles.body, ...roleStyle('body') },
        },
      }
  return { ...document, assets, fonts, slides, theme, brandKitId: kit.id }
}
