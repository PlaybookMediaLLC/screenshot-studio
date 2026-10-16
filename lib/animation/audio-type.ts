import type { AudioMimeType } from './motion-schema'

/** Other names browsers and systems give the audio formats the editor accepts. */
const MIME_ALIASES: Record<string, AudioMimeType> = {
  'audio/aac': 'audio/aac',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/mpeg': 'audio/mpeg',
  'audio/ogg': 'audio/ogg',
  'audio/vnd.wave': 'audio/wav',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/webm': 'audio/webm',
  'audio/x-aac': 'audio/aac',
  'audio/x-m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
}

const EXTENSIONS: Record<string, AudioMimeType> = {
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  webm: 'audio/webm',
}

/**
 * The accepted audio type of a file, from its MIME type or, when the system
 * gives none, its extension. Null for anything else.
 */
export function normalizeAudioType(mimeType: string, fileName: string): AudioMimeType | null {
  const byType = MIME_ALIASES[mimeType.toLowerCase().split(';')[0]!.trim()]
  if (byType) return byType
  if (mimeType && !mimeType.startsWith('audio/') && mimeType !== 'application/octet-stream')
    return null
  return EXTENSIONS[fileName.toLowerCase().split('.').pop() ?? ''] ?? null
}
