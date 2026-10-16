import { z } from 'zod'

/**
 * Store submission targets.
 *
 * This catalog is data, not code: each entry records the accepted pixel
 * sizes, counts, and formats published by the store, with the page it came
 * from and the date it was checked. Display classes are named the way the
 * stores name them; diagonal sizes are labels only and never used to derive
 * pixel sizes. Update an entry (and `STORE_TARGET_CATALOG_VERSION`) when a
 * store changes its rules; compliance checks and export read from here.
 */

/** Date the catalog was last checked against the store documentation. */
export const STORE_TARGET_CATALOG_VERSION = '2026-10-16'

const APPLE_SPEC_URL =
  'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/'
const PLAY_SPEC_URL = 'https://support.google.com/googleplay/android-developer/answer/9866151'

/** Stores. */
export const storeIdSchema = z.enum(['app-store', 'google-play'])

/** Whether a store insists on a target. */
export const targetRequirementSchema = z.enum(['required', 'conditional', 'optional'])

/** Image formats a store accepts. */
export const imageFormatSchema = z.enum(['png', 'jpeg'])

/** Screen class of a target, used to pick sensible device frames. */
export const targetFamilySchema = z.enum(['phone', 'tablet', 'laptop', 'watch', 'headset', 'tv'])

/** Orientation of an exported image. */
export const exportOrientationSchema = z.enum(['portrait', 'landscape'])

/** Export orientation. */
export type ExportOrientation = z.infer<typeof exportOrientationSchema>

/** Store id. */
export type StoreId = z.infer<typeof storeIdSchema>
/** Requirement level. */
export type TargetRequirement = z.infer<typeof targetRequirementSchema>
/** Image format. */
export type ImageFormat = z.infer<typeof imageFormatSchema>
/** Target family. */
export type TargetFamily = z.infer<typeof targetFamilySchema>

/** A pixel size. */
export type PixelSize = { width: number; height: number }

/** One store display class. */
export type StoreTarget = {
  id: string
  store: StoreId
  family: TargetFamily
  /** The store's own name for the class. */
  name: string
  /** Short label for pickers, e.g. `iPhone 6.9"`. */
  shortName: string
  /** Example devices, for orientation only. */
  devices: string
  requirement: TargetRequirement
  requirementNote: string
  /** Accepted sizes written portrait (width < height); landscape is the transpose. The first is the default. */
  portraitSizes: PixelSize[]
  /** Accepted orientations; the first is the default. */
  orientations: ExportOrientation[]
  minCount: number
  maxCount: number
  formats: ImageFormat[]
  /** Store rejects images with an alpha channel. */
  noAlpha: boolean
  /** Per-file size limit when the store publishes one. */
  maxFileBytes: number | null
  /** Free-size stores (Google Play) validate ranges rather than exact sizes. */
  sizeRange: { minSide: number; maxSide: number; maxAspect: number } | null
  /** App Store Connect `screenshotDisplayType`, when uploads are supported. */
  ascDisplayType: string | null
  /** Google Play Developer API image type, when uploads are supported. */
  playImageType: string | null
  source: string
}

