'use client'

import * as React from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { LayerTransform } from '@/lib/store-screenshots/document/schema'
import { getStoreTargetOrDefault, targetPixelSize } from '@/lib/store-screenshots/targets'
import type { StudioActions } from './actions'
import { ownerLayers, type EditorState } from './editor-store'

/**
 * Keyboard shortcuts. The catalog below is the single source for both the
 * handler and the shortcuts reference dialog. Shortcuts never fire while
 * the user types in a field, edits text on the canvas, or works in a dialog.
 */

/** One documented shortcut. */
export type Shortcut = { keys: string; action: string; group: string }

/** Every shortcut, as shown in the reference. */
export const SHORTCUTS: Shortcut[] = [
  { group: 'Edit', keys: '⌘Z', action: 'Undo' },
  { group: 'Edit', keys: '⇧⌘Z or ⌘Y', action: 'Redo' },
  { group: 'Edit', keys: '⌘D', action: 'Duplicate selected layers (or slides)' },
  { group: 'Edit', keys: 'Delete or Backspace', action: 'Delete selected layers' },
  { group: 'Edit', keys: '⌘S', action: 'Save now' },
  { group: 'Selection', keys: 'Click / ⇧-click', action: 'Select / add to selection' },
  { group: 'Selection', keys: '⌥-click', action: 'Select inside a group' },
  { group: 'Selection', keys: '⌘A', action: 'Select all layers on the slide' },
  { group: 'Selection', keys: 'Esc', action: 'Finish editing, then clear the selection' },
  { group: 'Selection', keys: 'Enter', action: 'Edit selected text, or crop the selected device' },
  { group: 'Move', keys: '← → ↑ ↓', action: 'Nudge 1 px' },
  { group: 'Move', keys: '⇧ + arrows', action: 'Nudge 10 px' },
  { group: 'Move', keys: 'Drag with ⇧', action: 'Move along one axis' },
  { group: 'Move', keys: 'Drag with ⌘', action: 'Move without snapping' },
  { group: 'Move', keys: 'Rotate with ⇧', action: 'Rotate in 15° steps' },
  { group: 'Arrange', keys: '⌘] / ⌘[', action: 'Bring forward / send backward' },
  { group: 'Arrange', keys: '⇧⌘] / ⇧⌘[', action: 'Bring to front / send to back' },
  { group: 'Arrange', keys: '⌘G / ⇧⌘G', action: 'Group / ungroup' },
  { group: 'View', keys: '⌘+ / ⌘−', action: 'Zoom in / out' },
  { group: 'View', keys: '⌘0', action: 'Fit to screen' },
  { group: 'View', keys: '⌘1', action: 'Actual size' },
  { group: 'View', keys: 'Space + drag', action: 'Pan' },
  { group: 'View', keys: '⌘ + scroll', action: 'Zoom at pointer' },
  { group: 'Slides', keys: '⌘-click / ⇧-click', action: 'Select several slides in the strip' },
  { group: 'Slides', keys: '⌥← / ⌥→', action: 'Move the focused slide in the strip' },
  { group: 'Text', keys: '⌘B / ⌘I / ⌘U', action: 'Bold, italic, underline while editing' },
  { group: 'Help', keys: '?', action: 'Show this list' },
  { group: 'Help', keys: '⌘E', action: 'Export' },
]

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[role="combobox"]')) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'range', 'color', 'submit'].includes(target.type)
  }
  return false
}

function inDialog(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'))
}

function onCanvasOrBody(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true
  return target === document.body || Boolean(target.closest('[data-store-canvas],[data-store-inspector] [data-canvas-keys]'))
}

