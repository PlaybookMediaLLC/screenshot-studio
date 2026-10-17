'use client'

import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { MAX_DEVICE_MOCKUPS } from '@/lib/constants/mockups'
import { createDeviceScreen, createMockup } from '@/lib/device-mockups/layouts'
import { validateImageFile } from '@/lib/editor/import-images'
import { blobToDataUrl } from '@/lib/image-storage'
import { type ImageState, useImageStore, withHistoryStep } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import { useEditorPanels } from '@/lib/store/editor-panels'
import type { Mockup } from '@/types/mockup'
import { createCodeContent } from './code'
import { arrangeScreens } from './arrange'
import { type CompositionLayoutId, compositionLayoutSchema } from './layouts'
import { LEGACY_BROWSER_FRAMES, mainFrameSpec } from './main-frame'
import {
  type CodeContent,
  DEFAULT_FRAME_CHROME,
  type DeviceOrientation,
  type FrameChrome,
  type FrameKind,
  type ScreenFrame,
} from './schema'

/**
 * Editor commands for framed screens and compositions. Each one is a single
 * undo step and goes through the store, so the canvas, previews, exports,
 * autosave, and history all see the same change.
 *
 * A composition is the store's `mockups` list shown in `device` mode: every
 * screen has its own frame (none, browser, window, or device), position,
 * size, and content. A single screenshot becomes the first screen when a
 * second one is added.
 */

/** Most screens one composition holds. */
export const MAX_SCREENS = MAX_DEVICE_MOCKUPS

/** The device a screen remembers until it is shown on another. */
const DEFAULT_DEVICE_ID = 'iphone-17-pro-front'

/** True when the canvas draws the screens of a composition rather than the main screenshot. */
export function isScreenScene(state: Pick<ImageState, 'editorMode' | 'mockups'>): boolean {
  return state.editorMode === 'device' && state.mockups.length > 0
}

/** The canvas's width / height. */
export function canvasAspectOf(
  state: Pick<ImageState, 'customDimensions' | 'selectedAspectRatio'>
): number {
  if (state.selectedAspectRatio === 'custom' && state.customDimensions) {
    return state.customDimensions.width / state.customDimensions.height
  }
  const preset = getAspectRatioPreset(state.selectedAspectRatio)
  return preset ? preset.width / preset.height : 4 / 3
}

const clampAspect = (aspect: number) => Math.min(20, Math.max(0.05, aspect))

/** An image's width / height, loaded from a URL. */
export function imageAspect(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(clampAspect(image.naturalWidth / Math.max(1, image.naturalHeight)))
    image.onerror = () => reject(new Error("That image couldn't be read."))
    image.src = src
  })
}

async function fileAspect(file: File): Promise<number> {
  const bitmap = await createImageBitmap(file)
  try {
    return clampAspect(bitmap.width / Math.max(1, bitmap.height))
  } finally {
    bitmap.close()
  }
}

/** The frame the main screenshot has now, as a screen frame. */
function mainScreenFrame(state: ImageState): ScreenFrame {
  const spec = mainFrameSpec(state.imageBorder, state.frameChrome, state.browserUrl)
  return spec.kind === 'browser' || spec.kind === 'window'
    ? { chrome: { ...spec.chrome }, kind: spec.kind }
    : { kind: 'none' }
}

/**
 * The screens a composition starts from: its own, or the main screenshot as
 * the first screen, in the frame it has now.
 */
async function startingScreens(state: ImageState): Promise<Mockup[]> {
  if (state.mockups.length > 0) return state.mockups
  if (!state.uploadedImageUrl) return []
  const aspect = await imageAspect(state.uploadedImageUrl).catch(() => undefined)
  const screen = createDeviceScreen(state.uploadedImageUrl, state.imageName)
  return [
    { ...createMockup(DEFAULT_DEVICE_ID, { ...screen, aspect }), frame: mainScreenFrame(state) },
  ]
}

function preferredLayout(state: ImageState, count: number): CompositionLayoutId {
  const active = compositionLayoutSchema.safeParse(state.activeDeviceLayoutId)
  if (active.success) return active.data
  return count <= 2 ? 'side-by-side' : 'bento'
}

/** Write a composition: the screens, laid out, shown on the canvas. */
function writeComposition(screens: Mockup[], layout: CompositionLayoutId) {
  const state = useImageStore.getState()
  useImageStore.setState({
    activeDeviceLayoutId: layout,
    deviceLayoutSnapshot: null,
    editorMode: 'device',
    mockups: arrangeScreens(screens, layout, canvasAspectOf(state)),
  })
}

