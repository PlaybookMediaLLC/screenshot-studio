'use client'

import { useMemo } from 'react'
import { useImageStore } from '@/lib/store'
import { usePlaybackStore } from '@/lib/store/playback'
import {
  captionsAt,
  hasLayerTracks,
  IDENTITY_MOTION,
  type LayerMotion,
  layerMotionAt,
  revealedUnits,
  revealUnits,
  scrollProgressAt,
} from './motion-evaluate'
import type { CaptionItem, MotionTarget, ScrollMotion, TextReveal } from './motion-schema'
import { sameScrollTarget } from './motion-commands'

/**
 * The canvas's view of motion: each layer reads its own values at the
 * playhead. Layers that nothing animates do not subscribe to the playhead,
 * so playback re-renders only what moves.
 */

/** The main image, as a motion and scroll target. */
export const MAIN_IMAGE_TARGET = { kind: 'image' } as const

/** The playhead, or 0 without subscribing when `active` is false. */
function useMotionClock(active: boolean): number {
  return usePlaybackStore((state) => (active ? state.playhead : 0))
}

/** A layer's keyframed values at the playhead; the identity when nothing animates it. */
export function useLayerMotion(target: MotionTarget): LayerMotion {
  const tracks = useImageStore((state) => state.motion.layerTracks)
  const active = useMemo(() => hasLayerTracks(tracks, target), [tracks, target])
  const time = useMotionClock(active)
  return useMemo(
    () => (active ? layerMotionAt(tracks, target, time) : IDENTITY_MOTION),
    [active, target, time, tracks]
  )
}

/** Every layer of one kind's values at the playhead, by layer id, for layers drawn in one list. */
export function useLayerMotions(
  kind: Exclude<MotionTarget['kind'], 'image'>
): Record<string, LayerMotion> {
  const tracks = useImageStore((state) => state.motion.layerTracks)
  const active = useMemo(() => tracks.some((track) => track.target.kind === kind), [kind, tracks])
  const time = useMotionClock(active)
  return useMemo(() => {
    const motions: Record<string, LayerMotion> = {}
    if (!active) return motions
    for (const track of tracks) {
      if (track.target.kind !== kind) continue
      const id = track.target.id
      motions[id] ??= layerMotionAt(tracks, track.target, time)
    }
    return motions
  }, [active, kind, time, tracks])
}

/** What a text's reveal shows at the playhead, or null when the text has no reveal. */
export function useTextReveal(
  textId: string,
  text: string
): { mode: TextReveal['mode']; revealed: number; units: string[] } | null {
  const reveal = useImageStore((state) =>
    state.motion.reveals.find((item) => item.targetId === textId)
  )
  const time = useMotionClock(Boolean(reveal))
  const units = useMemo(() => (reveal ? revealUnits(text, reveal.mode) : []), [reveal, text])
  if (!reveal) return null
  return { mode: reveal.mode, revealed: revealedUnits(reveal, units.length, time), units }
}

/** A layer's scroll-through and its position at the playhead, or null when it does not scroll. */
export function useScroll(
  target: ScrollMotion['target']
): { progress: number; scroll: ScrollMotion } | null {
  const scroll = useImageStore((state) =>
    state.motion.scrolls.find((item) => sameScrollTarget(item.target, target))
  )
  const time = useMotionClock(Boolean(scroll))
  return scroll ? { progress: scrollProgressAt(scroll, time), scroll } : null
}

/** The captions showing at the playhead. */
export function useActiveCaptions(): CaptionItem[] {
  const captions = useImageStore((state) => state.motion.captions)
  const time = useMotionClock(captions.items.length > 0)
  return useMemo(() => captionsAt(captions, time), [captions, time])
}
