import { z } from 'zod'
import { fontFamilies } from '@/lib/constants/fonts'
import { designDocumentSchema, isDesignSource } from '@/lib/design/document'
import { brandFontId } from '@/lib/launch/brand'
import { GOOGLE_FONT_PREFIX, googleFontId, isGoogleFontId } from '@/lib/typography/google-fonts'

/**
 * Brand kits: a workspace's colours, fonts, logos, and default background
 * and frame. Kits are stored by the backend as versioned JSON definitions;
 * this is the editor's reading of them. Older kits (colours and a typeface
 * name only) read as kits with no logos or defaults.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const hex = z
  .string()
  .trim()
  .regex(HEX, 'Use a hex colour like #6d5dfc.')
  .transform((value) => value.toLowerCase())

/** An editor font id: a catalog font or `google:<Family>`. */
const fontId = z
  .string()
  .max(80)
  .refine(
    (id) => fontFamilies.some((font) => font.id === id) || isGoogleFontId(id),
    'Unknown font.'
  )

/** Which logo a design should use on a light or dark background. */
export const logoToneSchema = z.enum(['any', 'light', 'dark'])
/** A logo tone. */
export type LogoTone = z.infer<typeof logoToneSchema>

/** A logo stored in the workspace's assets. */
export const brandLogoSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  src: z
    .string()
    .max(200)
    .refine((src) => src.startsWith('asset:') && isDesignSource(src), 'Upload the logo first.'),
  tone: logoToneSchema.default('any'),
})
/** A brand logo. */
export type BrandLogo = z.infer<typeof brandLogoSchema>

const imageShape = designDocumentSchema.shape.image.shape

/**
 * The frame designs start from: the frame mode and the screenshot's frame,
 * browser or window chrome, corners, and shadow.
 */
export const brandFrameSchema = z.object({
  browserHeaderSize: imageShape.browserHeaderSize,
  chrome: imageShape.chrome,
  frame: imageShape.frame,
  mode: designDocumentSchema.shape.mode,
  radius: imageShape.radius,
  shadow: imageShape.shadow,
})
/** A brand frame default. */
export type BrandFrame = z.infer<typeof brandFrameSchema>

/** A stored brand kit definition, as the editor writes it. */
export const brandKitDefinitionSchema = z.object({
  background: designDocumentSchema.shape.background,
  colors: z.object({
    accent: hex.optional(),
    background: hex,
    foreground: hex,
    /** More brand colours for pickers. */
    palette: z.array(hex).max(12).default([]),
    secondary: hex.optional(),
  }),
  /** Editor font ids. `typography.fontFamily` keeps the primary's name for older readers. */
  fonts: z.object({ primary: fontId.optional(), secondary: fontId.optional() }).default({}),
  frame: brandFrameSchema.optional(),
  logos: z.array(brandLogoSchema).max(6).default([]),
  typography: z.object({ fontFamily: z.string().trim().max(80).optional() }).default({}),
})
/** A brand kit definition. */
export type BrandKitDefinition = z.infer<typeof brandKitDefinitionSchema>
/** A brand kit definition as written (defaults optional). */
export type BrandKitDefinitionInput = z.input<typeof brandKitDefinitionSchema>

/** A brand kit ready to apply: the latest version of one name. */
export type BrandKit = {
  accent: string
  background: BrandKitDefinition['background']
  colors: BrandKitDefinition['colors']
  frame: BrandFrame | undefined
  id: string
  logos: BrandLogo[]
  name: string
  /** Font ids for headlines and for everything else. */
  primaryFont: string | null
  secondaryFont: string | null
  version: number
}

/** A stored brand kit, as listed by the workspace. */
export const storedBrandKitSchema = z.object({
  definition: z.record(z.string(), z.unknown()),
  id: z.string(),
  name: z.string(),
  status: z.string(),
  version: z.number().int(),
})
/** A stored brand kit. */
export type StoredBrandKit = z.infer<typeof storedBrandKitSchema>

/** The editor font for a typeface name: a catalog font, else the Google Fonts family. */
export function fontIdForName(name: string | undefined): string | null {
  const family = name
    ?.split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
  if (!family) return null
  if (fontFamilies.some((font) => font.id === family) || isGoogleFontId(family)) return family
  return brandFontId(family) ?? googleFontId(family)
}

/** The display name of an editor font id. */
export function fontName(id: string): string {
  if (id.startsWith(GOOGLE_FONT_PREFIX)) return id.slice(GOOGLE_FONT_PREFIX.length)
  return fontFamilies.find((font) => font.id === id)?.name ?? id
}

/** Read one stored kit; null when its definition has no usable colours. */
export function readBrandKit(stored: StoredBrandKit): BrandKit | null {
  const parsed = brandKitDefinitionSchema.safeParse(stored.definition)
  if (!parsed.success) return null
  const { background, colors, fonts, frame, logos, typography } = parsed.data
  const primaryFont = fonts.primary ?? fontIdForName(typography.fontFamily)
  return {
    accent: colors.accent ?? colors.background,
    background,
    colors,
    frame,
    id: stored.id,
    logos,
    name: stored.name,
    primaryFont,
    secondaryFont: fonts.secondary ?? primaryFont,
    version: stored.version,
  }
}

/** The library: the latest active version of each kit, by name. */
export function brandKitLibrary(stored: readonly StoredBrandKit[]): BrandKit[] {
  const latest = new Map<string, StoredBrandKit>()
  for (const kit of stored) {
    const current = latest.get(kit.name)
    if (!current || kit.version > current.version) latest.set(kit.name, kit)
  }
  return [...latest.values()]
    .filter((kit) => kit.status !== 'ARCHIVED')
    .map(readBrandKit)
    .filter((kit): kit is BrandKit => kit !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The definition to store for a kit edited in the editor. */
export function brandKitDefinition(input: BrandKitDefinitionInput): BrandKitDefinition {
  const definition = brandKitDefinitionSchema.parse(input)
  const primary = definition.fonts.primary
  return {
    ...definition,
    typography: { fontFamily: primary ? fontName(primary) : definition.typography.fontFamily },
  }
}
