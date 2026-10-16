'use client'

import { decodeAudioSource } from '@/lib/animation/audio-mix'
import { normalizeAudioType } from '@/lib/animation/audio-type'
import { addAudioClip, newMotionId } from '@/lib/animation/motion-commands'
import { MAX_AUDIO_BYTES } from '@/lib/animation/motion-schema'
import { useImageStore } from '@/lib/store'
import { usePlaybackStore } from '@/lib/store/playback'

/** Why an audio file was refused, in words for the user. */
export class AudioImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioImportError'
  }
}

/**
 * Put an audio file on the timeline at the playhead. The file must be a
 * supported audio type under the asset size limit and must decode, so a
 * clip on the timeline always plays and exports. Like an imported image it
 * stays a local `blob:` URL until a save uploads it as a workspace asset.
 */
export async function importAudioFile(file: File): Promise<string> {
  const type = normalizeAudioType(file.type, file.name)
  if (!type) throw new AudioImportError('Choose an MP3, M4A/AAC, WAV, Ogg, or WebM audio file.')
  if (file.size > MAX_AUDIO_BYTES) {
    throw new AudioImportError(`Choose an audio file under ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`)
  }
  const src = URL.createObjectURL(new Blob([file], { type }))
  let sourceDuration: number
  try {
    // Any context decodes; the buffer is cached for playback and export.
    const buffer = await decodeAudioSource(src, new OfflineAudioContext(1, 1, 48_000))
    sourceDuration = Math.round(buffer.duration * 1000)
  } catch (error) {
    URL.revokeObjectURL(src)
    throw new AudioImportError(
      error instanceof Error ? error.message : 'The audio file could not be read.'
    )
  }
  if (sourceDuration < 1) {
    URL.revokeObjectURL(src)
    throw new AudioImportError('The audio file has no sound in it.')
  }
  const id = newMotionId('audio')
  const { duration } = useImageStore.getState().timeline
  const playhead = Math.round(usePlaybackStore.getState().playhead)
  // At the very end of the timeline the clip would be cut to nothing; start it at 0.
  const start = playhead < duration - 250 ? playhead : 0
  useImageStore.getState().updateMotion((motion) =>
    addAudioClip(motion, {
      gain: 1,
      id,
      muted: false,
      name: file.name.slice(0, 200),
      sourceDuration,
      src,
      start,
      trimEnd: Math.min(sourceDuration, Math.max(1, duration - start)),
      trimStart: 0,
    })
  )
  return id
}
