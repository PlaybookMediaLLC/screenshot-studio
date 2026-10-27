'use client'

import type { FrameChrome, Tone } from '@/lib/frames/schema'
import { CHROME_FONT, Glyph, oneLine, TrafficLights, WindowControls } from './chrome-parts'

/**
 * Application and terminal window chrome: a macOS window, a Windows 11
 * window, a macOS Terminal, Windows Terminal, and a minimal terminal. It
 * draws the title bar over a frame box whose content area the caller fills.
 */

/** The window's own background, behind its title bar. */
export function windowBackground(chrome: FrameChrome, tone: Tone): string {
  const dark = tone === 'dark'
  switch (chrome.window) {
    case 'windows':
    case 'terminal-windows':
      return dark ? '#202020' : '#f3f3f3'
    case 'terminal-macos':
      return dark ? '#2a2a2a' : '#e8e8e8'
    case 'terminal-minimal':
      return dark ? '#1b1b1f' : '#fbfbfb'
    default:
      return dark ? '#2d2d2d' : '#ebebeb'
  }
}

function defaultTitle(chrome: FrameChrome): string {
  if (chrome.title) return chrome.title
  return chrome.window === 'terminal-windows'
    ? 'PowerShell'
    : chrome.window.startsWith('terminal')
      ? 'zsh'
      : 'Untitled'
}

/** The title bar of one window style, drawn over its frame box. */
export function WindowChrome({
  chrome,
  height,
  tone,
  unit,
}: {
  chrome: FrameChrome
  height: number
  tone: Tone
  unit: number
}) {
  const dark = tone === 'dark'
  const text = dark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)'
  const muted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)'
  const title = defaultTitle(chrome)
  const bar = {
    alignItems: 'center',
    background: windowBackground(chrome, tone),
    borderBottom: `1px solid ${border}`,
    boxSizing: 'border-box',
    display: 'flex',
    height,
    position: 'relative',
  } as const

  const body = (() => {
    switch (chrome.window) {
      case 'windows':
        return (
          <div style={{ ...bar, borderBottom: 'none', paddingLeft: unit * 1.3 }}>
            <svg
              aria-hidden="true"
              height={unit * 1.3}
              viewBox="0 0 16 16"
              width={unit * 1.3}
              style={{ flexShrink: 0 }}
            >
              <rect fill="#0a84ff" height="7" rx="1" width="7" x="0.5" y="0.5" />
              <rect fill="#30b0ff" height="7" rx="1" width="7" x="8.5" y="0.5" />
              <rect fill="#30b0ff" height="7" rx="1" width="7" x="0.5" y="8.5" />
              <rect fill="#0a84ff" height="7" rx="1" width="7" x="8.5" y="8.5" />
            </svg>
            <span
              style={{
                color: text,
                flex: 1,
                fontSize: unit * 1.05,
                marginLeft: unit * 0.9,
                ...oneLine,
              }}
            >
              {title}
            </span>
            <WindowControls color={text} height={height} unit={unit} />
          </div>
        )
      case 'terminal-windows':
        return (
          <div
            style={{
              ...bar,
              alignItems: 'flex-end',
              borderBottom: 'none',
              paddingLeft: unit * 0.8,
            }}
          >
            <div
              style={{
                alignItems: 'center',
                background: dark ? '#0c0c0c' : '#ffffff',
                borderRadius: `${unit * 0.6}px ${unit * 0.6}px 0 0`,
                color: text,
                display: 'flex',
                fontSize: unit * 1.05,
                gap: unit * 0.7,
                height: height - unit * 0.6,
                padding: `0 ${unit * 0.9}px`,
                width: unit * 17,
              }}
            >
              <span
                style={{
                  alignItems: 'center',
                  background: '#2671be',
                  borderRadius: unit * 0.2,
                  color: '#fff',
                  display: 'flex',
                  flexShrink: 0,
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  fontSize: unit * 0.8,
                  fontWeight: 700,
                  height: unit * 1.3,
                  justifyContent: 'center',
                  width: unit * 1.3,
                }}
              >
                {'>'}
              </span>
              <span style={{ flex: 1, ...oneLine }}>{title}</span>
              <Glyph color={muted} name="close" size={unit} />
            </div>
            <div
              style={{
                alignItems: 'center',
                alignSelf: 'stretch',
                display: 'flex',
                gap: unit * 0.9,
                marginLeft: unit * 0.9,
              }}
            >
              <Glyph color={text} name="plus" size={unit * 1.3} />
              <Glyph color={text} name="chevronDown" size={unit * 1.2} />
            </div>
            <div style={{ flex: 1 }} />
            <WindowControls color={text} height={height} unit={unit} />
          </div>
        )
      case 'terminal-minimal':
        return (
          <div
            style={{
              ...bar,
              background: 'transparent',
              borderBottom: 'none',
              paddingLeft: unit * 1.2,
            }}
          >
            <TrafficLights muted size={unit * 0.95} />
          </div>
        )
      default: {
        const label = chrome.window === 'terminal-macos' ? `${title} — 80×24` : title
        return (
          <div style={{ ...bar, paddingLeft: unit * 1.2 }}>
            <TrafficLights size={unit * 1.2} />
            <span
              style={{
                color: text,
                fontSize: unit * 1.1,
                fontWeight: 600,
                left: '50%',
                maxWidth: '60%',
                position: 'absolute',
                transform: 'translateX(-50%)',
                ...oneLine,
              }}
            >
              {label}
            </span>
          </div>
        )
      }
    }
  })()

  return (
    <div
      aria-hidden="true"
      data-frame-chrome={chrome.window}
      style={{
        fontFamily: CHROME_FONT,
        left: 0,
        lineHeight: 'normal',
        pointerEvents: 'none',
        position: 'absolute',
        right: 0,
        top: 0,
      }}
    >
      {body}
    </div>
  )
}
