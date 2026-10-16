'use client'

import { useMemo } from 'react'
import type { MainChromeFrame } from '@/components/canvas/html/HTMLMainImageLayer'
import { resolveAppearance } from '@/lib/frames/appearance'
import { mainFrameSpec } from '@/lib/frames/main-frame'
import { useImageStore } from '@/lib/store'

/** The main screenshot's browser or window chrome and the tone it draws in, or null. */
export function useMainChromeFrame(): MainChromeFrame | null {
  const enabled = useImageStore((state) => state.imageBorder.enabled)
  const type = useImageStore((state) => state.imageBorder.type)
  const chrome = useImageStore((state) => state.frameChrome)
  const address = useImageStore((state) => state.browserUrl)
  return useMemo(() => {
    const spec = mainFrameSpec({ enabled, type }, chrome, address)
    if (spec.kind !== 'browser' && spec.kind !== 'window') return null
    return { ...spec, tone: resolveAppearance(spec.chrome.appearance, spec.chrome.tone) }
  }, [address, chrome, enabled, type])
}
