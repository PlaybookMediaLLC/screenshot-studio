'use client'

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  isScreenScene,
  type ScreenFrameChange,
  setMainChrome,
  setMainFrame,
  setScreensFrame,
  showMainOnDevice,
} from '@/lib/frames/commands'
import { mainFrameSpec } from '@/lib/frames/main-frame'
import { DEFAULT_FRAME_CHROME, type FrameChrome, type FrameKind } from '@/lib/frames/schema'
import { useImageStore } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import type { Mockup } from '@/types/mockup'

/**
 * What the Frame panel edits: the main screenshot, or in a composition the
 * selected screen (every screen when none is selected). The panel shows the
 * target's frame and sends every change through the frame commands.
 */

/** The panel's frame choices; `style` is the main screenshot's border styles, or no frame for a screen. */
export type FrameChoice = 'style' | 'browser' | 'window' | 'device'

/** The Frame panel's target. */
export type FrameTarget = {
  chrome: FrameChrome
  choice: FrameChoice
  /** The screens edited, or empty for the main screenshot. */
  screens: Mockup[]
  /** True when one screen is selected, rather than every screen. */
  single: boolean
}

const toChoice = (kind: FrameKind): FrameChoice => (kind === 'none' ? 'style' : kind)

/** The Frame panel's current target. */
export function useFrameTarget(): FrameTarget {
  const selectedId = useDeviceUIStore((state) => state.selectedDeviceId)
  const { browserUrl, editorMode, frameChrome, imageBorder, mockups } = useImageStore(
    useShallow((state) => ({
      browserUrl: state.browserUrl,
      editorMode: state.editorMode,
      frameChrome: state.frameChrome,
      imageBorder: state.imageBorder,
      mockups: state.mockups,
    }))
  )
  return useMemo(() => {
    if (isScreenScene({ editorMode, mockups })) {
      const selected = mockups.find((mockup) => mockup.id === selectedId)
      const screens = selected ? [selected] : mockups
      const first = screens[0]!
      return {
        chrome: first.frame?.chrome ?? DEFAULT_FRAME_CHROME,
        choice: toChoice(first.frame?.kind ?? 'device'),
        screens,
        single: Boolean(selected),
      }
    }
    const spec = mainFrameSpec(imageBorder, frameChrome, browserUrl)
    const hasChrome = spec.kind === 'browser' || spec.kind === 'window'
    return {
      chrome: hasChrome ? spec.chrome : { ...frameChrome, address: browserUrl },
      choice: editorMode === 'device' ? 'device' : hasChrome ? spec.kind : 'style',
      screens: [],
      single: true,
    }
  }, [browserUrl, editorMode, frameChrome, imageBorder, mockups, selectedId])
}

const ids = (target: FrameTarget) => target.screens.map((screen) => screen.id)

/** Switch the target's frame kind. */
export function chooseFrame(target: FrameTarget, choice: FrameChoice) {
  if (target.screens.length > 0) {
    setScreensFrame(ids(target), { kind: choice === 'style' ? 'none' : choice })
    return
  }
  if (choice === 'device') useImageStore.getState().setEditorMode('device')
  else setMainFrame(choice === 'style' ? 'screenshot' : choice)
}

/** Change the target's browser or window options. */
export function changeChrome(target: FrameTarget, changes: Partial<FrameChrome>) {
  if (target.screens.length > 0) setScreensFrame(ids(target), { chrome: changes })
  else setMainChrome(changes)
}

/** Put the target on a device, or change its device's color or orientation. */
export function changeDevice(
  target: FrameTarget,
  change: Omit<ScreenFrameChange, 'chrome' | 'kind'>
) {
  if (target.screens.length > 0) setScreensFrame(ids(target), { ...change, kind: 'device' })
  else if (change.definitionId) void showMainOnDevice(change.definitionId)
}
