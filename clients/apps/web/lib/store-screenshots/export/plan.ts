import { z } from 'zod'
import type { StoreDocument } from '../document/schema'
import { localeFolder } from '../locales'
import {
  exportOrientationSchema,
  getStoreTarget,
  imageFormatSchema,
  targetPixelSize,
  type PixelSize,
} from '../targets'

/**
 * Export planning: which files an export produces, where they go in the
 * archive, and what they are called. Pure, so the file list shown before
 * export is exactly the list the job renders.
 */

/** How files are arranged in the archive. */
export const folderLayoutSchema = z.enum(['store-locale-device', 'locale-device', 'flat'])

/** Packaging for the finished files. */
export const packagingSchema = z.enum(['zip', 'files'])

/** Export settings chosen in the export dialog. */
export const exportSettingsSchema = z.object({
  targets: z
    .array(
      z.object({
        targetId: z.string(),
        sizeIndex: z.number().int().min(0),
        orientation: exportOrientationSchema,
      })
    )
    .min(1),
  format: imageFormatSchema,
  /** JPEG quality, 0.5 to 1. */
  quality: z.number().min(0.5).max(1),
  locales: z.array(z.string()).min(1),
  slideIds: z.array(z.string()).min(1),
  folderLayout: folderLayoutSchema,
  packaging: packagingSchema,
  /** File name prefix, e.g. the app name. */
  prefix: z.string().max(40),
})

/** Export settings. */
export type ExportSettings = z.infer<typeof exportSettingsSchema>
/** Folder layout. */
export type FolderLayout = z.infer<typeof folderLayoutSchema>

/** One planned file. */
export type PlannedFile = {
  path: string
  targetId: string
  sizeIndex: number
  orientation: ExportSettings['targets'][number]['orientation']
  size: PixelSize
  locale: string
  slideId: string
  slideIndex: number
  position: number
  format: ExportSettings['format']
  quality: number
}

/** A file or folder name safe on every platform. */
export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 48) || 'slide'
  )
}

const TARGET_FOLDERS: Record<string, string> = {
  'ios-iphone-6.9': 'iphone-6.9in',
  'ios-iphone-6.3': 'iphone-6.3in',
  'ios-iphone-6.5': 'iphone-6.5in',
  'ios-iphone-5.5': 'iphone-5.5in',
  'ios-ipad-13': 'ipad-13in',
  'ios-ipad-11': 'ipad-11in',
  mac: 'mac',
  'apple-watch-ultra': 'apple-watch-ultra',
  'apple-vision-pro': 'apple-vision-pro',
  'play-phone': 'phone',
  'play-tablet-7': 'tablet-7in',
  'play-tablet-10': 'tablet-10in',
}

/** Build the file list. Slides keep project order; numbering restarts per target and locale. */
export function planExport(document: StoreDocument, settings: ExportSettings): PlannedFile[] {
  const files: PlannedFile[] = []
  const wanted = new Set(settings.slideIds)
  const slides = document.slides.map((slide, index) => ({ slide, index })).filter(({ slide }) => wanted.has(slide.id))
  const extension = settings.format === 'png' ? 'png' : 'jpg'
  const prefix = settings.prefix.trim() ? `${slugify(settings.prefix)}_` : ''
  for (const choice of settings.targets) {
    const target = getStoreTarget(choice.targetId)
    if (!target) continue
    const size = targetPixelSize(target, choice.sizeIndex, choice.orientation)
    const store = target.store === 'app-store' ? 'app-store' : 'google-play'
    const device = `${TARGET_FOLDERS[target.id] ?? slugify(target.id)}${choice.orientation === 'landscape' && target.orientations[0] !== 'landscape' ? '-landscape' : ''}`
    for (const locale of settings.locales) {
      const folder =
        settings.folderLayout === 'flat'
          ? ''
          : settings.folderLayout === 'locale-device'
            ? `${localeFolder(locale)}/${device}/`
            : `${store}/${localeFolder(locale)}/${device}/`
      slides.forEach(({ slide, index }, position) => {
        const number = String(position + 1).padStart(2, '0')
        const flatSuffix = settings.folderLayout === 'flat' ? `_${store}_${localeFolder(locale)}_${device}` : ''
        files.push({
          path: `${folder}${prefix}${number}_${slugify(slide.name)}${flatSuffix}_${size.width}x${size.height}.${extension}`,
          targetId: target.id,
          sizeIndex: choice.sizeIndex,
          orientation: choice.orientation,
          size,
          locale,
          slideId: slide.id,
          slideIndex: index,
          position: position + 1,
          format: settings.format,
          quality: settings.quality,
        })
      })
    }
  }
  return files
}