/** The outcome of adding screenshots. */
export type AddScreensResult = { added: number; rejected: { name: string; reason: string }[] }

/**
 * Add screenshots to the composition, each in the same frame as the screen
 * they join, and lay them out again. The first addition to a single
 * screenshot turns it into a composition.
 */
export async function addScreenshots(files: readonly File[]): Promise<AddScreensResult> {
  const rejected: AddScreensResult['rejected'] = []
  const valid = files.filter((file) => {
    const reason = validateImageFile(file)
    if (reason) rejected.push({ name: file.name, reason })
    return !reason
  })
  const state = useImageStore.getState()
  const base = await startingScreens(state)
  const room = Math.max(0, MAX_SCREENS - base.length)
  for (const file of valid.slice(room)) {
    rejected.push({ name: file.name, reason: `A composition holds up to ${MAX_SCREENS} screens.` })
  }
  const accepted = valid.slice(0, room)
  if (accepted.length === 0) return { added: 0, rejected }

  const measured = await Promise.all(
    accepted.map(async (file) => ({ aspect: await fileAspect(file), file }))
  )
  const selectedId = useDeviceUIStore.getState().selectedDeviceId
  const model = base.find((screen) => screen.id === selectedId) ?? base[0]
  const frame = model?.frame ?? (model ? undefined : mainScreenFrame(state))
  const added = measured.map(({ aspect, file }, index) => ({
    ...createMockup(
      model?.definitionId ?? DEFAULT_DEVICE_ID,
      {
        ...createDeviceScreen(URL.createObjectURL(file), file.name, true),
        aspect,
      },
      base.length + index
    ),
    ...(frame ? { frame: structuredClone(frame) } : {}),
    ...(model?.color ? { color: model.color } : {}),
    ...(model?.orientation ? { orientation: model.orientation } : {}),
  }))
  const screens = [...base, ...added]
  withHistoryStep(() => writeComposition(screens, preferredLayout(state, screens.length)))
  useDeviceUIStore.getState().setSelectedDeviceId(null)
  return { added: added.length, rejected }
}

/** Add a code screen in a window frame, select it, and open its properties. */
export async function addCodeScreen(code?: string): Promise<string | null> {
  const state = useImageStore.getState()
  const base = await startingScreens(state)
  if (base.length >= MAX_SCREENS) return null
  const screen: Mockup = {
    ...createMockup(
      DEFAULT_DEVICE_ID,
      { ...createDeviceScreen(null, 'Code'), code: createCodeContent(code) },
      base.length
    ),
    frame: {
      chrome: { ...DEFAULT_FRAME_CHROME, title: 'studio.ts', window: 'macos' },
      kind: 'window',
    },
  }
  const screens = [...base, screen]
  withHistoryStep(() => writeComposition(screens, preferredLayout(state, screens.length)))
  useDeviceUIStore.getState().setSelectedDeviceId(screen.id)
  useEditorPanels.getState().showTab('edit')
  return screen.id
}

/** Lay the composition out again with a composition layout. */
export function applyCompositionLayout(layout: CompositionLayoutId) {
  const state = useImageStore.getState()
  useImageStore.setState({
    activeDeviceLayoutId: layout,
    deviceLayoutSnapshot: null,
    mockups: arrangeScreens(state.mockups, layout, canvasAspectOf(state)),
  })
}

/** Re-run the active composition layout after screens changed shape. */
function relayout(mockups: Mockup[], state: ImageState): Pick<ImageState, 'mockups'> {
  const layout = compositionLayoutSchema.safeParse(state.activeDeviceLayoutId)
  return {
    mockups: layout.success ? arrangeScreens(mockups, layout.data, canvasAspectOf(state)) : mockups,
  }
}

/** A change to screens' frames: the kind, chrome options, and device choices. */
export type ScreenFrameChange = {
  chrome?: Partial<FrameChrome>
  color?: string
  definitionId?: string
  kind?: FrameKind
  orientation?: DeviceOrientation
}

/**
 * Change the frame of some screens. Content, crop, and the other frame
 * kinds' settings are kept, so switching frames never loses the screenshot.
 */
