'use client'

import type { StoreApi } from 'zustand'
import type { EditorState } from '@/components/store-screenshots/studio/editor-store'
import { createImageLayer } from '@/lib/store-screenshots/document/elements'
import { ingestImageFile } from '@/lib/store-screenshots/persistence/ingest'

/** Where picked images go: a device's screen, the selected slides' background, or a new image layer. */
export type StoreImageTarget =
  { kind: 'device'; slideId: string; layerId: string } | { kind: 'image' | 'background' }

/**
 * Add picked image files to an embedded store editor as native store
 * commands: replace a device's screenshot, set the background, or add an
 * image layer. The host saves them like any other store edit.
 */
export async function addStoreImages(
  store: StoreApi<EditorState>,
  files: File[],
  target: StoreImageTarget
) {
  for (const file of files) {
    const asset = await ingestImageFile(file)
    const state = store.getState()
    const owner = {
      kind: 'slide' as const,
      id: target.kind === 'device' ? target.slideId : state.activeSlideId,
    }
    if (target.kind === 'device')
      state.dispatchMany(
        [
          { type: 'assets.add', assets: [asset] },
          {
            type: 'layers.patch',
            owner,
            layerIds: [target.layerId],
            patch: {
              assetId: asset.id,
              image: { mode: 'fill', scale: 1, offsetX: 0, offsetY: 0 },
            },
          },
        ],
        'Replace screenshot'
      )
    else if (target.kind === 'background')
      state.dispatchMany(
        [
          { type: 'assets.add', assets: [asset] },
          {
            type: 'slides.patch',
            slideIds: state.selectedSlideIds,
            patch: {
              background: {
                kind: 'image',
                assetId: asset.id,
                fit: 'cover',
                focusX: 50,
                focusY: 50,
                color: asset.topColor,
              },
            },
          },
        ],
        'Change background'
      )
    else
      state.dispatchMany(
        [
          { type: 'assets.add', assets: [asset] },
          { type: 'layers.add', owner, layers: [createImageLayer(asset.id, asset.name)] },
        ],
        'Add image'
      )
  }
}
