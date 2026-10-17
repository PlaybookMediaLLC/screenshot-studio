/**
 * The audio track of a video export: the timeline's mix encoded with
 * WebCodecs (AAC for MP4, Opus for WebM), or written as WAV for FFmpeg to
 * encode when the browser has no audio encoder for the container.
 */

/** The audio codec each video container carries. */
export const AUDIO_CODECS = { mp4: 'mp4a.40.2', webm: 'opus' } as const

/** A container that carries audio. */
export type AudioContainer = keyof typeof AUDIO_CODECS

const AUDIO_BITRATE = 192_000
/** Frames per AudioData handed to the encoder. */
const CHUNK_FRAMES = 4096

/** True when this browser can encode `buffer`-shaped audio for `container` with WebCodecs. */
export async function isAudioEncodingSupported(
  container: AudioContainer,
  shape: { numberOfChannels: number; sampleRate: number }
): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false
  try {
    const { supported } = await AudioEncoder.isConfigSupported({
      bitrate: AUDIO_BITRATE,
      codec: AUDIO_CODECS[container],
      numberOfChannels: shape.numberOfChannels,
      sampleRate: shape.sampleRate,
    })
    return supported === true
  } catch {
    return false
  }
}

/**
 * Encode a mixed buffer for `container`, handing each chunk to `onChunk`
 * (a muxer). Timestamps start at 0 and follow the samples exactly, so the
 * audio lines up with video frames timed from 0.
 */
export async function encodeAudioBuffer(
  buffer: AudioBuffer,
  container: AudioContainer,
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void
): Promise<void> {
  let failure: Error | null = null
  const encoder = new AudioEncoder({
    error: (error) => {
      failure = error
    },
    output: (chunk, meta) => onChunk(chunk, meta),
  })
  try {
    encoder.configure({
      bitrate: AUDIO_BITRATE,
      codec: AUDIO_CODECS[container],
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    })
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index)
    )
    for (let offset = 0; offset < buffer.length; offset += CHUNK_FRAMES) {
      if (failure) throw failure
      const frames = Math.min(CHUNK_FRAMES, buffer.length - offset)
      const planar = new Float32Array(frames * channels.length)
      channels.forEach((channel, index) =>
        planar.set(channel.subarray(offset, offset + frames), index * frames)
      )
      const data = new AudioData({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: channels.length,
        numberOfFrames: frames,
        sampleRate: buffer.sampleRate,
        timestamp: Math.round((offset / buffer.sampleRate) * 1_000_000),
      })
      encoder.encode(data)
      data.close()
    }
    await encoder.flush()
    if (failure) throw failure
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
}

/** A buffer as a 16-bit PCM WAV file, for FFmpeg to read. */
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const bytesPerSample = 2
  const dataSize = frames * channels * bytesPerSample
  const out = new DataView(new ArrayBuffer(44 + dataSize))
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      out.setUint8(at + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  out.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, channels, true)
  out.setUint32(24, buffer.sampleRate, true)
  out.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true)
  out.setUint16(32, channels * bytesPerSample, true)
  out.setUint16(34, bytesPerSample * 8, true)
  text(36, 'data')
  out.setUint32(40, dataSize, true)
  const data = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index))
  let at = 44
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of data) {
      const sample = Math.max(-1, Math.min(1, channel[frame]!))
      out.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      at += bytesPerSample
    }
  }
  return new Uint8Array(out.buffer)
}
