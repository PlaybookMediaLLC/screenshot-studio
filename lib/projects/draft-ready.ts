'use client'

/**
 * The editor restores its local draft (IndexedDB) once, asynchronously, on
 * mount. Opening a project must wait for it: a restore landing after the
 * project would replace the project on the canvas. The draft is also what a
 * project recovers unsaved changes from after a reload.
 */

let markRestored: () => void = () => {}

/** Resolves once the editor's local draft restore has finished, restored or not. */
export const draftRestored = new Promise<void>((resolve) => {
  markRestored = resolve
})

/** Called by the draft autosave hook when its restore attempt is over. */
export function markDraftRestored(): void {
  markRestored()
}
