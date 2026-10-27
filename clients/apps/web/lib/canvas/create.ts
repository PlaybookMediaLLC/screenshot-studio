'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { newCreativeSetId } from '@/lib/creative-sets/document'
import { fetchAssetUrl } from '@/lib/design/open-design'
import { uploadDesignSources } from '@/lib/design/upload-sources'
import { validateImageContents } from '@/lib/editor/import-images'
import { canvasDocumentSchema, type ArtboardInput, type CanvasDocument } from './document'
import type { RecipeScreenshot } from './recipes'

/** Pixel size of an image URL, read by the browser. */
async function imageSize(url: string): Promise<{ width: number; height: number }> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  if (!image.naturalWidth) throw new Error('The image is empty.')
  return { width: image.naturalWidth, height: image.naturalHeight }
}

/** A chosen file as a recipe screenshot. Saving uploads it to workspace assets. */
export async function screenshotFromFile(file: File): Promise<RecipeScreenshot> {
  const problem = await validateImageContents(file)
  if (problem) throw new Error(problem)
  const src = URL.createObjectURL(file)
  return { src, name: file.name.slice(0, 200) || 'Screenshot', ...(await imageSize(src)) }
}

/** A local image URL (one not uploaded yet) as a recipe screenshot. */
export async function screenshotFromUrl(src: string, name: string): Promise<RecipeScreenshot> {
  return { src, name: name.slice(0, 200) || 'Screenshot', ...(await imageSize(src)) }
}

/** A workspace asset (a release or product surface screenshot) as a recipe screenshot. */
export async function screenshotFromAsset(
  client: TRPCClient<AppRouter>,
  assetId: string,
  name: string
): Promise<RecipeScreenshot> {
  const url = await fetchAssetUrl(client, assetId)
  return {
    src: `asset:${assetId}`,
    name: name.slice(0, 200) || 'Screenshot',
    ...(await imageSize(url)),
  }
}

/** What a new canvas is made of, fixed once so a retried request creates exactly one canvas. */
export type CanvasIntent = { id: string; name: string; document: CanvasDocument }

/** Validate artboards into a new canvas document with a stable creation id. */
export function canvasIntent(name: string, artboards: ArtboardInput[]): CanvasIntent {
  return {
    id: newCreativeSetId(),
    name: name.trim().slice(0, 200) || 'Untitled canvas',
    document: canvasDocumentSchema.parse({ version: 1, kind: 'canvas', artboards }),
  }
}

/**
 * Store a new canvas. Local images are uploaded first: the backend only
 * accepts workspace assets. Repeating the same intent replays rather than
 * duplicates, because the id travels with it.
 */
export async function createCanvas(client: TRPCClient<AppRouter>, intent: CanvasIntent) {
  const document = structuredClone(intent.document)
  for (const artboard of document.artboards)
    artboard.document = await uploadDesignSources(client, artboard.document)
  intent.document = document
  return client.canvas.create.mutate({ id: intent.id, name: intent.name, document })
}
