'use client'

import { create } from 'zustand'
import { useImageStore } from './index'

/**
 * Where the timeline is and whether it plays. Session state: it is never saved
 * with a design and never undone, and the canvas reads it to evaluate motion
 * without writing animated values back into the document.
 */
export interface PlaybackState {
  /** Milliseconds from the start of the timeline. */
  playhead: number
  isPlaying: boolean
  /** Move the playhead, clamped to the timeline. */
  seek: (time: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  playhead: 0,
  isPlaying: false,
  seek: (time) => {
    const { duration } = useImageStore.getState().timeline
    set({ playhead: Math.max(0, Math.min(Number.isFinite(time) ? time : 0, duration)) })
  },
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  toggle: () => set((state) => ({ isPlaying: !state.isPlaying })),
}))

/** Stop and rewind, for a new or reset timeline. */
export function resetPlayback(options: { play?: boolean } = {}) {
  usePlaybackStore.setState({ playhead: 0, isPlaying: options.play ?? false })
}
