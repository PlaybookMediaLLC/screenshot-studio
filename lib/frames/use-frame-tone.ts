'use client'

import { useEffect } from 'react'
import { type ImageState, useImageStore } from '@/lib/store'
import { sampleImageTone } from './appearance'
import { isChromeFrameType } from './main-frame'
import type { Tone } from './schema'

/**
 * Keep `auto` chrome in step with its screenshot: whenever a framed image
 * changes, sample its top rows and store the tone on the frame. Rendering
 * reads the stored tone, so previews and exports never sample, and the
 * write stays out of undo history because it only restates the image.
 */

/** A framed image whose chrome follows it: the main screenshot (`id` null) or a screen. */
type ToneTarget = { id: string | null; src: string; tone: Tone | undefined }

function toneTargets(state: ImageState): ToneTarget[] {
  const targets: ToneTarget[] = []
  const { frameChrome, imageBorder, uploadedImageUrl } = state
  if (
    uploadedImageUrl &&
    imageBorder.enabled &&
    isChromeFrameType(imageBorder.type) &&
    frameChrome.appearance === 'auto'
  ) {
    targets.push({ id: null, src: uploadedImageUrl, tone: frameChrome.tone })
  }
  for (const mockup of state.mockups) {
    const chrome = mockup.frame?.chrome
    const kind = mockup.frame?.kind
    if (
      (kind !== 'browser' && kind !== 'window') ||
      chrome?.appearance !== 'auto' ||
      mockup.screen.code
    )
      continue
    const src = mockup.screen.src ?? uploadedImageUrl
    if (src) targets.push({ id: mockup.id, src, tone: chrome.tone })
  }
  return targets
}

const keyOf = (target: ToneTarget) =>
  `${target.id}:${target.src.length}:${target.src.slice(-48)}:${target.tone ?? ''}`

function writeTone(target: ToneTarget, tone: Tone) {
  const history = useImageStore.temporal.getState()
  history.pause()
  try {
    useImageStore.setState((state) => {
      if (target.id === null) {
        return state.uploadedImageUrl === target.src
          ? { frameChrome: { ...state.frameChrome, tone } }
          : {}
      }
      return {
        mockups: state.mockups.map((mockup) =>
          mockup.id === target.id && mockup.frame?.chrome
            ? { ...mockup, frame: { ...mockup.frame, chrome: { ...mockup.frame.chrome, tone } } }
            : mockup
        ),
      }
    })
  } finally {
    history.resume()
  }
}

/** Sample and store the tone of every image under `auto` chrome. */
export function useFrameToneSync() {
  const key = useImageStore((state) => toneTargets(state).map(keyOf).join('|'))
  useEffect(() => {
    if (!key) return
    let active = true
    for (const target of toneTargets(useImageStore.getState())) {
      void sampleImageTone(target.src).then((tone) => {
        if (active && tone !== target.tone) writeTone(target, tone)
      })
    }
    return () => {
      active = false
    }
  }, [key])
}
