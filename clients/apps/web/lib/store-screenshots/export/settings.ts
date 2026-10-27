import type { StoreDocument } from '../document/schema'
import { getStoreTarget } from '../targets'
import { exportSettingsSchema, type ExportSettings } from './plan'

/** Settings shared by export, the Checks dialog, and its header count. */
export function resolveExportSettings(document: StoreDocument, saved: unknown): ExportSettings {
  const base: ExportSettings = {
    targets: [
      { targetId: 'ios-iphone-6.9', sizeIndex: 0, orientation: 'portrait' },
      { targetId: 'ios-iphone-6.3', sizeIndex: 0, orientation: 'portrait' },
    ],
    format: 'png',
    quality: 0.92,
    locales: [document.localization.sourceLocale],
    slideIds: document.slides.map((slide) => slide.id),
    folderLayout: 'store-locale-device',
    packaging: 'zip',
    prefix: '',
  }
  const parsed = exportSettingsSchema.partial().safeParse(saved)
  if (!parsed.success) return base
  const settings = { ...base, ...parsed.data }
  const locales = settings.locales.filter(
    (code) =>
      code === document.localization.sourceLocale || document.localization.locales.includes(code)
  )
  const slideIds = settings.slideIds.filter((id) => base.slideIds.includes(id))
  const targets = settings.targets.filter((choice) => {
    const target = getStoreTarget(choice.targetId)
    return (
      target &&
      choice.sizeIndex < target.portraitSizes.length &&
      target.orientations.includes(choice.orientation)
    )
  })
  return {
    ...settings,
    locales: locales.length ? locales : base.locales,
    slideIds: slideIds.length ? slideIds : base.slideIds,
    targets: targets.length ? targets : base.targets,
  }
}

/** Read remembered settings, tolerating disabled storage and obsolete selections. */
export function loadExportSettings(document: StoreDocument): ExportSettings {
  try {
    return resolveExportSettings(
      document,
      JSON.parse(localStorage.getItem(`shots-store-export:${document.id}`) ?? 'null')
    )
  } catch {
    return resolveExportSettings(document, null)
  }
}
