'use client'

import type { ReactNode } from 'react'
import { chromeContentRect } from '@/lib/frames/geometry'
import type { FrameChrome, Tone } from '@/lib/frames/schema'
import { browserBackground, BrowserChrome } from './BrowserChrome'
import { windowBackground, WindowChrome } from './WindowChrome'

/**
 * A browser or window frame filling a box, with its content placed where the
 * frame's geometry says. The one renderer for chrome: the main screenshot,
 * composition screens, previews, and exports all draw through it.
 */
export function ChromeFrame({
  children,
  contentBackground,
  frame,
  height,
  radius,
  scale = 1,
  tone,
  width,
}: {
  children: ReactNode
  /** Behind the content, and the window color of a minimal terminal. */
  contentBackground?: string
  frame: { chrome: FrameChrome; kind: 'browser' | 'window' }
  height: number
  /** Outer corner radius in px; defaults to the frame's own. */
  radius?: number
  /** Chrome size multiplier (the main screenshot's header size). */
  scale?: number
  tone: Tone
  width: number
}) {
  const { chrome, kind } = frame
  const content = chromeContentRect(kind, chrome, { height, width, x: 0, y: 0 }, scale)
  const unit = content.unit
  const insets = {
    bottom: height - content.y - content.height,
    left: content.x,
    right: width - content.x - content.width,
    top: content.y,
  }
  const dark = tone === 'dark'
  const isArc = kind === 'browser' && chrome.browser === 'arc'
  const outer = radius ?? unit * (kind === 'window' && chrome.window === 'windows' ? 0.8 : 1.1)
  const inner = isArc ? Math.max(0, Math.min(outer, unit * 0.8)) : Math.max(0, outer - insets.left)
  const background =
    kind === 'browser'
      ? browserBackground(chrome, tone)
      : chrome.window === 'terminal-minimal' && contentBackground
        ? contentBackground
        : windowBackground(chrome, tone)

  return (
    <div
      data-frame-box={kind}
      data-tone={tone}
      style={{
        background,
        borderRadius: outer,
        height,
        overflow: 'hidden',
        position: 'relative',
        width,
      }}
    >
      {kind === 'browser' ? (
        <BrowserChrome chrome={chrome} insets={insets} tone={tone} unit={unit} />
      ) : (
        <WindowChrome chrome={chrome} height={insets.top} tone={tone} unit={unit} />
      )}
      <div
        data-frame-screen="true"
        style={{
          background: contentBackground,
          borderRadius: isArc ? inner : `0 0 ${inner}px ${inner}px`,
          boxShadow: isArc
            ? `0 ${unit * 0.15}px ${unit * 0.8}px rgba(0,0,0,${dark ? 0.4 : 0.14})`
            : undefined,
          height: content.height,
          left: content.x,
          overflow: 'hidden',
          position: 'absolute',
          top: content.y,
          width: content.width,
        }}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        style={{
          borderRadius: outer,
          boxShadow: `inset 0 0 0 1px ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`,
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
        }}
      />
    </div>
  )
}
