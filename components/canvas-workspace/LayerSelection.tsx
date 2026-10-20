'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Artboard } from '@/lib/canvas/document'
import { mainLayerId } from '@/lib/canvas/components'
import {
  groupOf,
  LAYER_ATTRIBUTES,
  layerKindSchema,
  layerRefs,
  sameLayer,
  type LayerKind,
  type LayerRef,
} from '@/lib/canvas/layers'
import { useCanvasUi } from '@/lib/canvas/ui-store'
import { clearEditorSelection } from '@/lib/editor/selection'
import { useImageStore } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import {
  activeStage,
  instanceOfSelection,
  layerElement,
  type LayerActions,
} from './use-layer-actions'

const LAYER_SELECTOR = layerKindSchema.options
  .map((kind) => `[${LAYER_ATTRIBUTES[kind]}]`)
  .join(',')

/** The layer drawn at a DOM node, if any. */
function layerAt(target: EventTarget | null): LayerRef | null {
  if (!(target instanceof Element)) return null
  const element = target.closest(LAYER_SELECTOR)
  if (!element) return null
  for (const kind of layerKindSchema.options) {
    const id = element.getAttribute(LAYER_ATTRIBUTES[kind])
    if (id) return { kind, id }
  }
  return null
}

/** Every layer the stage draws, with its screen rectangle. */
function drawnLayers(stage: HTMLElement): { ref: LayerRef; rect: DOMRect }[] {
  return [...stage.querySelectorAll(LAYER_SELECTOR)].flatMap((element) => {
    const ref = layerAt(element)
    return ref ? [{ ref, rect: element.getBoundingClientRect() }] : []
  })
}

/** Hand one layer to the editor's own single selection. */
function selectInEditor(ref: LayerRef) {
  clearEditorSelection()
  const store = useImageStore.getState()
  const select: Record<LayerKind, () => void> = {
    text: () => store.setSelectedTextId(ref.id),
    overlay: () => store.setSelectedOverlayId(ref.id),
    annotation: () => store.setSelectedAnnotationId(ref.id),
    element: () => store.setSelectedElementId(ref.id),
    mockup: () => useDeviceUIStore.getState().setSelectedDeviceId(ref.id),
  }
  select[ref.kind]()
}

/** The editor's current single selection, as a layer reference. */
function editorLayer(): LayerRef | null {
  const store = useImageStore.getState()
  if (store.selectedTextId) return { kind: 'text', id: store.selectedTextId }
  if (store.selectedOverlayId) return { kind: 'overlay', id: store.selectedOverlayId }
  if (store.selectedAnnotationId) return { kind: 'annotation', id: store.selectedAnnotationId }
  if (store.selectedElementId) return { kind: 'element', id: store.selectedElementId }
  const device = useDeviceUIStore.getState().selectedDeviceId
  return device ? { kind: 'mockup', id: device } : null
}

type Box = { left: number; top: number; width: number; height: number }

/**
 * The layers that select together with one layer: its group, or the
 * component instance it belongs to. Double-clicking enters either one.
 */
export function unitOf(
  artboard: Artboard,
  ref: LayerRef
): { id: string; layers: LayerRef[] } | undefined {
  const group = groupOf(artboard.groups, ref)
  if (group) return group
  const instance = artboard.instances.find((item) => mainLayerId(item.id, ref.id) !== null)
  if (!instance) return undefined
  return {
    id: `instance:${instance.id}`,
    layers: layerRefs(artboard.document).filter(
      (item) => mainLayerId(instance.id, item.id) !== null
    ),
  }
}

/**
 * Selecting several layers in the open artboard, moving them together,
 * groups, and typing text on the stage. It sits over the mounted editor and
 * claims only the gestures the editor does not have: Shift-click and
 * Shift-drag to select several, a press on a group or a multi-selection to
 * move it, a double-click to enter a group or type into text, and the text
 * tool. Everything else reaches the editor untouched.
 */
