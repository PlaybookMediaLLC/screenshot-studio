'use client'

import * as React from 'react'
import { z } from 'zod'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { applyCommand, applyCommands } from '@/lib/store-screenshots/commands/apply'
import {
  closeHistoryGroup,
  EMPTY_HISTORY,
  recordHistory,
  redoHistory,
  undoHistory,
  type History,
} from '@/lib/store-screenshots/commands/history'
import { COMMAND_LABELS, type Command, type LayerOwner } from '@/lib/store-screenshots/commands/schema'
import type { StoreDocument, StoreLayer } from '@/lib/store-screenshots/document/schema'
import { DEFAULT_TARGET_ID } from '@/lib/store-screenshots/targets'

/**
 * Editor state. The document changes only through `dispatch`, which applies
 * a command with the pure reducer and records undo history; selection and
 * view state never enter history. Components subscribe with selectors, so a
 * change re-renders only what reads the changed slice.
 */

/** How a filmstrip click changes the slide selection. */
export const slideSelectModeSchema = z.enum(['replace', 'toggle', 'range'])

/** How a canvas or layer-list click changes the layer selection. */
export const layerSelectModeSchema = z.enum(['replace', 'toggle', 'add'])

/** Slide selection mode. */
export type SlideSelectMode = z.infer<typeof slideSelectModeSchema>
/** Layer selection mode. */
export type LayerSelectMode = z.infer<typeof layerSelectModeSchema>

/** Autosave state shown in the header. */
export const saveStatusSchema = z.enum(['saved', 'pending', 'saving', 'error', 'conflict'])

/** Save status. */
export type SaveStatus = z.infer<typeof saveStatusSchema>

/** Selected layers inside one owner. */
export type LayerSelection = { owner: LayerOwner; layerIds: string[] }

/** Canvas aids the user can toggle. */
export type ViewOptions = {
  guides: boolean
  snapping: boolean
  safeArea: boolean
  rulers: boolean
  grid: boolean
}

/** Editor state and actions. */
export type EditorState = {
  document: StoreDocument
  history: History
  activeSlideId: string
  /** Filmstrip selection; always contains the active slide. */
  selectedSlideIds: string[]
  /** Anchor for shift-click ranges in the filmstrip. */
  slideAnchorId: string
  selection: LayerSelection | null
  editingText: { owner: LayerOwner; layerId: string } | null
  croppingLayerId: string | null
  /** A callout whose source region is being picked on its device. */
  pickingCalloutId: string | null
  locale: string
  targetId: string
  /** Canvas edits apply to the current export target only. */
  targetOverrideMode: boolean
  /** Null fits the slide to the viewport. */
  zoom: number | null
  pan: { x: number; y: number }
  view: ViewOptions
  /** Most recent undo/redo or command label, for the live region. */
  announcement: string
  saveStatus: SaveStatus

  dispatch: (command: Command, options?: { key?: string }) => boolean
  dispatchMany: (commands: Command[], label: string, options?: { key?: string }) => boolean
  undo: () => void
  redo: () => void
  endGesture: () => void
  /** Swap in another document. `undoLabel` records the swap as one undo step; `resetHistory` clears history. */
  replaceDocument: (document: StoreDocument, options?: { resetHistory?: boolean; undoLabel?: string }) => void
  activateSlide: (slideId: string, mode?: SlideSelectMode) => void
  selectSlides: (slideIds: string[]) => void
  selectLayers: (owner: LayerOwner, layerIds: string[], mode?: LayerSelectMode, options?: { deep?: boolean }) => void
  clearSelection: () => void
  startTextEdit: (owner: LayerOwner, layerId: string) => void
  stopTextEdit: () => void
  setCropping: (layerId: string | null) => void
  setPickingCallout: (layerId: string | null) => void
  setLocale: (locale: string) => void
  setTarget: (targetId: string) => void
  setTargetOverrideMode: (enabled: boolean) => void
  setZoom: (zoom: number | null) => void
  setPan: (pan: { x: number; y: number }) => void
  toggleView: (key: keyof ViewOptions) => void
  setSaveStatus: (status: SaveStatus) => void
}

/** Layers of an owner in a document. */
export function ownerLayers(document: StoreDocument, owner: LayerOwner): StoreLayer[] {
  if (owner.kind === 'slide') return document.slides.find((slide) => slide.id === owner.id)?.layers ?? []
  return document.panoramas.find((panorama) => panorama.id === owner.id)?.layers ?? []
}

function expandGroups(layers: StoreLayer[], ids: string[]): string[] {
  const groups = new Set(layers.filter((layer) => ids.includes(layer.id) && layer.groupId).map((layer) => layer.groupId))
  if (groups.size === 0) return ids
  return [...new Set([...ids, ...layers.filter((layer) => groups.has(layer.groupId)).map((layer) => layer.id)])]
}