/** Install the editor shortcuts. */
export function useEditorShortcuts(store: StoreApi<EditorState>, actions: Pick<StudioActions, 'openDialog'>, saveNow: () => void): void {
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || inDialog(event.target)) return
      const state = store.getState()
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const typing = isTyping(event.target)

      if (meta && key === 'z') {
        if (typing) return
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (meta && key === 'y') {
        if (typing) return
        event.preventDefault()
        state.redo()
        return
      }
      if (meta && key === 's') {
        event.preventDefault()
        saveNow()
        return
      }
      if (meta && key === 'e') {
        event.preventDefault()
        actions.openDialog('export')
        return
      }
      if (typing || state.editingText || state.croppingLayerId) return

      const selection = state.selection
      const slide = state.document.slides.find((item) => item.id === state.activeSlideId)!

      if (event.key === 'Escape') {
        if (state.pickingCalloutId) state.setPickingCallout(null)
        else if (selection) state.clearSelection()
        else if (state.selectedSlideIds.length > 1) state.activateSlide(state.activeSlideId)
        return
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault()
        actions.openDialog('shortcuts')
        return
      }
      if (meta && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        state.setZoom((state.zoom ?? 0.3) * 1.25)
        return
      }
      if (meta && event.key === '-') {
        event.preventDefault()
        state.setZoom((state.zoom ?? 0.3) / 1.25)
        return
      }
      if (meta && event.key === '0') {
        event.preventDefault()
        state.setZoom(null)
        return
      }
      if (meta && event.key === '1') {
        event.preventDefault()
        state.setZoom(1)
        state.setPan({ x: 0, y: 0 })
        return
      }
      if (meta && key === 'd') {
        event.preventDefault()
        if (selection) state.dispatch({ type: 'layers.duplicate', owner: selection.owner, layerIds: selection.layerIds, placements: {} })
        else state.dispatch({ type: 'slides.duplicate', slideIds: state.selectedSlideIds })
        return
      }
      if (!onCanvasOrBody(event.target)) return

      if (meta && key === 'a') {
        event.preventDefault()
        state.selectLayers({ kind: 'slide', id: slide.id }, slide.layers.filter((layer) => !layer.locked && !layer.hidden).map((layer) => layer.id), 'replace', { deep: true })
        return
      }
      if (!selection) return
      const layers = ownerLayers(state.document, selection.owner).filter((layer) => selection.layerIds.includes(layer.id))
      const unlocked = layers.filter((layer) => !layer.locked)

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (unlocked.length) state.dispatch({ type: 'layers.delete', owner: selection.owner, layerIds: unlocked.map((layer) => layer.id) })
        return
      }
      if (event.key === 'Enter' && layers.length === 1) {
        event.preventDefault()
        const [layer] = layers
        if (layer.type === 'text') state.startTextEdit(selection.owner, layer.id)
        else if (layer.type === 'device' && layer.assetId) state.setCropping(layer.id)
        return
      }
      if (meta && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) state.dispatch({ type: 'layers.ungroup', owner: selection.owner, layerIds: selection.layerIds })
        else if (selection.layerIds.length > 1) state.dispatch({ type: 'layers.group', owner: selection.owner, layerIds: selection.layerIds, groupId: crypto.randomUUID() })
        return
      }
      if (meta && (event.key === ']' || event.key === '[')) {
        event.preventDefault()
        const forward = event.key === ']'
        state.dispatch({ type: 'layers.arrange', owner: selection.owner, layerIds: selection.layerIds, move: event.shiftKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward' })
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const arrow = arrows[event.key]
      if (arrow && unlocked.length) {
        event.preventDefault()
        const size = targetPixelSize(getStoreTargetOrDefault(state.targetId))
        const panorama = selection.owner.kind === 'panorama' ? state.document.panoramas.find((item) => item.id === selection.owner.id) : null
        const width = size.width * (panorama?.slideIds.length ?? 1)
        const step = event.shiftKey ? 10 : 1
        const override = state.targetOverrideMode && selection.owner.kind === 'slide'
        const transforms: Record<string, Partial<LayerTransform>> = {}
        for (const layer of unlocked) {
          const current = override ? { ...layer.transform, ...(slide.targetOverrides[state.targetId]?.[layer.id] ?? {}) } : layer.transform
          transforms[layer.id] = {
            offsetX: current.offsetX + ((arrow[0] * step) / width) * 100,
            offsetY: current.offsetY + ((arrow[1] * step) / size.height) * 100,
          }
        }
        state.dispatch(
          { type: 'layers.setTransforms', owner: selection.owner, transforms, targetId: override ? state.targetId : null },
          { key: `nudge:${selection.layerIds.join(',')}` }
        )
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [store, actions, saveNow])
}
