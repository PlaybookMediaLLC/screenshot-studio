'use client'

import { z } from 'zod'
import { create } from 'zustand'
import { DEFAULT_VIEWPORT, type ScreenSize, type Viewport } from './viewport'
import { layerKey, type LayerRef } from './layers'

/**
 * Board session state: what is selected, which artboard the native editor
 * holds, the tool, the grid and the camera. None of it is saved in the
 * document or undone; the camera is remembered per canvas on this device.
 */

/** Pointer tools: select and move, pan the board, or place text in the open artboard. */
export const canvasToolSchema = z.enum(['select', 'hand', 'text'])
/** One of {@link canvasToolSchema}. */
export type CanvasTool = z.infer<typeof canvasToolSchema>

/** Left panel tabs. `design` is the native editor's compose panel for the open artboard. */
export const leftTabSchema = z.enum(['insert', 'artboards', 'design'])
/** One of {@link leftTabSchema}. */
export type LeftTab = z.infer<typeof leftTabSchema>

/** Grid spacing choices, in workspace units. */
export const gridSizeSchema = z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)])
/** One of {@link gridSizeSchema}. */
export type GridSize = z.infer<typeof gridSizeSchema>

type CanvasUiState = {
  selection: string[]
  activeId: string | null
  tool: CanvasTool
  grid: { visible: boolean; snap: boolean; size: GridSize }
  leftTab: LeftTab
  leftOpen: boolean
  rightOpen: boolean
  renamingId: string | null
  /** Layers selected together in the open artboard. The editor's own selection holds one layer at a time. */
  layers: LayerRef[]
  /** The group whose layers are picked one at a time, after a double-click into it. */
  enteredGroup: string | null
  /** The text layer being typed into on the stage. */
  editingText: string | null
  select: (ids: string[]) => void
  toggle: (id: string) => void
  activate: (id: string | null) => void
  setTool: (tool: CanvasTool) => void
  setGrid: (grid: Partial<CanvasUiState['grid']>) => void
  setLeftTab: (tab: LeftTab) => void
  togglePanel: (side: 'left' | 'right') => void
  rename: (id: string | null) => void
  selectLayers: (layers: LayerRef[]) => void
  toggleLayer: (layer: LayerRef) => void
  enterGroup: (id: string | null) => void
  editText: (id: string | null) => void
  reset: () => void
}

const initial = {
  selection: [] as string[],
  activeId: null as string | null,
  tool: 'select' as CanvasTool,
  grid: { visible: true, snap: true, size: 16 as GridSize },
  leftTab: 'insert' as LeftTab,
  leftOpen: true,
  rightOpen: true,
  renamingId: null as string | null,
  layers: [] as LayerRef[],
  enteredGroup: null as string | null,
  editingText: null as string | null,
}

/** The open board's session state. */
export const useCanvasUi = create<CanvasUiState>((set) => ({
  ...initial,
  select: (ids) => set({ selection: [...new Set(ids)] }),
  toggle: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((item) => item !== id)
        : [...state.selection, id],
    })),
  activate: (id) =>
    set((state) => ({
      activeId: id,
      selection: id ? [id] : state.selection,
      leftTab: id ? state.leftTab : state.leftTab === 'design' ? 'insert' : state.leftTab,
      layers: [],
      enteredGroup: null,
      editingText: null,
      tool: state.tool === 'text' && !id ? 'select' : state.tool,
    })),
  setTool: (tool) => set({ tool }),
  setGrid: (grid) => set((state) => ({ grid: { ...state.grid, ...grid } })),
  setLeftTab: (leftTab) => set({ leftTab, leftOpen: true }),
  togglePanel: (side) =>
    set((state) =>
      side === 'left' ? { leftOpen: !state.leftOpen } : { rightOpen: !state.rightOpen }
    ),
  rename: (renamingId) => set({ renamingId }),
  selectLayers: (layers) =>
    set({ layers: [...new Map(layers.map((layer) => [layerKey(layer), layer])).values()] }),
  toggleLayer: (layer) =>
    set((state) => ({
      layers: state.layers.some((item) => layerKey(item) === layerKey(layer))
        ? state.layers.filter((item) => layerKey(item) !== layerKey(layer))
        : [...state.layers, layer],
    })),
  enterGroup: (enteredGroup) => set({ enteredGroup, layers: [] }),
  editText: (editingText) => set({ editingText }),
  reset: () => set(initial),
}))

type ViewportState = {
  viewport: Viewport
  screen: ScreenSize
  /** True while a pan or zoom gesture is moving the camera. */
  moving: boolean
  /** The zoom when the camera last came to rest; expensive work follows this, not every frame. */
  settledZoom: number
  setViewport: (viewport: Viewport) => void
  setScreen: (screen: ScreenSize) => void
  setMoving: (moving: boolean) => void
}

/** The camera, kept apart from selection so panning re-renders only what draws it. */
export const useCanvasViewport = create<ViewportState>((set) => ({
  viewport: DEFAULT_VIEWPORT,
  screen: { width: 1, height: 1 },
  moving: false,
  settledZoom: DEFAULT_VIEWPORT.zoom,
  setViewport: (viewport) =>
    set((state) => ({ viewport, settledZoom: state.moving ? state.settledZoom : viewport.zoom })),
  setScreen: (screen) => set({ screen }),
  setMoving: (moving) =>
    set((state) => ({ moving, settledZoom: moving ? state.settledZoom : state.viewport.zoom })),
}))

const viewportKey = (canvasId: string) => `canvas-viewport:${canvasId}`

/** The camera this device last used on a canvas, if any. */
export function rememberedViewport(canvasId: string): Viewport | null {
  try {
    const raw = window.localStorage.getItem(viewportKey(canvasId))
    if (!raw) return null
    const parsed = z
      .object({ panX: z.number().finite(), panY: z.number().finite(), zoom: z.number().positive() })
      .safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Remember the camera for this canvas on this device. */
export function rememberViewport(canvasId: string, viewport: Viewport) {
  try {
    window.localStorage.setItem(viewportKey(canvasId), JSON.stringify(viewport))
  } catch {
    /* Storage can be full or blocked; the camera is a convenience. */
  }
}
