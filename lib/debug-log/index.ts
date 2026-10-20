import { z } from 'zod'
import { classifyToken } from '@/lib/redaction/patterns'

/**
 * Developer debug logging (RFC 043). Off until a person turns it on in this
 * browser. Entries are redacted before they are stored, the log is bounded,
 * it never leaves the browser on its own, and turning it off stops collection
 * at once. It records requests the app makes (method, path, status, time) and
 * errors, never request or response bodies.
 */

const ENABLED_KEY = 'shots-debug-log-enabled'
const STORAGE_KEY = 'shots-debug-log'

/** At most this many entries and bytes are kept; the oldest go first. */
export const DEBUG_LOG_LIMITS = { bytes: 256 * 1024, entries: 500 } as const

/** What an entry records. */
export const debugLogKindSchema = z.enum(['request', 'error', 'event'])

/** One stored entry. */
export const debugLogEntrySchema = z.object({
  at: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  kind: debugLogKindSchema,
  message: z.string(),
})

/** One stored entry. */
export type DebugLogEntry = z.infer<typeof debugLogEntrySchema>

const SECRET_KEY = /token|secret|password|passwd|cookie|authorization|session|api[-_]?key|signature|credential/i

/** Replaces anything that reads like a credential or personal data. */
export function redactText(text: string): string {
  const words = text.slice(0, 500).split(/(\s+)/)
  return words
    .map((word) => {
      const finding = word.trim() ? classifyToken(word) : null
      return finding && finding.kind !== 'name' ? `[redacted ${finding.kind}]` : word
    })
    .join('')
}

/** A path without its query, with long opaque segments (share tokens) replaced. */
export function redactPath(path: string): string {
  const [base] = path.split(/[?#]/)
  return (base ?? '')
    .split('/')
    .map((segment) => (segment.length >= 24 && /^[A-Za-z0-9_-]+$/.test(segment) ? ':token' : segment))
    .join('/')
}

function redactDetail(detail: Record<string, unknown> = {}): DebugLogEntry['detail'] {
  const out: NonNullable<DebugLogEntry['detail']> = {}
  for (const [key, value] of Object.entries(detail).slice(0, 20)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[redacted]'
    } else if (typeof value === 'string') {
      out[key] = redactText(value).slice(0, 200)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
    }
  }
  return out
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Whether this browser collects debug logs. */
export function debugLoggingEnabled(): boolean {
  return storage()?.getItem(ENABLED_KEY) === 'on'
}

/** Turns collection on or off in this browser; off stops it at once. */
export function setDebugLogging(on: boolean): void {
  if (on) storage()?.setItem(ENABLED_KEY, 'on')
  else storage()?.removeItem(ENABLED_KEY)
}

/** The stored entries, oldest first. */
export function readDebugLog(): DebugLogEntry[] {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return []
  const parsed = z.array(debugLogEntrySchema).safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : []
}

/** Deletes every stored entry. */
export function clearDebugLog(): void {
  storage()?.removeItem(STORAGE_KEY)
}

/** Records one entry, redacted, when collection is on. */
export function debugLog(kind: z.infer<typeof debugLogKindSchema>, message: string, detail?: Record<string, unknown>): void {
  const store = storage()
  if (!store || !debugLoggingEnabled()) return
  let entries = [...readDebugLog(), { at: new Date().toISOString(), detail: redactDetail(detail), kind, message: redactText(message).slice(0, 300) }]
  entries = entries.slice(-DEBUG_LOG_LIMITS.entries)
  let encoded = JSON.stringify(entries)
  while (encoded.length > DEBUG_LOG_LIMITS.bytes && entries.length > 1) {
    entries = entries.slice(Math.ceil(entries.length / 10))
    encoded = JSON.stringify(entries)
  }
  try {
    store.setItem(STORAGE_KEY, encoded)
  } catch {
    // Storage is full: drop the log rather than the app's own data.
    store.removeItem(STORAGE_KEY)
  }
}

/** Saves the log as a JSON file. Nothing is uploaded. */
export function downloadDebugLog(): void {
  const blob = new Blob([JSON.stringify(readDebugLog(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `shots-debug-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** Records uncaught errors while collection is on; returns the cleanup. */
export function installDebugErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => debugLog('error', event.message || 'Uncaught error')
  const onRejection = (event: PromiseRejectionEvent) =>
    debugLog('error', event.reason instanceof Error ? event.reason.message : 'Unhandled rejection')
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
