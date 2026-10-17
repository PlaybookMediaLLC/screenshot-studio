'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { useImageStore } from '@/lib/store'
import { usePlaybackStore } from '@/lib/store/playback'
import { decodeAudioSource, planAudioMix, scheduleFrom } from './audio-mix'

/** How far the audio may drift from the playhead before it is restarted there, in seconds. */
const RESYNC_SECONDS = 0.12

/**
 * Play the timeline's audio in sync with the playhead. The playhead is the
 * master clock: audio is scheduled from it with Web Audio when playback
 * starts, and rescheduled when the playhead jumps (a seek, a loop) or the
 * clips change, so what is heard always matches what the canvas shows.
 * Clips use the same mix plan as the exported video.
 */
export function useAudioPlayback() {
  useEffect(() => {
    let context: AudioContext | null = null
    let playing: { from: number; nodes: AudioBufferSourceNode[]; startedAt: number } | null = null
    let generation = 0

    const stop = () => {
      generation++
      for (const node of playing?.nodes ?? []) {
        try {
          node.stop()
        } catch {
          // A node that never started has nothing to stop.
        }
        node.disconnect()
      }
      playing = null
    }

    const start = async () => {
      stop()
      const run = generation
      const { motion, timeline } = useImageStore.getState()
      const plan = planAudioMix(motion.audio, timeline.duration)
      if (plan.length === 0) return
      // Created inside the play gesture, so the browser lets it make sound.
      context ??= new AudioContext()
      const audio = context
      if (audio.state === 'suspended') void audio.resume()
      let buffers: AudioBuffer[]
      try {
        buffers = await Promise.all(plan.map((segment) => decodeAudioSource(segment.src, audio)))
      } catch (error) {
        toast.error('Audio could not play', {
          description:
            error instanceof Error ? error.message : 'Check the audio files on the timeline.',
          id: 'audio-playback',
        })
        return
      }
      const playback = usePlaybackStore.getState()
      if (run !== generation || !playback.isPlaying) return
      const from = playback.playhead / 1000
      const now = audio.currentTime
      const nodes = scheduleFrom(plan, from).map((segment) => {
        const source = audio.createBufferSource()
        source.buffer = buffers[plan.findIndex((item) => item.clipId === segment.clipId)]!
        const gain = audio.createGain()
        gain.gain.value = segment.gain
        source.connect(gain).connect(audio.destination)
        source.start(now + segment.delay, segment.offset, segment.duration)
        return source
      })
      playing = { from, nodes, startedAt: now }
    }

    const stopPlayback = usePlaybackStore.subscribe((state, previous) => {
      if (state.isPlaying !== previous.isPlaying) {
        if (state.isPlaying) void start()
        else stop()
        return
      }
      if (!state.isPlaying || !playing || !context) return
      const expected = playing.from + (context.currentTime - playing.startedAt)
      if (Math.abs(state.playhead / 1000 - expected) > RESYNC_SECONDS) void start()
    })
    const stopEdits = useImageStore.subscribe((state, previous) => {
      const changed =
        state.motion.audio !== previous.motion.audio ||
        state.timeline.duration !== previous.timeline.duration
      if (changed && usePlaybackStore.getState().isPlaying) void start()
    })

    return () => {
      stopPlayback()
      stopEdits()
      stop()
      void context?.close()
    }
  }, [])
}
