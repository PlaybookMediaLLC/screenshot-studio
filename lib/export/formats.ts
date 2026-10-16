import { z } from 'zod'

/**
 * Every file format the editor exports, with the facts each consumer needs:
 * MIME type, file extension, how it is produced, and which settings change
 * it. One table, so the export panel, a download, a ZIP entry, and a
 * workspace upload always agree, and a control is shown only where it has
 * an effect.
 */

/** Every export format. */
export const outputFormatSchema = z.enum([
  'png',
  'jpeg',
  'webp',
  'svg',
  'pdf',
  'gif',
  'mp4',
  'webm',
])
/** An export format. */
export type OutputFormat = z.infer<typeof outputFormatSchema>

/** Formats the stage itself can encode: one capture, at any size. */
export const stageFormatSchema = z.enum(['png', 'jpeg', 'webp', 'svg'])
/** A format the stage encodes directly. */
export type StageFormat = z.infer<typeof stageFormatSchema>

/** Formats that play the timeline through the video path. */
export const animatedFormatSchema = z.enum(['gif', 'mp4', 'webm'])
/** An animated format. */
export type AnimatedFormat = z.infer<typeof animatedFormatSchema>

/** How a format is produced. */
export const formatKindSchema = z.enum(['raster', 'vector', 'document', 'animated'])
/** A format kind. */
export type FormatKind = z.infer<typeof formatKindSchema>

/** Lossy quality presets, shared with the image API and the video bitrates. */
export const qualityPresetSchema = z.enum(['high', 'medium', 'low'])
/** A quality preset. */
export type QualityPresetName = z.infer<typeof qualityPresetSchema>

/** How PDF pages store their image. */
export const pdfCompressionSchema = z.enum(['jpeg', 'lossless'])
/** A PDF image compression. */
export type PdfCompression = z.infer<typeof pdfCompressionSchema>

/** A setting the export panel can show. */
export const exportControlSchema = z.enum([
  /** Lossy quality (images) or bitrate (video). */
  'quality',
  /** Output resolution multiplier. */
  'scale',
  /** Several target sizes in one export. */
  'sizes',
  /** Leave the background out. */
  'transparency',
  /** Frames per second. */
  'fps',
  /** How long the animation runs. */
  'duration',
  /** Output width of an animated GIF. */
  'width',
  /** How PDF pages store their image. */
  'compression',
])
/** An export setting. */
export type ExportControl = z.infer<typeof exportControlSchema>

/** One format's facts. */
export type FormatInfo = {
  /** Short name for buttons. */
  label: string
  /** One line for the picker. */
  description: string
  /** The MIME type of the produced file. */
  mime: string
  /** File extension, without the dot. */
  extension: string
  /** How the format is produced. */
  kind: FormatKind
  /** The settings that change this format's output, in display order. */
  controls: readonly ExportControl[]
  /** What the format cannot do, said plainly in the panel. */
  limitation?: string
}

/** The facts for every format. */
export const FORMAT_INFO: Record<OutputFormat, FormatInfo> = {
  png: {
    controls: ['sizes', 'scale', 'transparency'],
    description: 'Lossless, supports transparency',
    extension: 'png',
    kind: 'raster',
    label: 'PNG',
    mime: 'image/png',
  },
  jpeg: {
    controls: ['sizes', 'quality', 'scale'],
    description: 'Smaller files, great for sharing',
    extension: 'jpg',
    kind: 'raster',
    label: 'JPEG',
    mime: 'image/jpeg',
  },
  webp: {
    controls: ['sizes', 'quality', 'scale', 'transparency'],
    description: 'Best compression, supports transparency',
    extension: 'webp',
    kind: 'raster',
    label: 'WebP',
    mime: 'image/webp',
  },
  svg: {
    controls: ['sizes', 'transparency'],
    description: 'Text and shapes stay vector; images are embedded',
    extension: 'svg',
    kind: 'vector',
    label: 'SVG',
    limitation:
      'Drawn with HTML inside SVG (foreignObject): opens in web browsers, not in Figma, Illustrator, or Inkscape. Designs with blur regions are embedded as one image so the blurred pixels stay hidden.',
    mime: 'image/svg+xml',
  },
  pdf: {
    controls: ['sizes', 'scale', 'compression'],
    description: 'Exact page size, one page per size',
    extension: 'pdf',
    kind: 'document',
    label: 'PDF',
    limitation: 'Each page holds the design as one image; text is not selectable.',
    mime: 'application/pdf',
  },
  gif: {
    controls: ['fps', 'width', 'duration'],
    description: 'Animated loop that plays anywhere',
    extension: 'gif',
    kind: 'animated',
    label: 'GIF',
    limitation: 'Plays the timeline at the canvas shape, with up to 256 colours.',
    mime: 'image/gif',
  },
  mp4: {
    controls: ['fps', 'quality', 'duration'],
    description: 'H.264 video, best compatibility',
    extension: 'mp4',
    kind: 'animated',
    label: 'MP4',
    limitation: 'Plays the timeline at the canvas size.',
    mime: 'video/mp4',
  },
  webm: {
    controls: ['fps', 'quality', 'duration'],
    description: 'VP9 video for the web',
    extension: 'webm',
    kind: 'animated',
    label: 'WebM',
    limitation: 'Plays the timeline at the canvas size.',
    mime: 'video/webm',
  },
}

/** The MIME type of a format. */
export function mimeTypeFor(format: OutputFormat): string {
  return FORMAT_INFO[format].mime
}

/** The file extension of a format, without the dot. */
export function extensionFor(format: OutputFormat): string {
  return FORMAT_INFO[format].extension
}

/** The format a MIME type names (parameters ignored), or null for anything else. */
export function formatForMimeType(mime: string): OutputFormat | null {
  const base = (mime.split(';', 1)[0] ?? '').trim().toLowerCase()
  return outputFormatSchema.options.find((format) => FORMAT_INFO[format].mime === base) ?? null
}

/** True when a setting changes this format's output. */
export function formatHasControl(format: OutputFormat, control: ExportControl): boolean {
  return FORMAT_INFO[format].controls.includes(control)
}

/** True for formats that play the timeline. */
export function isAnimatedFormat(format: OutputFormat): format is AnimatedFormat {
  return animatedFormatSchema.safeParse(format).success
}

/** Frame rates offered for animated formats; GIF tops out at 30. */
export const FRAME_RATES: Record<AnimatedFormat, readonly number[]> = {
  gif: [10, 15, 24, 30],
  mp4: [24, 30, 60],
  webm: [24, 30, 60],
}

/** GIF output widths offered, in px; 0 keeps the canvas width. */
export const GIF_WIDTHS = [480, 640, 800, 0] as const
