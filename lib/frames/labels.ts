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

/** What holds a screen, in a word or two: "Chrome", "macOS Terminal", "iPad Pro 13-inch". */
export function frameLabel(mockup: Pick<Mockup, 'definitionId' | 'frame'>): string {
  const kind = screenFrameKind(mockup)
  const chrome = mockup.frame?.chrome
  if (kind === 'device') return getMockupDefinition(mockup.definitionId)?.name ?? 'Device'
  if (kind === 'browser') return BROWSER_LABELS[chrome?.browser ?? 'chrome']
  if (kind === 'window') return WINDOW_LABELS[chrome?.window ?? 'macos']
  return FRAME_KIND_LABELS.none
}

/** What a screen shows: its file name, or "Code" or "Screenshot". */
export function contentLabel(mockup: Pick<Mockup, 'screen'>): string {
  if (mockup.screen.code) return 'Code'
  return mockup.screen.name?.trim() || 'Screenshot'
}

/** What a screen is, for the Frame panel: "Code in macOS Terminal". */
export function screenLabel(mockup: Pick<Mockup, 'definitionId' | 'frame' | 'screen'>): string {
  const content = mockup.screen.code ? 'Code' : 'Screenshot'
  const kind = screenFrameKind(mockup)
  if (kind === 'none') return content
  return `${content} ${kind === 'device' ? 'on' : 'in'} ${frameLabel(mockup)}`
}