export function setScreensFrame(ids: readonly string[], change: ScreenFrameChange) {
  const state = useImageStore.getState()
  const mockups = state.mockups.map((mockup) => {
    if (!ids.includes(mockup.id)) return mockup
    const kind = change.kind ?? mockup.frame?.kind ?? 'device'
    const chrome = { ...DEFAULT_FRAME_CHROME, ...mockup.frame?.chrome, ...change.chrome }
    const definitionChanged =
      change.definitionId !== undefined && change.definitionId !== mockup.definitionId
    return {
      ...mockup,
      definitionId: change.definitionId ?? mockup.definitionId,
      frame: { chrome, kind },
      ...(change.color !== undefined
        ? { color: change.color }
        : definitionChanged
          ? { color: undefined }
          : {}),
      ...(change.orientation !== undefined ? { orientation: change.orientation } : {}),
    }
  })
  useImageStore.setState(relayout(mockups, state))
}

/**
 * Show the main screenshot on a device: it becomes a composition of one
 * device screen.
 */
export async function showMainOnDevice(definitionId: string) {
  const state = useImageStore.getState()
  const base = await startingScreens(state)
  const screens = base.map((screen) => ({
    ...screen,
    definitionId,
    frame: { ...screen.frame, kind: 'device' as const },
  }))
  if (screens.length === 0) return
  withHistoryStep(() => writeComposition(screens, preferredLayout(state, screens.length)))
}

/** The main screenshot's frame kinds in the Frame panel. */
export type MainFrameChoice = 'screenshot' | 'browser' | 'window'

/** Put the main screenshot in no chrome, a browser, or a window. */
export function setMainFrame(choice: MainFrameChoice) {
  withHistoryStep(() => {
    const state = useImageStore.getState()
    if (choice === 'screenshot') {
      state.setEditorMode('screenshot')
      return
    }
    const legacy = LEGACY_BROWSER_FRAMES[state.imageBorder.type]
    useImageStore.setState({
      editorMode: 'browser',
      frameChrome: legacy ? { ...state.frameChrome, ...legacy } : state.frameChrome,
      imageBorder: { ...state.imageBorder, enabled: true, title: state.browserUrl, type: choice },
    })
  })
}

/** Change the main screenshot's chrome options; a legacy browser frame becomes the same browser. */
export function setMainChrome(changes: Partial<FrameChrome>) {
  withHistoryStep(() => {
    const state = useImageStore.getState()
    const { address, ...rest } = changes
    const legacy = LEGACY_BROWSER_FRAMES[state.imageBorder.type]
    if (legacy) {
      useImageStore.setState({ imageBorder: { ...state.imageBorder, type: 'browser' } })
    }
    useImageStore.setState({ frameChrome: { ...state.frameChrome, ...legacy, ...rest } })
    if (address !== undefined) state.setBrowserUrl(address)
  })
}

/** Move a screen to a new place in the stacking order (0 is the bottom). */
export function moveScreen(id: string, toIndex: number) {
  const { mockups } = useImageStore.getState()
  const from = mockups.findIndex((mockup) => mockup.id === id)
  const to = Math.max(0, Math.min(mockups.length - 1, toIndex))
  if (from === -1 || from === to) return
  const next = [...mockups]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  useImageStore.setState({ mockups: next })
}

/** Show another image on a screen. Its frame refits the new image; crop resets. */
export async function replaceScreenImage(id: string, file: File) {
  const reason = validateImageFile(file)
  if (reason) throw new Error(reason)
  const [src, aspect] = await Promise.all([blobToDataUrl(file), fileAspect(file)])
  const state = useImageStore.getState()
  const mockups = state.mockups.map((mockup) => {
    if (mockup.id !== id) return mockup
    const { code: _code, ...screen } = mockup.screen
    return {
      ...mockup,
      screen: {
        ...screen,
        aspect,
        isCustom: true,
        name: file.name,
        offset: { x: 0, y: 0 },
        scale: 1,
        src,
      },
    }
  })
  useImageStore.setState(relayout(mockups, state))
}

/** Edit a code screen's code or options. */
export function updateScreenCode(id: string, changes: Partial<CodeContent>) {
  const state = useImageStore.getState()
  const mockups = state.mockups.map((mockup) =>
    mockup.id === id && mockup.screen.code
      ? { ...mockup, screen: { ...mockup.screen, code: { ...mockup.screen.code, ...changes } } }
      : mockup
  )
  useImageStore.setState(relayout(mockups, state))
}
