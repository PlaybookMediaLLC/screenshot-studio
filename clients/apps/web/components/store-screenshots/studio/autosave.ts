'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type { StoreApi } from 'zustand/vanilla'
import { domToJpeg } from 'modern-screenshot'
import type { StoreDocument } from '@/lib/store-screenshots/document/schema'
import {
  deleteProject,
  forceSaveProject,
  loadProject,
  onProjectSaved,
  ProjectConflictError,
  saveProject,
} from '@/lib/store-screenshots/persistence/projects'
import type { EditorState } from './editor-store'

/**
 * Autosave. Saves run one at a time, each naming the revision it builds on,
 * so a slow save can never overwrite a newer one, and a save from another
 * tab is detected instead of clobbered. A small first-slide thumbnail is
 * refreshed at most every 15 seconds for the project library.
 */

const SAVE_DELAY_MS = 700
const THUMBNAIL_INTERVAL_MS = 15_000

async function captureThumbnail(): Promise<string | null> {
  const element = globalThis.document?.querySelector<HTMLElement>('[data-slide-button] > div')
  if (!element) return null
  try {
    return await domToJpeg(element, { quality: 0.72, scale: 2 })
  } catch {
    return null
  }
}

/** Autosave controller for one open project. */
export function useAutosave(store: StoreApi<EditorState>, initialRevision: number) {
  const baseRevisionRef = React.useRef(initialRevision)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const chainRef = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const stoppedRef = React.useRef(false)
  const pendingRef = React.useRef<StoreDocument | null>(null)
  const thumbnailRef = React.useRef<{ at: number; value: string | null }>({ at: 0, value: null })
  const errorShownRef = React.useRef(false)

  const discardPending = React.useCallback(() => {
    pendingRef.current = null
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const runSave = React.useCallback(
    (force = false): Promise<boolean> => {
      if (stoppedRef.current) return Promise.resolve(false)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const document = pendingRef.current
      if (!document) return chainRef.current
      pendingRef.current = null
      const run = async () => {
        if (stoppedRef.current) return false
        if (!force && store.getState().saveStatus === 'conflict') {
          pendingRef.current ??= document
          return false
        }
        store.getState().setSaveStatus('saving')
        const now = Date.now()
        if (now - thumbnailRef.current.at > THUMBNAIL_INTERVAL_MS) {
          thumbnailRef.current = { at: now, value: (await captureThumbnail()) ?? thumbnailRef.current.value }
        }
        try {
          const saved = force
            ? await forceSaveProject(document, thumbnailRef.current.value)
            : await saveProject(document, baseRevisionRef.current, thumbnailRef.current.value)
          baseRevisionRef.current = saved.revision
          errorShownRef.current = false
          store.getState().setSaveStatus(pendingRef.current ? 'pending' : 'saved')
          return true
        } catch (cause) {
          if (cause instanceof ProjectConflictError) {
            pendingRef.current = pendingRef.current ?? document
            store.getState().setSaveStatus('conflict')
            return false
          }
          pendingRef.current = pendingRef.current ?? document
          store.getState().setSaveStatus('error')
          if (!errorShownRef.current) {
            errorShownRef.current = true
            toast.error('Could not save this project', { description: 'Your changes are still open. Free some browser storage and try again.' })
          }
          return false
        }
      }
      chainRef.current = chainRef.current.then(run, run)
      return chainRef.current
    },
    [store]
  )

  React.useEffect(() => {
    let previous = store.getState().document
    return store.subscribe((state) => {
      if (stoppedRef.current) return
      if (state.document === previous) return
      previous = state.document
      pendingRef.current = state.document
      if (state.saveStatus === 'conflict') return
      state.setSaveStatus('pending')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void runSave(), SAVE_DELAY_MS)
    })
  }, [store, runSave])

  React.useEffect(() => {
    const flush = () => void runSave()
    const onVisibility = () => {
      if (globalThis.document.visibilityState === 'hidden') flush()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current && store.getState().saveStatus !== 'saving') return
      flush()
      event.preventDefault()
    }
    globalThis.document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [runSave, store])

  React.useEffect(
    () =>
      onProjectSaved(async (message) => {
        const state = store.getState()
        if (message.projectId !== state.document.id || message.revision <= baseRevisionRef.current) return
        if (pendingRef.current || state.saveStatus === 'saving') {
          state.setSaveStatus('conflict')
          return
        }
        const loaded = await loadProject(message.projectId)
        if (!loaded) return
        baseRevisionRef.current = loaded.document.revision
        state.replaceDocument(loaded.document, { resetHistory: true })
        discardPending()
        state.setSaveStatus('saved')
        toast('Updated with changes from another tab')
      }),
    [store, discardPending]
  )

  return {
    saveNow: async () => {
      pendingRef.current = pendingRef.current ?? store.getState().document
      while (pendingRef.current) {
        if (!(await runSave())) return false
      }
      return chainRef.current
    },
    /** Stop queued saves before deleting so cleanup cannot recreate the project. */
    deleteCurrent: async () => {
      stoppedRef.current = true
      discardPending()
      await chainRef.current
      try {
        await deleteProject(store.getState().document.id)
        return true
      } catch {
        stoppedRef.current = false
        pendingRef.current = store.getState().document
        store.getState().setSaveStatus('error')
        toast.error('Could not delete this project', { description: 'Your project is still open. Try again.' })
        return false
      }
    },
    /** Keep this tab's copy and overwrite the other tab's save. */
    keepMine: () => {
      pendingRef.current = store.getState().document
      return runSave(true)
    },
    /** Discard this tab's unsaved changes and load the stored copy. */
    loadTheirs: async () => {
      pendingRef.current = null
      const loaded = await loadProject(store.getState().document.id)
      if (!loaded) return
      baseRevisionRef.current = loaded.document.revision
      store.getState().replaceDocument(loaded.document, { resetHistory: true })
      discardPending()
      store.getState().setSaveStatus('saved')
    },
  }
}
