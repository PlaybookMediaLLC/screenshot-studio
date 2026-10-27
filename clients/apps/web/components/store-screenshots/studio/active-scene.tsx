'use client'

import * as React from 'react'
import type { StoreSlideV2 } from '@/lib/store-screenshots/document/schema'
import type { Scene } from '@/lib/store-screenshots/engine/scene'
import { getStoreTargetOrDefault, targetPixelSize, type PixelSize, type StoreTarget } from '@/lib/store-screenshots/targets'
import { useSlideScene } from '../render/RenderProvider'
import { useEditor } from './editor-store'

/** The active slide evaluated once for the canvas and the inspector. */
export type ActiveScene = { scene: Scene | null; slide: StoreSlideV2; index: number; size: PixelSize; target: StoreTarget }

const ActiveSceneContext = React.createContext<ActiveScene | null>(null)

/** Evaluate the active slide at the canvas target size and share it. */
export function ActiveSceneProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const document = useEditor((state) => state.document)
  const activeSlideId = useEditor((state) => state.activeSlideId)
  const locale = useEditor((state) => state.locale)
  const targetId = useEditor((state) => state.targetId)
  const index = Math.max(0, document.slides.findIndex((slide) => slide.id === activeSlideId))
  const target = getStoreTargetOrDefault(targetId)
  const size = targetPixelSize(target)
  const scene = useSlideScene(document, index, { size, targetId, locale })
  const slide = document.slides[index]
  const value = React.useMemo(() => ({ scene, slide, index, size, target }), [scene, slide, index, size, target])
  return <ActiveSceneContext.Provider value={value}>{children}</ActiveSceneContext.Provider>
}

/** The shared active-slide scene. */
export function useActiveScene(): ActiveScene {
  const context = React.useContext(ActiveSceneContext)
  if (!context) throw new Error('useActiveScene must be used inside <ActiveSceneProvider>.')
  return context
}
