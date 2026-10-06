'use client'

import type { TRPCClient } from '@trpc/client'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { useImageStore } from '@/lib/store'
import type { AppRouter } from '@/lib/trpc/router'
import {
  applyDesignDocument,
  applyDesignLayout,
  beginHistoryStep,
  type DesignHistoryMode,
  endHistoryStep,
  waitForSettledCanvas,
} from './apply'
import { getDesignAssetIds } from './document'

/**
 * Open a stored design in the editor. Workspace images are fetched into blob
 * URLs so the editor's export never sees a cross-origin image.
 *
 * `history: 'clear'` makes the design the new starting point (deep links);
 * `'step'` makes opening it one undoable step (choosing an AI variation).
 */
export async function openDesignInEditor(
  trpcClient: TRPCClient<AppRouter>,
  designId: string,
  history: DesignHistoryMode = 'clear'
) {
  const { design } = await trpcClient.design.get.query({ designId })
  const sources: Record<string, string> = {}
  for (const assetId of getDesignAssetIds(design.document)) {
    const { downloadUrl } = await trpcClient.asset.signDownload.query({ assetId })
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error(`The download failed with status ${response.status}.`)
    sources[`asset:${assetId}`] = URL.createObjectURL(await response.blob())
  }
  const resolve = (ref: string) => sources[ref] ?? ref
  const start = history === 'step' ? beginHistoryStep() : 0
  applyDesignDocument(design.document, resolve, history === 'step' ? 'step' : 'clear')
  const preset = getAspectRatioPreset(useImageStore.getState().selectedAspectRatio)
  const canvas = await waitForSettledCanvas(preset ? preset.width / preset.height : null)
  applyDesignLayout(design.document, resolve, canvas, history === 'step' ? 'step' : 'clear')
  if (history === 'step') endHistoryStep(start)
  return design
}
