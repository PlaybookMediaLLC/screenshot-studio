'use client'

import { useEffect } from 'react'
import { useCanvasUi } from '@/lib/canvas/ui-store'
import type { CanvasActions } from './use-canvas-actions'
import type { LayerActions } from './use-layer-actions'
import { useImageStore } from '@/lib/store'

/** Keyboard shortcuts, listed in the Help popover of the zoom bar. */
export const CANVAS_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'V / H', action: 'Select tool / hand tool' },
  { keys: 'Space + drag', action: 'Pan the board' },
  { keys: '⌘/Ctrl + scroll, pinch', action: 'Zoom at the pointer' },
  { keys: '⌘ + / ⌘ −', action: 'Zoom in / out' },
  { keys: '⌘0', action: 'Zoom to 100%' },
  { keys: '⇧1 / ⇧2', action: 'Fit everything / fit selection' },
  { keys: 'Enter / double-click', action: 'Edit the selected artboard' },
  { keys: 'Esc', action: 'Stop editing, then clear selection' },
  { keys: '⌘A', action: 'Select all artboards' },
  { keys: '⌘D', action: 'Duplicate artboards' },
  { keys: '⌘C / ⌘V', action: 'Copy / paste artboards (paste an image to add it)' },
  { keys: 'Arrows (⇧ for 10)', action: 'Nudge artboards' },
  { keys: 'Delete', action: 'Delete artboards' },
  { keys: 'F2', action: 'Rename artboard' },
  { keys: '⌘Z / ⇧⌘Z', action: 'Undo / redo' },
  { keys: '⌘E', action: 'Export' },
  { keys: 'T', action: 'Text tool: click the open artboard to type' },
  { keys: '⇧-click / ⇧-drag', action: 'Select several layers in the open artboard' },
  { keys: 'Double-click', action: 'Type into text, or enter a group or component' },
  { keys: '⌘G / ⇧⌘G', action: 'Group / ungroup layers' },
]

function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      Boolean(target.closest('input,textarea,select,[role="dialog"],[role="menu"]')))
  )
}

/**
 * Board shortcuts. While an artboard is open in the native editor its own
 * keys (delete a layer, nudge an element) take precedence; only undo, zoom
 * and Escape stay with the board.
 */
export function useCanvasShortcuts(
  actions: CanvasActions,
  canEdit: boolean,
  onExport: () => void,
  layers: LayerActions
) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // An open dialog or menu owns the keyboard, Escape included, even when focus fell to the page.
      if (
        editable(event.target) ||
        document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')
      )
        return
      const ui = useCanvasUi.getState()
      const mod = event.metaKey || event.ctrlKey
      const lower = event.key.toLowerCase()
      const handled = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (mod && lower === 'z' && canEdit) {
        handled()
        if (event.shiftKey) actions.redo()
        else actions.undo()
        return
      }
      if (mod && lower === 'y' && canEdit) {
        handled()
        actions.redo()
        return
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        handled()
        actions.zoomStep(1)
        return
      }
      if (mod && event.key === '-') {
        handled()
        actions.zoomStep(-1)
        return
      }
      if (mod && event.key === '0') {
        handled()
        actions.zoomTo(1)
        return
      }
      if (event.shiftKey && (event.code === 'Digit1' || event.key === '!')) {
        handled()
        actions.fitAll()
        return
      }
      if (event.shiftKey && (event.code === 'Digit2' || event.key === '@')) {
        handled()
        actions.fitSelection()
        return
      }
      if (mod && lower === 'e') {
        handled()
        onExport()
        return
      }
      if (event.key === 'Escape') {
        if (ui.activeId && ui.tool === 'text') {
          handled()
          ui.setTool('select')
        } else if (ui.activeId && ui.layers.length) {
          handled()
          ui.selectLayers([])
        } else if (ui.activeId && ui.enteredGroup) {
          handled()
          ui.enterGroup(null)
        } else if (ui.activeId) {
          handled()
          actions.exitEdit()
        } else if (ui.selection.length) {
          handled()
          ui.select([])
        }
        return
      }
      if (ui.activeId && canEdit) {
        if (!mod && lower === 't') {
          handled()
          ui.setTool('text')
          return
        }
        // Enter types into the selected text, unless another artboard was picked to open.
        const onlyActive = ui.selection.every((id) => id === ui.activeId)
        if (!mod && event.key === 'Enter' && !ui.layers.length && onlyActive) {
          const text = useImageStore.getState().selectedTextId
          if (text) {
            handled()
            ui.editText(text)
            return
          }
        }
        // Several layers selected together: the selection owns these keys.
        if (ui.layers.length) {
          if (mod && lower === 'g') {
            handled()
            void (event.shiftKey ? layers.ungroup() : layers.group())
          } else if (mod && lower === 'd') {
            handled()
            void layers.duplicate()
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            handled()
            void layers.remove()
          } else if (event.key.startsWith('Arrow')) {
            handled()
            const step = event.shiftKey ? 10 : 1
            void layers.nudge(
              event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
              event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
            )
          }
          return
        }
      }
      // The open artboard's editor owns the rest of the keyboard.
      if (ui.activeId) return
      if (!mod && lower === 'v') ui.setTool('select')
      else if (!mod && lower === 'h') ui.setTool('hand')
      else if (mod && lower === 'a') {
        handled()
        actions.selectAll()
      } else if (!canEdit) return
      else if (mod && lower === 'd') {
        handled()
        actions.duplicate()
      } else if (mod && lower === 'c' && ui.selection.length) {
        actions.copy()
      } else if (mod && lower === 'v') {
        // Images arrive as a paste event; artboards come from the board clipboard.
        actions.paste()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && ui.selection.length) {
        handled()
        actions.remove()
      } else if (event.key === 'Enter' && ui.selection.length === 1) {
        handled()
        actions.edit(ui.selection[0]!)
      } else if (event.key === 'F2' && ui.selection.length === 1) {
        handled()
        ui.rename(ui.selection[0]!)
      } else if (event.key.startsWith('Arrow') && ui.selection.length) {
        handled()
        const step = event.shiftKey ? 10 : 1
        actions.nudge(
          event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        )
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [actions, canEdit, onExport, layers])
}
