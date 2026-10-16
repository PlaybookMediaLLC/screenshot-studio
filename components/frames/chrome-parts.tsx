'use client'

import type { CSSProperties } from 'react'

/**
 * Small drawing parts shared by browser and window chrome. Sizes are in px,
 * computed by the caller from the frame's chrome unit, so chrome scales with
 * the screenshot it holds.
 */

/** The system UI font every chrome draws its labels with. */
export const CHROME_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif'

const GLYPHS = {
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  folder:
    'M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
  home: 'M4 11l8-6.5 8 6.5V20h-5v-5.5H9V20H4z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  reload: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  share:
    'M12 3.5v11M8 7.5l4-4 4 4M5.5 12.5v6.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-6.5',
  shield: 'M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z',
  sidebar: 'M4 5h16v14H4zM10 5v14',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
  tabs: 'M8 8h12v12H8zM4 16V4h12',
  tune: 'M4 8h9M17 8h3M4 16h3M11 16h9M15 8a2 2 0 1 0 0 .01M9 16a2 2 0 1 0 0 .01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
} as const

/** A line icon by name. */
export type GlyphName = keyof typeof GLYPHS

/** A line icon drawn at `size` px. */
export function Glyph({
  color,
  name,
  size,
  style,
}: {
  color: string
  name: GlyphName
  size: number
  style?: CSSProperties
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      style={{ display: 'block', flexShrink: 0, ...style }}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={GLYPHS[name]} />
    </svg>
  )
}

/** macOS window buttons: close, minimize, zoom. */
export function TrafficLights({ size, muted = false }: { size: number; muted?: boolean }) {
  const colors = muted ? ['#8e8e93', '#8e8e93', '#8e8e93'] : ['#ff5f57', '#febc2e', '#28c840']
  return (
    <div style={{ display: 'flex', flexShrink: 0, gap: size * 0.62 }}>
      {colors.map((color, index) => (
        <span
          key={index}
          style={{
            background: color,
            borderRadius: '50%',
            boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.18)',
            display: 'block',
            height: size,
            opacity: muted ? 0.55 : 1,
            width: size,
          }}
        />
      ))}
    </div>
  )
}

/** Windows 11 caption buttons: minimize, maximize, close. */
export function WindowControls({
  color,
  height,
  unit,
}: {
  color: string
  height: number
  unit: number
}) {
  const glyph = unit * 1.05
  const stroke = Math.max(0.6, unit * 0.09)
  const box: CSSProperties = {
    alignItems: 'center',
    display: 'flex',
    height,
    justifyContent: 'center',
    width: unit * 4.6,
  }
  return (
    <div style={{ display: 'flex', flexShrink: 0 }}>
      <span style={box}>
        <svg aria-hidden="true" height={glyph} viewBox="0 0 10 10" width={glyph}>
          <path d="M0 5h10" stroke={color} strokeWidth={(stroke * 10) / glyph} />
        </svg>
      </span>
      <span style={box}>
        <svg aria-hidden="true" height={glyph} viewBox="0 0 10 10" width={glyph}>
          <rect
            fill="none"
            height="9"
            rx="1.2"
            stroke={color}
            strokeWidth={(stroke * 10) / glyph}
            width="9"
            x="0.5"
            y="0.5"
          />
        </svg>
      </span>
      <span style={box}>
        <svg aria-hidden="true" height={glyph} viewBox="0 0 10 10" width={glyph}>
          <path d="M0 0l10 10M10 0L0 10" stroke={color} strokeWidth={(stroke * 10) / glyph} />
        </svg>
      </span>
    </div>
  )
}

const FAVICON_COLORS = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#e11d48', '#7c3aed', '#0891b2']

/** A tab's site icon: the title's first letter on a colored tile. */
export function Favicon({ size, title }: { size: number; title: string }) {
  const letter = title.trim().charAt(0).toUpperCase() || '•'
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (
    <span
      style={{
        alignItems: 'center',
        background: FAVICON_COLORS[hash % FAVICON_COLORS.length],
        borderRadius: size * 0.25,
        color: '#fff',
        display: 'flex',
        flexShrink: 0,
        fontSize: size * 0.68,
        fontWeight: 700,
        height: size,
        justifyContent: 'center',
        lineHeight: 1,
        width: size,
      }}
    >
      {letter}
    </span>
  )
}

/** Text that never wraps and ends in an ellipsis. */
export const oneLine: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** A browser's tab titles, never empty: no tabs means one tab named after the page. */
export function tabTitles(tabs: readonly string[], address: string): string[] {
  if (tabs.length > 0) return tabs.map((title) => title || 'New Tab')
  const host = address.replace(/^https?:\/\//, '').split('/')[0]
  return [host || 'New Tab']
}

/** The host shown in compact address fields. */
export function hostOf(address: string): string {
  return address.replace(/^https?:\/\//, '').replace(/\/$/, '')
}