export function LayerSelection({
  artboard,
  actions,
  canEdit,
  componentName,
}: {
  artboard: Artboard
  actions: LayerActions
  canEdit: boolean
  componentName: (componentId: string) => string | undefined
}) {
  const root = useRef<HTMLDivElement>(null)
  const layers = useCanvasUi((state) => state.layers)
  const editingText = useCanvasUi((state) => state.editingText)
  const [box, setBox] = useState<Box | null>(null)
  const [outlines, setOutlines] = useState<Box[]>([])
  const [marquee, setMarquee] = useState<Box | null>(null)
  const artboardRef = useRef(artboard)
  useEffect(() => {
    artboardRef.current = artboard
  }, [artboard])

  /** Screen point → overlay pixels; the editor box may be scaled during a zoom. */
  const local = useCallback(() => {
    const container = root.current?.parentElement
    if (!container) return null
    const rect = container.getBoundingClientRect()
    const scale = rect.width / (container.offsetWidth || 1) || 1
    return (left: number, top: number, width = 0, height = 0): Box => ({
      left: (left - rect.left) / scale,
      top: (top - rect.top) / scale,
      width: width / scale,
      height: height / scale,
    })
  }, [])

  // Keep the selection box on the layers through edits, reloads and zoom.
  useEffect(() => {
    if (!layers.length) {
      setBox(null)
      setOutlines([])
      return
    }
    let frame = 0
    let last = ''
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const stage = activeStage()
      const toLocal = local()
      if (!stage || !toLocal) return
      const rects = layers.flatMap((ref) => {
        const rect = layerElement(stage, ref)?.getBoundingClientRect()
        return rect && (rect.width || rect.height)
          ? [toLocal(rect.left, rect.top, rect.width, rect.height)]
          : []
      })
      const key = JSON.stringify(rects)
      if (key === last) return
      last = key
      setOutlines(rects)
      if (!rects.length) return setBox(null)
      const left = Math.min(...rects.map((rect) => rect.left))
      const top = Math.min(...rects.map((rect) => rect.top))
      const right = Math.max(...rects.map((rect) => rect.left + rect.width))
      const bottom = Math.max(...rects.map((rect) => rect.top + rect.height))
      setBox({ left, top, width: right - left, height: bottom - top })
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [layers, local])

  useEffect(() => {
    const container = root.current?.parentElement
    if (!container || !canEdit) return
    const stop = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    /** Move the given layers with the pointer, then store the move as one edit. */
    const drag = (start: PointerEvent, refs: LayerRef[]) => {
      const stage = activeStage()
      if (!stage) return
      const bounds = stage.getBoundingClientRect()
      const canvas = stage.querySelector<HTMLElement>('[data-html-canvas]') ?? stage
      const inner = canvas.getBoundingClientRect().width / (canvas.offsetWidth || 1) || 1
      const nodes = refs.flatMap((ref) => {
        const node = layerElement(stage, ref)
        return node instanceof HTMLElement || node instanceof SVGElement ? [node] : []
      })
      let dx = 0
      let dy = 0
      const move = (event: PointerEvent) => {
        dx = event.clientX - start.clientX
        dy = event.clientY - start.clientY
        if (Math.hypot(dx, dy) < 3) return
        for (const node of nodes) node.style.translate = `${dx / inner}px ${dy / inner}px`
      }
      const up = async () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (Math.hypot(dx, dy) >= 3) await actions.move(refs, dx / bounds.width, dy / bounds.height)
        for (const node of nodes) node.style.translate = ''
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
    /** Select every layer a Shift-drag marquee touches. */
    const select = (start: PointerEvent) => {
      const stage = activeStage()
      const toLocal = local()
      if (!stage || !toLocal) return
      const additive = useCanvasUi.getState().layers
      const rectFrom = (event: PointerEvent) => ({
        left: Math.min(start.clientX, event.clientX),
        top: Math.min(start.clientY, event.clientY),
        right: Math.max(start.clientX, event.clientX),
        bottom: Math.max(start.clientY, event.clientY),
      })
      const move = (event: PointerEvent) => {
        const rect = rectFrom(event)
        setMarquee(toLocal(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
      }
      const up = (event: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setMarquee(null)
        const rect = rectFrom(event)
        if (rect.right - rect.left < 3 && rect.bottom - rect.top < 3) return
        const touched = drawnLayers(stage)
          .filter(
            ({ rect: layer }) =>
              layer.left < rect.right &&
              layer.right > rect.left &&
              layer.top < rect.bottom &&
              layer.bottom > rect.top
          )
          .map(({ ref }) => ref)
        useCanvasUi.getState().selectLayers([...additive, ...touched.flatMap(expand)])
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    /** A layer, or its whole group when the group is not entered. */
    const expand = (ref: LayerRef): LayerRef[] => {
      const group = unitOf(artboardRef.current, ref)
      return group && useCanvasUi.getState().enteredGroup !== group.id ? group.layers : [ref]
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      const ui = useCanvasUi.getState()
      if (ui.tool === 'hand' || ui.editingText) return
      if (event.target instanceof Element && event.target.closest('[data-layer-ui]')) return
      const stage = activeStage()
      if (!stage) return
      if (ui.tool === 'text') {
        stop(event)
        const bounds = stage.getBoundingClientRect()
        void actions
          .addText({
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height,
          })
          .then((id) => {
            ui.setTool('select')
            if (id) useCanvasUi.getState().editText(id)
          })
        return
      }
      const ref = layerAt(event.target)
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        stop(event)
        void actions.ensureIds()
        if (!ref) return select(event)
        const current = ui.layers.length
          ? ui.layers
          : [editorLayer()].flatMap((item) => (item ? expand(item) : []))
        const members = expand(ref)
        const present = members.every((member) => current.some((item) => sameLayer(item, member)))
        clearEditorSelection()
        ui.selectLayers(
          present
            ? current.filter((item) => !members.some((member) => sameLayer(item, member)))
            : [...current, ...members]
        )
        return
      }
      if (!ref) {
        if (ui.layers.length) ui.selectLayers([])
        if (ui.enteredGroup) ui.enterGroup(null)
        return
      }
      const group = unitOf(artboardRef.current, ref)
      if (group && ui.enteredGroup === group.id) {
        if (ui.layers.length) ui.selectLayers([])
        return
      }
      const selected = ui.layers.some((item) => sameLayer(item, ref))
      if (group || (selected && ui.layers.length > 1)) {
        stop(event)
        clearEditorSelection()
        if (ui.enteredGroup) ui.enterGroup(null)
        const refs = selected ? ui.layers : group!.layers
        if (!selected) useCanvasUi.getState().selectLayers(refs)
        drag(event, refs)
        return
      }
      if (ui.layers.length) ui.selectLayers([])
      if (ui.enteredGroup) ui.enterGroup(null)
    }
    const doubleClick = (event: MouseEvent) => {
      const ui = useCanvasUi.getState()
      const ref = layerAt(event.target)
      if (!ref || ui.editingText) return
      const group = unitOf(artboardRef.current, ref)
      if (group && ui.enteredGroup !== group.id) {
        stop(event)
        ui.enterGroup(group.id)
        selectInEditor(ref)
        return
      }
      if (ref.kind === 'text') {
        stop(event)
        ui.selectLayers([])
        ui.editText(ref.id)
      }
    }
    container.addEventListener('pointerdown', down, true)
    container.addEventListener('dblclick', doubleClick, true)
    return () => {
      container.removeEventListener('pointerdown', down, true)
      container.removeEventListener('dblclick', doubleClick, true)
    }
  }, [actions, canEdit, local])

  const group = layers.length > 1 ? groupOf(artboard.groups, layers[0]!) : undefined
  const isGroup =
    group &&
    group.layers.length === layers.length &&
    group.layers.every((member) => layers.some((item) => sameLayer(item, member)))
  const instance = instanceOfSelection(artboard, layers)
  const label = instance
    ? `◇ ${componentName(instance.componentId) ?? 'Component'}`
    : isGroup
      ? group!.name
      : layers.length > 1
        ? `${layers.length} layers`
        : null
  const accent = instance ? '#9333ea' : '#2563eb'

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-20" data-layer-ui>
      {outlines.map((outline, index) => (
        <div
          key={index}
          className="absolute"
          style={{ ...outline, outline: `1px solid ${accent}`, outlineOffset: 0, opacity: 0.6 }}
        />
      ))}
      {box ? (
        <div
          data-testid="layer-selection"
          aria-label={label ?? 'Selected layer'}
          className="absolute"
          style={{ ...box, outline: `2px solid ${accent}`, outlineOffset: 2 }}
        >
          {label ? (
            <span
              className="absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
              style={{ background: accent }}
            >
              {label}
            </span>
          ) : null}
        </div>
      ) : null}
      {marquee ? (
        <div
          data-testid="layer-marquee"
          className="absolute border border-blue-500 bg-blue-500/10"
          style={marquee}
        />
      ) : null}
      {editingText ? (
        <InlineText key={editingText} id={editingText} actions={actions} toLocal={local} />
      ) : null}
    </div>
  )
}

/**
 * Typing into a text layer on the stage. The text is edited in place, in
 * the layer's own font and size; Enter adds a line, ⌘/Ctrl+Enter or a click
 * elsewhere keeps it, and Escape puts the old text back. Emptying it deletes
 * the layer.
 */
function InlineText({
  id,
  actions,
  toLocal,
}: {
  id: string
  actions: LayerActions
  toLocal: () => ((left: number, top: number, width?: number, height?: number) => Box) | null
}) {
  const field = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)
  const original = useRef<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    let hidden: HTMLElement | null = null
    let frame = 0
    let tries = 0
    // A layer just added by the text tool is drawn a frame or two after the edit lands.
    const attach = () => {
      const stage = activeStage()
      const map = toLocal()
      const node = stage ? layerElement(stage, { kind: 'text', id }) : null
      if (!(node instanceof HTMLElement) || !map || !node.offsetWidth) {
        if (++tries < 90) frame = requestAnimationFrame(attach)
        else useCanvasUi.getState().editText(null)
        return
      }
      clearEditorSelection()
      const rect = node.getBoundingClientRect()
      const scale = rect.width / (node.offsetWidth || 1) || 1
      const box = map(rect.left, rect.top, rect.width, rect.height)
      const editor = node.closest<HTMLElement>('[data-canvas-editor]')!
      const outer = editor.getBoundingClientRect().width / (editor.offsetWidth || 1) || 1
      const computed = getComputedStyle(node)
      const size = (value: string) => `${(parseFloat(value) * scale) / outer}px`
      original.current =
        useImageStore.getState().textOverlays.find((text) => text.id === id)?.text ?? node.innerText
      setStyle({
        left: box.left,
        top: box.top,
        minWidth: box.width,
        minHeight: box.height,
        maxWidth:
          computed.whiteSpace.startsWith('pre') || computed.whiteSpace === 'nowrap'
            ? undefined
            : box.width,
        fontFamily: computed.fontFamily,
        fontWeight: computed.fontWeight,
        fontStyle: computed.fontStyle,
        fontSize: size(computed.fontSize),
        lineHeight: computed.lineHeight === 'normal' ? 'normal' : size(computed.lineHeight),
        letterSpacing:
          computed.letterSpacing === 'normal' ? undefined : size(computed.letterSpacing),
        textAlign: computed.textAlign as React.CSSProperties['textAlign'],
        color: computed.color === 'rgba(0, 0, 0, 0)' ? '#111827' : computed.color,
      })
      node.style.visibility = 'hidden'
      hidden = node
    }
    attach()
    return () => {
      cancelAnimationFrame(frame)
      if (hidden) hidden.style.visibility = ''
    }
  }, [id, toLocal])

  useEffect(() => {
    const element = field.current
    if (!style || !element) return
    element.innerText = original.current ?? ''
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [style])

  const finish = (keep: boolean) => {
    if (done.current) return
    done.current = true
    const text = (field.current?.innerText ?? '').replace(/\n$/, '')
    if (keep && text !== original.current) void actions.writeText(id, text)
    useCanvasUi.getState().editText(null)
  }

  if (!style) return null
  return (
    <div
      ref={field}
      role="textbox"
      aria-label="Edit text"
      aria-multiline="true"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-testid="inline-text-editor"
      className="pointer-events-auto absolute whitespace-pre-wrap break-words bg-transparent outline outline-2 outline-offset-2 outline-blue-500"
      style={style}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          finish(true)
        }
      }}
      onPaste={(event) => {
        event.preventDefault()
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
      }}
    />
  )
}
