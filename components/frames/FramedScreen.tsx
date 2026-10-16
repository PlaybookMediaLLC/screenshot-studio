'use client'

import type { KeyboardEventHandler, PointerEventHandler } from 'react'
import { DeviceShell, Screen } from '@/components/mockups/DeviceShell'
import { getMockupDefinition } from '@/lib/constants/mockups'
import { resolveAppearance } from '@/lib/frames/appearance'
import { CODE_THEMES } from '@/lib/frames/code'
import { frameScreenRect, screenFrameSpec } from '@/lib/frames/geometry'
import type { Mockup } from '@/types/mockup'
import { ChromeFrame } from './ChromeFrame'
import { CodeScreen } from './CodeScreen'

/** What a screen does when it is clicked, dropped on, or cropped, and where its image sits. */
export type ScreenHandlers = {
  editing?: boolean
  screenFilter?: string
  /** Where a scroll-through has the image inside the screen (CSS object-position). */
  screenObjectPosition?: string
  onScreenClick?: () => void
  onScreenDoubleClick?: () => void
  onScreenFile?: (file: File) => void
  onScreenPointerDown?: PointerEventHandler<HTMLDivElement>
  onScreenKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

/**
 * One composition screen in its frame, filling a `width` × `height` box:
 * a device, browser or window chrome, or a bare rounded screenshot. Its
 * content is the screen's image or its code.
 */
export function FramedScreen({
  handlers = {},
  height,
  mockup,
  width,
}: {
  handlers?: ScreenHandlers
  height: number
  mockup: Mockup
  width: number
}) {
  const frame = screenFrameSpec(mockup)
  const screenRect = frameScreenRect(frame, { height, width, x: 0, y: 0 })
  const { code } = mockup.screen
  const content = code ? (
    <CodeScreen content={code} height={screenRect.height} width={screenRect.width} />
  ) : undefined
  const shadow = `drop-shadow(0 ${height * 0.012}px ${height * 0.03}px rgba(0,0,0,0.28))`

  if (frame.kind === 'device') {
    const definition = getMockupDefinition(frame.definitionId)
    if (!definition) return null
    return (
      <DeviceShell
        color={mockup.color}
        content={content}
        definition={definition}
        editing={handlers.editing}
        onScreenClick={handlers.onScreenClick}
        onScreenDoubleClick={handlers.onScreenDoubleClick}
        onScreenFile={handlers.onScreenFile}
        onScreenKeyDown={handlers.onScreenKeyDown}
        onScreenPointerDown={handlers.onScreenPointerDown}
        orientation={mockup.orientation}
        screen={mockup.screen}
        screenFilter={handlers.screenFilter}
        screenObjectPosition={handlers.screenObjectPosition}
      />
    )
  }

  const screen = (
    <Screen
      editing={handlers.editing ?? false}
      filter={handlers.screenFilter}
      objectPosition={handlers.screenObjectPosition}
      onClick={handlers.onScreenClick}
      onCropKeyDown={handlers.onScreenKeyDown}
      onDoubleClick={handlers.onScreenDoubleClick}
      onFile={handlers.onScreenFile}
      onPointerDown={handlers.onScreenPointerDown}
      screen={mockup.screen}
      style={{ inset: 0 }}
    >
      {content}
    </Screen>
  )

  if (frame.kind === 'none') {
    return (
      <div style={{ filter: shadow, height, position: 'relative', width }}>
        <div
          style={{
            borderRadius: Math.min(width, height) * 0.025,
            height,
            overflow: 'hidden',
            position: 'relative',
            width,
          }}
        >
          {screen}
        </div>
      </div>
    )
  }

  const theme = code ? CODE_THEMES[code.theme] : null
  return (
    <div style={{ filter: shadow, height, width }}>
      <ChromeFrame
        contentBackground={theme?.background}
        frame={frame}
        height={height}
        tone={resolveAppearance(frame.chrome.appearance, theme?.tone ?? frame.chrome.tone)}
        width={width}
      >
        {screen}
      </ChromeFrame>
    </div>
  )
}
