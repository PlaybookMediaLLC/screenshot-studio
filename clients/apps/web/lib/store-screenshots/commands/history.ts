import type { StoreDocument } from '../document/schema'

/**
 * Undo history. Documents are immutable and structurally shared, so an
 * entry is a reference, not a copy; image bytes live in the asset store and
 * are never duplicated by history. Continuous gestures (a drag, a slider)
 * coalesce into one entry when they share a key and arrive within
 * `COALESCE_WINDOW_MS` of each other.
 */

/** Entries kept in each direction. */
export const MAX_HISTORY_ENTRIES = 200

/** Gap after which a continuous gesture starts a new undo step. */
export const COALESCE_WINDOW_MS = 800

/** One undo step: the document before (past) or after (future) the change. */
export type HistoryEntry = { document: StoreDocument; label: string; key: string | null; at: number }

/** Undo and redo stacks. */
export type History = { past: HistoryEntry[]; future: HistoryEntry[] }

/** An empty history. */
export const EMPTY_HISTORY: History = Object.freeze({ past: [], future: [] }) as History

/**
 * Record that `previous` was replaced. Returns the same history when the
 * change continues the current gesture.
 */
export function recordHistory(
  history: History,
  previous: StoreDocument,
  label: string,
  key: string | null,
  now: number
): History {
  const top = history.past.at(-1)
  if (key && top && top.key === key && now - top.at <= COALESCE_WINDOW_MS) {
    const past = [...history.past]
    past[past.length - 1] = { ...top, at: now }
    return { past, future: [] }
  }
  return {
    past: [...history.past, { document: previous, label, key, at: now }].slice(-MAX_HISTORY_ENTRIES),
    future: [],
  }
}

/** End the current gesture so the next change starts a new step. */
export function closeHistoryGroup(history: History): History {
  const top = history.past.at(-1)
  if (!top || top.key === null) return history
  const past = [...history.past]
  past[past.length - 1] = { ...top, key: null }
  return { ...history, past }
}

/** Step back. Null when there is nothing to undo. */
export function undoHistory(
  history: History,
  current: StoreDocument
): { history: History; document: StoreDocument; label: string } | null {
  const entry = history.past.at(-1)
  if (!entry) return null
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { document: current, label: entry.label, key: null, at: entry.at }].slice(
        -MAX_HISTORY_ENTRIES
      ),
    },
    document: entry.document,
    label: entry.label,
  }
}

/** Step forward. Null when there is nothing to redo. */
export function redoHistory(
  history: History,
  current: StoreDocument
): { history: History; document: StoreDocument; label: string } | null {
  const entry = history.future.at(-1)
  if (!entry) return null
  return {
    history: {
      past: [...history.past, { document: current, label: entry.label, key: null, at: entry.at }].slice(
        -MAX_HISTORY_ENTRIES
      ),
      future: history.future.slice(0, -1),
    },
    document: entry.document,
    label: entry.label,
  }
}
