import { getMockupDefinition } from '@/lib/constants/mockups'
import type { Mockup } from '@/types/mockup'
import { screenFrameKind } from './geometry'
import type { Appearance, Browser, FrameKind, WindowStyle } from './schema'

/** Browser names. */
export const BROWSER_LABELS: Record<Browser, string> = {
  arc: 'Arc',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
}

/** Window style names. */
export const WINDOW_LABELS: Record<WindowStyle, string> = {
  macos: 'macOS window',
  'terminal-macos': 'macOS Terminal',
  'terminal-minimal': 'Minimal terminal',
  'terminal-windows': 'Windows Terminal',
  windows: 'Windows 11 window',
}

/** Appearance names. */
export const APPEARANCE_LABELS: Record<Appearance, string> = {
  auto: 'Auto',
  dark: 'Dark',
  light: 'Light',
}

/** Frame kind names. */
export const FRAME_KIND_LABELS: Record<FrameKind, string> = {
  browser: 'Browser',
  device: 'Device',
  none: 'No frame',
  window: 'Window',
}

/** What a screen is, for the layer list and the inspector: "Code in macOS Terminal". */
export function screenLabel(mockup: Pick<Mockup, 'definitionId' | 'frame' | 'screen'>): string {
  const content = mockup.screen.code ? 'Code' : 'Screenshot'
  const kind = screenFrameKind(mockup)
  const chrome = mockup.frame?.chrome
  if (kind === 'device')
    return `${content} on ${getMockupDefinition(mockup.definitionId)?.name ?? 'a device'}`
  if (kind === 'browser') return `${content} in ${BROWSER_LABELS[chrome?.browser ?? 'chrome']}`
  if (kind === 'window') return `${content} in ${WINDOW_LABELS[chrome?.window ?? 'macos']}`
  return content
}
