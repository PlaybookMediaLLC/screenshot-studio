'use client'

import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Platform overlays that mark where a platform's own UI covers the image. */
export const safeZoneSchema = z.enum([
  'none',
  'instagram-story',
  'instagram-reel',
  'tiktok',
  'youtube-shorts',
  'app-store-iphone',
  'x-feed-crop',
])
/** A safe-zone overlay. */
export type SafeZone = z.infer<typeof safeZoneSchema>

/** Snapping and composition guides. A preference: kept across sessions, never in a design. */
export interface CanvasGuidesState {
  snapping: boolean
  /** Distance in stage px within which a dragged edge or centre snaps. */
  snapTolerance: number
  snapToCanvas: boolean
  snapToObjects: boolean
  showThirds: boolean
  safeZone: SafeZone
  /** Draw guides into exported files too; off by default. */
  guidesInExport: boolean
  setGuides: (changes: Partial<Omit<CanvasGuidesState, 'setGuides'>>) => void
}

/** Snapping and guide preferences. */
export const useCanvasGuides = create<CanvasGuidesState>()(
  persist(
    (set) => ({
      guidesInExport: false,
      safeZone: 'none',
      setGuides: (changes) => set(changes),
      showThirds: false,
      snapToCanvas: true,
      snapToObjects: true,
      snapTolerance: 6,
      snapping: true,
    }),
    { name: 'editor-canvas-guides' }
  )
)
