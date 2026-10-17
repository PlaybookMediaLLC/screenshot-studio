'use client'

import { useMemo } from 'react'
import { useImageStore } from '@/lib/store'
import { usePlaybackStore } from '@/lib/store/playback'
import { evaluateImageMotion, type ImageMotionValues } from './evaluate'

/** The main image's values at the playhead, for drawing. Never written back. */
export function useImageMotion(): ImageMotionValues {
  const playhead = usePlaybackStore((state) => state.playhead)
  const perspective3D = useImageStore((state) => state.perspective3D)
  const imageOpacity = useImageStore((state) => state.imageOpacity)
  const animationClips = useImageStore((state) => state.animationClips)
  const tracks = useImageStore((state) => state.timeline.tracks)
  return useMemo(
    () => evaluateImageMotion({ animationClips, imageOpacity, perspective3D, tracks }, playhead),
    [animationClips, imageOpacity, perspective3D, playhead, tracks]
  )
}

/** The same values read once, for export code running outside React. */
export function currentImageMotion(): ImageMotionValues {
  const state = useImageStore.getState()
  return evaluateImageMotion(
    {
      animationClips: state.animationClips,
      imageOpacity: state.imageOpacity,
      perspective3D: state.perspective3D,
      tracks: state.timeline.tracks,
    },
    usePlaybackStore.getState().playhead
  )
}
