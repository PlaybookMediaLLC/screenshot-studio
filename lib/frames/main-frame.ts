import type { FrameSpec } from './geometry'
import type { Browser, FrameChrome, Tone } from './schema'

/**
 * The main screenshot's frame. It keeps the editor's original frame field
 * (`imageBorder.type`): style frames (glass, border, photograph, Arc border)
 * draw as before, and browser and window frames draw with the shared chrome.
 * Documents from before the chrome options name a browser and its tone in
 * the type itself; they read as that browser with a fixed appearance.
 */

/** Frame types that named a browser before chrome options existed. */
export const LEGACY_BROWSER_FRAMES: Readonly<
  Record<string, { appearance: Tone; browser: Browser }>
> = {
  'macos-dark': { appearance: 'dark', browser: 'safari' },
  'macos-light': { appearance: 'light', browser: 'safari' },
  'windows-dark': { appearance: 'dark', browser: 'chrome' },
  'windows-light': { appearance: 'light', browser: 'chrome' },
}

/** True for a frame type drawn as browser or window chrome. */
export function isChromeFrameType(type: string): boolean {
  return type === 'browser' || type === 'window' || type in LEGACY_BROWSER_FRAMES
}

/** The main screenshot's chrome frame, or none when it has no browser or window. */
export function mainFrameSpec(
  border: { enabled: boolean; type: string },
  chrome: FrameChrome,
  address: string
): FrameSpec {
  if (!border.enabled) return { kind: 'none' }
  if (border.type === 'window') return { chrome, kind: 'window' }
  if (border.type === 'browser') return { chrome: { ...chrome, address }, kind: 'browser' }
  const legacy = LEGACY_BROWSER_FRAMES[border.type]
  return legacy ? { chrome: { ...chrome, ...legacy, address }, kind: 'browser' } : { kind: 'none' }
}