/** Keep selection consistent with the document after a change. */
function reconcile(state: EditorState, document: StoreDocument): Partial<EditorState> {
  const slideIds = new Set(document.slides.map((slide) => slide.id))
  const activeIndex = state.document.slides.findIndex((slide) => slide.id === state.activeSlideId)
  const activeSlideId = slideIds.has(state.activeSlideId)
    ? state.activeSlideId
    : document.slides[Math.min(Math.max(activeIndex, 0), document.slides.length - 1)].id
  const selectedSlideIds = state.selectedSlideIds.filter((id) => slideIds.has(id))
  if (!selectedSlideIds.includes(activeSlideId)) selectedSlideIds.unshift(activeSlideId)
  let selection = state.selection
  if (selection) {
    const present = new Set(ownerLayers(document, selection.owner).map((layer) => layer.id))
    const layerIds = selection.layerIds.filter((id) => present.has(id))
    selection = layerIds.length ? { ...selection, layerIds } : null
  }
  const editingText =
    state.editingText && ownerLayers(document, state.editingText.owner).some((layer) => layer.id === state.editingText!.layerId)
      ? state.editingText
      : null
  // Cropping and callout picking end when their layer disappears (e.g. undoing its creation).
  const layerExists = (id: string | null) =>
    id !== null && [...document.slides, ...document.panoramas].some((owner) => owner.layers.some((layer) => layer.id === id))
  return {
    activeSlideId,
    selectedSlideIds,
    slideAnchorId: slideIds.has(state.slideAnchorId) ? state.slideAnchorId : activeSlideId,
    selection,
    editingText,
    croppingLayerId: layerExists(state.croppingLayerId) ? state.croppingLayerId : null,
    pickingCalloutId: layerExists(state.pickingCalloutId) ? state.pickingCalloutId : null,
  }
}

