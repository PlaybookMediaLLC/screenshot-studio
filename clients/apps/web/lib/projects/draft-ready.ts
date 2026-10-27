'use client'

/**
 * The editor restores its local draft (IndexedDB) asynchronously each time
 * it mounts. Opening a project must wait for that: a restore landing after
 * the project would replace the project on the canvas. The draft is also
 * what a project recovers unsaved changes from after a reload.
 */

let restore: Promise<unknown> | null = null
let markFirst: () => void = () => {}
const first = new Promise<void>((resolve) => {
  markFirst = resolve
})

/** Called by the draft autosave hook with each restore it starts. */
export function trackDraftRestore(restoring: Promise<unknown>): void {
  restore = restoring.catch(() => {}).finally(markFirst)
}

/** Resolves once the editor's latest draft restore is over, restored or not. */
export async function draftRestored(): Promise<void> {
  // The editor starts its restore in an effect of the same commit that mounts
  // the caller; effects run before this microtask, so it has registered by now.
  await null
  await (restore ?? first)
}