/** Every target, in picker order. */
export const STORE_TARGETS: StoreTarget[] = [
  {
    id: 'ios-iphone-6.9',
    store: 'app-store',
    family: 'phone',
    name: 'iPhone with Dynamic Island (large display)',
    shortName: 'iPhone 6.9"',
    devices: 'iPhone 17 Pro Max, iPhone Air, iPhone 16 Pro Max, iPhone 16 Plus',
    requirement: 'optional',
    requirementNote:
      'Optional. When missing, Apple scales the iPhone 6.5" (Face ID large) set for these devices.',
    portraitSizes: [
      { width: 1320, height: 2868 },
      { width: 1290, height: 2796 },
      { width: 1260, height: 2736 },
    ],
    orientations: ['portrait', 'landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_IPHONE_67',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'ios-iphone-6.3',
    store: 'app-store',
    family: 'phone',
    name: 'iPhone with Dynamic Island (medium display)',
    shortName: 'iPhone 6.3"',
    devices: 'iPhone 17 Pro, iPhone 17, iPhone 16 Pro, iPhone 16, iPhone 15',
    requirement: 'required',
    requirementNote: 'Required when the app runs on iPhone.',
    portraitSizes: [
      { width: 1206, height: 2622 },
      { width: 1179, height: 2556 },
    ],
    orientations: ['portrait', 'landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_IPHONE_61',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'ios-iphone-6.5',
    store: 'app-store',
    family: 'phone',
    name: 'iPhone with Face ID (large display)',
    shortName: 'iPhone 6.5"',
    devices: 'iPhone 14 Plus, iPhone 13 Pro Max, iPhone 11 Pro Max, iPhone XS Max',
    requirement: 'conditional',
    requirementNote:
      'Required when the app runs on iPhone and no iPhone 6.9" (Dynamic Island large) set is provided.',
    portraitSizes: [
      { width: 1284, height: 2778 },
      { width: 1242, height: 2688 },
    ],
    orientations: ['portrait', 'landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_IPHONE_65',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'ios-iphone-5.5',
    store: 'app-store',
    family: 'phone',
    name: 'iPhone with Home button (large display)',
    shortName: 'iPhone 5.5"',
    devices: 'iPhone 8 Plus, iPhone 7 Plus, iPhone 6s Plus',
    requirement: 'optional',
    requirementNote: 'Optional. Apple scales a larger iPhone set when it is missing.',
    portraitSizes: [{ width: 1242, height: 2208 }],
    orientations: ['portrait', 'landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_IPHONE_55',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'ios-ipad-13',
    store: 'app-store',
    family: 'tablet',
    name: 'iPad 13-inch display',
    shortName: 'iPad 13"',
    devices: 'iPad Pro (M5, M4), iPad Air (M4, M3, M2), iPad Pro 12.9-inch',
    requirement: 'conditional',
    requirementNote: 'Required when the app runs on iPad.',
    portraitSizes: [
      { width: 2064, height: 2752 },
      { width: 2048, height: 2732 },
    ],
    orientations: ['portrait', 'landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_IPAD_PRO_3GEN_129',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'ios-ipad-11',
    store: 'app-store',
    family: 'tablet',
    name: 'iPad 11-inch display',
    shortName: 'iPad 11"',
    devices: 'iPad Pro 11-inch, iPad Air 11-inch, iPad (A16), iPad mini',
    requirement: 'optional',
    requirementNote: 'Optional. Apple scales the iPad 13" set when it is missing.',
    portraitSizes: [
      { width: 1668, height: 2420 },
      { width: 1668, height: 2388 },
      { width: 1640, height: 2360 },
      { width: 1488, height: 2266 },
    ],
    orientations: ['portrait', 'landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_IPAD_PRO_3GEN_11',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'mac',
    store: 'app-store',
    family: 'laptop',
    name: 'Mac',
    shortName: 'Mac',
    devices: 'Any Mac (16:10)',
    requirement: 'conditional',
    requirementNote: 'Required for Mac apps. Screenshots are landscape 16:10.',
    portraitSizes: [
      { width: 1600, height: 2560 },
      { width: 1800, height: 2880 },
      { width: 900, height: 1440 },
      { width: 800, height: 1280 },
    ],
    orientations: ['landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_DESKTOP',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'apple-watch-ultra',
    store: 'app-store',
    family: 'watch',
    name: 'Apple Watch Ultra 3',
    shortName: 'Watch Ultra',
    devices: 'Apple Watch Ultra 4, Ultra 3',
    requirement: 'conditional',
    requirementNote: 'Required for Apple Watch apps (one watch size is enough).',
    portraitSizes: [{ width: 422, height: 514 }],
    orientations: ['portrait'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_WATCH_ULTRA',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'apple-vision-pro',
    store: 'app-store',
    family: 'headset',
    name: 'Apple Vision Pro',
    shortName: 'Vision Pro',
    devices: 'Apple Vision Pro',
    requirement: 'conditional',
    requirementNote: 'Required for visionOS apps. Landscape 3840 x 2160 only.',
    portraitSizes: [{ width: 2160, height: 3840 }],
    orientations: ['landscape'],
    minCount: 1,
    maxCount: 10,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: null,
    sizeRange: null,
    ascDisplayType: 'APP_APPLE_VISION_PRO',
    playImageType: null,
    source: APPLE_SPEC_URL,
  },
  {
    id: 'play-phone',
    store: 'google-play',
    family: 'phone',
    name: 'Phone screenshots',
    shortName: 'Play phone',
    devices: 'Android phones',
    requirement: 'required',
    requirementNote:
      'At least 2 screenshots to publish; 4 at 1080 px or larger to be eligible for promotion.',
    portraitSizes: [
      { width: 1080, height: 1920 },
      { width: 1440, height: 2560 },
    ],
    orientations: ['portrait', 'landscape'],
    minCount: 2,
    maxCount: 8,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: 8 * 1024 * 1024,
    sizeRange: { minSide: 320, maxSide: 3840, maxAspect: 2 },
    ascDisplayType: null,
    playImageType: 'phoneScreenshots',
    source: PLAY_SPEC_URL,
  },
  {
    id: 'play-tablet-7',
    store: 'google-play',
    family: 'tablet',
    name: '7-inch tablet screenshots',
    shortName: 'Play 7" tablet',
    devices: 'Small Android tablets',
    requirement: 'optional',
    requirementNote: 'Needed for large-screen promotion: at least 4, 1080-7680 px, 9:16 or 16:9.',
    portraitSizes: [{ width: 1080, height: 1920 }],
    orientations: ['portrait', 'landscape'],
    minCount: 4,
    maxCount: 8,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: 8 * 1024 * 1024,
    sizeRange: { minSide: 1080, maxSide: 7680, maxAspect: 2 },
    ascDisplayType: null,
    playImageType: 'sevenInchScreenshots',
    source: PLAY_SPEC_URL,
  },
  {
    id: 'play-tablet-10',
    store: 'google-play',
    family: 'tablet',
    name: '10-inch tablet screenshots',
    shortName: 'Play 10" tablet',
    devices: 'Large Android tablets and Chromebooks',
    requirement: 'optional',
    requirementNote: 'Needed for large-screen promotion: at least 4, 1080-7680 px, 9:16 or 16:9.',
    portraitSizes: [{ width: 1440, height: 2560 }],
    orientations: ['portrait', 'landscape'],
    minCount: 4,
    maxCount: 8,
    formats: ['png', 'jpeg'],
    noAlpha: true,
    maxFileBytes: 8 * 1024 * 1024,
    sizeRange: { minSide: 1080, maxSide: 7680, maxAspect: 2 },
    ascDisplayType: null,
    playImageType: 'tenInchScreenshots',
    source: PLAY_SPEC_URL,
  },
]

const TARGET_BY_ID = new Map(STORE_TARGETS.map((target) => [target.id, target]))

/** The target the editor canvas shows by default. */
export const DEFAULT_TARGET_ID = 'ios-iphone-6.9'

/** Look up a target by id. */
export function getStoreTarget(id: string): StoreTarget | undefined {
  return TARGET_BY_ID.get(id)
}

/** Look up a target by id, falling back to the default editing target. */
export function getStoreTargetOrDefault(id: string): StoreTarget {
  return TARGET_BY_ID.get(id) ?? TARGET_BY_ID.get(DEFAULT_TARGET_ID)!
}

/** The pixel size a target exports at for a size index and orientation. */
export function targetPixelSize(
  target: StoreTarget,
  sizeIndex = 0,
  orientation: ExportOrientation = target.orientations[0]
): PixelSize {
  const size = target.portraitSizes[Math.min(sizeIndex, target.portraitSizes.length - 1)]
  const resolved = target.orientations.includes(orientation) ? orientation : target.orientations[0]
  return resolved === 'landscape' ? { width: size.height, height: size.width } : size
}

/**
 * Whether a pixel size satisfies a target. Exact-size stores must match one
 * accepted size in either accepted orientation; range stores check bounds and
 * aspect ratio.
 */
export function sizeAccepted(target: StoreTarget, size: PixelSize): boolean {
  if (target.sizeRange) {
    const short = Math.min(size.width, size.height)
    const long = Math.max(size.width, size.height)
    return (
      short >= target.sizeRange.minSide &&
      long <= target.sizeRange.maxSide &&
      long / short <= target.sizeRange.maxAspect
    )
  }
  return target.portraitSizes.some(
    (accepted) =>
      (target.orientations.includes('portrait') &&
        accepted.width === size.width &&
        accepted.height === size.height) ||
      (target.orientations.includes('landscape') &&
        accepted.width === size.height &&
        accepted.height === size.width)
  )
}

/** Label for a pixel size. */
export function sizeLabel(size: PixelSize): string {
  return `${size.width} × ${size.height}`
}
