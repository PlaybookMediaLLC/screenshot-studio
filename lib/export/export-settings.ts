import { z } from 'zod'
import {
  type AnimatedFormat,
  FRAME_RATES,
  GIF_WIDTHS,
  outputFormatSchema,
  pdfCompressionSchema,
  qualityPresetSchema,
} from './formats'
import { CANVAS_TARGET_ID, canvasTarget, type ExportTarget, exportTargetSchema } from './sizes'

/**
 * The export panel's settings, remembered in this browser. Stored values
 * are read through the schema, so a stale or edited entry falls back to the
 * defaults field by field instead of breaking the panel.
 */

const STORAGE_KEY = 'screenshot-studio:export-settings:v1'

/** Every export setting. */
export const exportSettingsSchema = z.object({
  /** One file (or PDF page) per slide, when the design has several. */
  allSlides: z.boolean().catch(false),
  format: outputFormatSchema.catch('jpeg'),
  /** Frames per second for animated formats. */
  fps: z.number().int().min(1).max(60).catch(30),
  /** GIF output width in px; 0 keeps the canvas width. */
  gifWidth: z
    .number()
    .int()
    .refine((width) => (GIF_WIDTHS as readonly number[]).includes(width))
    .catch(640),
  pdfCompression: pdfCompressionSchema.catch('jpeg'),
  quality: qualityPresetSchema.catch('high'),
  scale: z.number().int().min(1).max(3).catch(2),
  /** Target sizes; the canvas target's size is refreshed from the live canvas. */
  targets: z
    .array(exportTargetSchema)
    .min(1)
    .max(40)
    .catch([canvasTarget(1920, 1440)]),
  transparent: z.boolean().catch(false),
})
/** Export settings. */
export type ExportSettings = z.infer<typeof exportSettingsSchema>

/** Settings for a first export: the canvas as JPEG at 2x, as the editor has always exported. */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = exportSettingsSchema.parse({})

/** Read the remembered settings; anything unreadable is a default. */
export function loadExportSettings(storage: Pick<Storage, 'getItem'> | undefined): ExportSettings {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    return exportSettingsSchema.parse(raw ? JSON.parse(raw) : {})
  } catch {
    return DEFAULT_EXPORT_SETTINGS
  }
}

/** Remember the settings; a full or blocked storage only loses the memory. */
export function saveExportSettings(
  storage: Pick<Storage, 'setItem'> | undefined,
  settings: ExportSettings
) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private mode or quota: the export itself is unaffected.
  }
}

/** The chosen targets with the canvas target at the canvas's current size. */
export function withCurrentCanvas(
  targets: readonly ExportTarget[],
  canvas: { height: number; width: number }
): ExportTarget[] {
  const current = canvasTarget(canvas.width, canvas.height)
  return targets.map((target) => (target.id === CANVAS_TARGET_ID ? current : target))
}

/** The frame rate to use: the stored one when the format offers it, else the format's default. */
export function frameRateFor(format: AnimatedFormat, fps: number): number {
  const offered = FRAME_RATES[format]
  return offered.includes(fps) ? fps : format === 'gif' ? 15 : 30
}
