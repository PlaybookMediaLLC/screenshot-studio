'use client'

import type { TRPCClient } from '@trpc/client'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { beginHistoryStep, endHistoryStep, useImageStore } from '@/lib/store'
import type { AppRouter } from '@/lib/trpc/router'
import {
  applyDesignDocument,
  applyDesignLayout,
  type DesignHistoryMode,
  waitForSettledCanvas,
} from './apply'
import { type DesignDocument, getDesignAssetIds } from './document'

/** Workspace images fetched on this page, by asset id. Assets never change bytes. */
const assetUrls = new Map<string, Promise<string>>()

/** A workspace image as a blob URL, fetched once per page. */
export function fetchAssetUrl(trpcClient: TRPCClient<AppRouter>, assetId: string) {
  let url = assetUrls.get(assetId)
  if (!url) {
    url = (async () => {
      const { downloadUrl } = await trpcClient.asset.signDownload.query({ assetId })
      const response = await fetch(downloadUrl)
      if (!response.ok) throw new Error(`The download failed with status ${response.status}.`)
      return URL.createObjectURL(await response.blob())
    })()
    url.catch(() => assetUrls.delete(assetId))
    assetUrls.set(assetId, url)
  }
  return url
}

/**
 * Fetch every workspace image a document names into a blob URL, keyed by its
 * `asset:<id>` reference, so the editor's export never sees a cross-origin image.
 */
export async function fetchDesignSources(
  trpcClient: TRPCClient<AppRouter>,
  document: DesignDocument
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    getDesignAssetIds(document).map(
      async (assetId) => [`asset:${assetId}`, await fetchAssetUrl(trpcClient, assetId)] as const
    )
  )
  return Object.fromEntries(entries)
}

/**
 * Write a stored document into the editor, workspace images included, and
 * return the blob URL each `asset:` reference was loaded as.
 *
 * `history: 'clear'` makes the document the new starting point (deep links);
 * `'step'` makes it one undoable step (an AI variation, a restored version).
 * `replace` also removes a main image the document does not have, so the
 * editor shows exactly the document rather than keeping the current screenshot.
 */
export async function applyStoredDocument(
  trpcClient: TRPCClient<AppRouter>,
  document: DesignDocument,
  history: DesignHistoryMode = 'clear',
  { replace = false }: { replace?: boolean } = {}
): Promise<Record<string, string>> {
  const sources = await fetchDesignSources(trpcClient, document)
  const resolve = (ref: string) => sources[ref] ?? ref
  const start = history === 'step' ? beginHistoryStep() : 0
  if (replace && !document.image.src) useImageStore.getState().clearImage()
  applyDesignDocument(document, resolve, history)
  const preset = getAspectRatioPreset(useImageStore.getState().selectedAspectRatio)
  const canvas = await waitForSettledCanvas(preset ? preset.width / preset.height : null)
  applyDesignLayout(document, resolve, canvas, history)
  if (history === 'step') endHistoryStep(start)
  return sources
}

/** Open a stored design in the editor. See {@link applyStoredDocument} for `history`. */
export async function openDesignInEditor(
  trpcClient: TRPCClient<AppRouter>,
  designId: string,
  history: DesignHistoryMode = 'clear'
) {
  const { design } = await trpcClient.design.get.query({ designId })
  await applyStoredDocument(trpcClient, design.document, history)
  return design
}
