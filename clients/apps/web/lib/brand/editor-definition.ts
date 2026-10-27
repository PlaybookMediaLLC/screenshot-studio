import { z } from 'zod'
import { fontFamilies } from '@/lib/constants/fonts'
import { designDocumentSchema, isDesignSource } from '@/lib/design/document'
import { isGoogleFontId } from '@/lib/typography/google-fonts'

/**
 * The editor's part of a brand kit definition: everything a kit carries
 * beyond its canonical colours, catalog fonts, and primary logo (RFC 019).
 * It is stored as the definition's `editor` block, which the backend keeps
 * as sent and whose workspace images it checks.
 */

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a #RRGGBB hex colour.')
  .transform((value) => value.toLowerCase())

/** An editor font id: a catalog font or `google:<Family>`. */
export const editorFontIdSchema = z
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

/** The `editor` block of a brand kit definition. */
export const brandKitEditorSchema = z.object({
  /** The background designs start from; a brand gradient when absent. */
  background: designDocumentSchema.shape.background,
  /** Editor fonts, including Google Fonts; the canonical typography holds catalog fallbacks. */
  fonts: z
    .object({ body: editorFontIdSchema.optional(), heading: editorFontIdSchema.optional() })
    .default({}),
  frame: brandFrameSchema.optional(),
  /** Every logo, with the backgrounds it suits; the first is also the canonical primary logo. */
  logos: z.array(brandLogoSchema).max(6).default([]),
  /** More brand colours for pickers. */
  palette: z.array(hex).max(12).default([]),
  secondary: hex.optional(),
})
/** A brand kit's editor block. */
export type BrandKitEditor = z.infer<typeof brandKitEditorSchema>