/** Create an editor store for a document. */
export function createEditorStore(initial: StoreDocument): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => ({
    document: initial,
    history: EMPTY_HISTORY,
    activeSlideId: initial.slides[0].id,
    selectedSlideIds: [initial.slides[0].id],
    slideAnchorId: initial.slides[0].id,
    selection: null,
    editingText: null,
    croppingLayerId: null,
    pickingCalloutId: null,
    locale: initial.localization.sourceLocale,
    targetId: DEFAULT_TARGET_ID,
    targetOverrideMode: false,
    zoom: null,
    pan: { x: 0, y: 0 },
    view: { guides: true, snapping: true, safeArea: false, rulers: false, grid: false },
    announcement: '',
    saveStatus: 'saved',

    dispatch(command, options) {
      const state = get()
      const now = Date.now()
      const next = applyCommand(state.document, command, now)
      if (next === state.document) return false
      const label = COMMAND_LABELS[command.type]
      set({
        document: next,
        history: recordHistory(state.history, state.document, label, options?.key ?? null, now),
        announcement: options?.key ? state.announcement : label,
        ...reconcile(state, next),
      })
      return true
    },

    dispatchMany(commands, label, options) {
      const state = get()
      const now = Date.now()
      const next = applyCommands(state.document, commands, now)
      if (next === state.document) return false
      set({
        document: next,
        history: recordHistory(state.history, state.document, label, options?.key ?? null, now),
        announcement: label,
        ...reconcile(state, next),
      })
      return true
    },

    undo() {
      const state = get()
      const result = undoHistory(closeHistoryGroup(state.history), state.document)
      if (!result) return
      set({ document: result.document, history: result.history, announcement: `Undid ${result.label}`, ...reconcile(state, result.document) })
    },

    redo() {
      const state = get()
      const result = redoHistory(state.history, state.document)
      if (!result) return
      set({ document: result.document, history: result.history, announcement: `Redid ${result.label}`, ...reconcile(state, result.document) })
    },

    endGesture() {
      set({ history: closeHistoryGroup(get().history) })
    },

    replaceDocument(document, options) {
      const state = get()
      set({
        document,
        ...(options?.resetHistory ? { history: EMPTY_HISTORY } : {}),
        ...(options?.undoLabel ? { history: recordHistory(state.history, state.document, options.undoLabel, null, Date.now()) } : {}),
        locale: options?.resetHistory ? document.localization.sourceLocale : state.locale,
        ...reconcile(state, document),
      })
    },

    activateSlide(slideId, mode = 'replace') {
      const state = get()
      const order = state.document.slides.map((slide) => slide.id)
      if (!order.includes(slideId)) return
      if (mode === 'toggle') {
        const has = state.selectedSlideIds.includes(slideId)
        const selected = has ? state.selectedSlideIds.filter((id) => id !== slideId) : [...state.selectedSlideIds, slideId]
        const activeSlideId = has ? (selected[0] ?? slideId) : slideId
        set({
          activeSlideId,
          selectedSlideIds: selected.length ? selected : [slideId],
          slideAnchorId: slideId,
          selection: activeSlideId === state.activeSlideId ? state.selection : null,
          editingText: null,
          croppingLayerId: null,
          pickingCalloutId: null,
        })
        return
      }
      if (mode === 'range') {
        const from = order.indexOf(state.slideAnchorId)
        const to = order.indexOf(slideId)
        const [start, end] = from < to ? [from, to] : [to, from]
        set({
          activeSlideId: slideId,
          selectedSlideIds: order.slice(start, end + 1),
          selection: slideId === state.activeSlideId ? state.selection : null,
          editingText: null,
          croppingLayerId: null,
          pickingCalloutId: null,
        })
        return
      }
      set({
        activeSlideId: slideId,
        selectedSlideIds: [slideId],
        slideAnchorId: slideId,
        selection: slideId === state.activeSlideId ? state.selection : null,
        editingText: null,
        croppingLayerId: null,
        pickingCalloutId: null,
      })
    },

    selectSlides(slideIds) {
      const state = get()
      const valid = slideIds.filter((id) => state.document.slides.some((slide) => slide.id === id))
      if (valid.length === 0) return
      set({
        selectedSlideIds: valid,
        activeSlideId: valid.includes(state.activeSlideId) ? state.activeSlideId : valid[0],
      })
    },

    selectLayers(owner, layerIds, mode = 'replace', options) {
      const state = get()
      const layers = ownerLayers(state.document, owner)
      const ids = options?.deep ? layerIds : expandGroups(layers, layerIds)
      const sameOwner = state.selection && state.selection.owner.kind === owner.kind && state.selection.owner.id === owner.id
      const current = sameOwner ? state.selection!.layerIds : []
      let next: string[]
      if (mode === 'toggle') {
        const removing = ids.every((id) => current.includes(id))
        next = removing ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]
      } else if (mode === 'add') {
        next = [...new Set([...current, ...ids])]
      } else {
        next = ids
      }
      set({
        selection: next.length ? { owner, layerIds: next } : null,
        editingText: null,
        croppingLayerId: state.croppingLayerId && next.includes(state.croppingLayerId) ? state.croppingLayerId : null,
      })
    },

    clearSelection() {
      set({ selection: null, editingText: null, croppingLayerId: null, pickingCalloutId: null })
    },

    startTextEdit(owner, layerId) {
      set({ selection: { owner, layerIds: [layerId] }, editingText: { owner, layerId }, croppingLayerId: null })
    },

    stopTextEdit() {
      set({ editingText: null, history: closeHistoryGroup(get().history) })
    },

    setCropping(layerId) {
      set({ croppingLayerId: layerId, editingText: null, history: closeHistoryGroup(get().history) })
    },

    setPickingCallout(layerId) {
      set({ pickingCalloutId: layerId })
    },

    setLocale(locale) {
      set({ locale, editingText: null })
    },

    setTarget(targetId) {
      set({ targetId })
    },

    setTargetOverrideMode(enabled) {
      set({ targetOverrideMode: enabled })
    },

    setZoom(zoom) {
      set({ zoom: zoom === null ? null : Math.min(4, Math.max(0.1, zoom)) })
    },

    setPan(pan) {
      set({ pan })
    },

    toggleView(key) {
      set({ view: { ...get().view, [key]: !get().view[key] } })
    },

    setSaveStatus(saveStatus) {
      if (get().saveStatus !== saveStatus) set({ saveStatus })
    },
  }))
}

const EditorContext = React.createContext<StoreApi<EditorState> | null>(null)

/** Provide an editor store. */
export const EditorStoreProvider = EditorContext.Provider

/** The editor store, for imperative access in event handlers. */
export function useEditorApi(): StoreApi<EditorState> {
  const store = React.useContext(EditorContext)
  if (!store) throw new Error('useEditorApi must be used inside <EditorStoreProvider>.')
  return store
}

/** Subscribe to a slice of editor state. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorApi(), selector)
}

/** The active slide and its index. */
export function useActiveSlide() {
  const document = useEditor((state) => state.document)
  const activeSlideId = useEditor((state) => state.activeSlideId)
  const index = document.slides.findIndex((slide) => slide.id === activeSlideId)
  return { slide: document.slides[Math.max(0, index)], index: Math.max(0, index) }
}
