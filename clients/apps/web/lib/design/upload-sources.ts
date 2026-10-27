'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { buildExportFileName, saveExportToWorkspace } from '@/lib/workspace/save-export'
import { type DesignDocument, getLocalDesignSources, mapDesignSources } from './document'

/**
 * Local (`blob:`/`data:`) image → its workspace `asset:<id>`, so each image
 * uploads once per page however many projects, presets, or brand kits use it.
 */
const uploads = new Map<string, string>()

/** Note images loaded from the workspace (`asset:<id>` → blob URL) as already uploaded. */
export function rememberUploadedSources(sources: Record<string, string>): void {
  for (const [ref, url] of Object.entries(sources)) uploads.set(url, ref)
}

/** The workspace reference of a local image, uploading it unless it already was. */
export async function uploadSource(
  trpcClient: TRPCClient<AppRouter>,
  ref: string,
  fileName?: string
): Promise<string> {
  const known = uploads.get(ref)
  if (known) return known
  const blob = await (await fetch(ref)).blob()
  const { assetId } = await saveExportToWorkspace({
    blob,
    fileName: fileName?.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 128) || buildExportFileName(blob.type),
    trpcClient,
  })
  uploads.set(ref, `asset:${assetId}`)
  return `asset:${assetId}`
}

/** The document with every local image uploaded and referenced as `asset:<id>`. */
export async function uploadDesignSources(
  trpcClient: TRPCClient<AppRouter>,
  document: DesignDocument
): Promise<DesignDocument> {
  // ponytail: uploads are remembered for this page only; after a reload, recovered
  // local images upload again. Key by content hash if that duplication matters.
  for (const ref of getLocalDesignSources(document)) {
    const name = ref === document.image.src ? document.image.name :
      document.slides?.items.find((slide) => slide.src === ref)?.name ??
      document.devices?.mockups.find((screen) => screen.screen.src === ref)?.screen.name
    await uploadSource(trpcClient, ref, name)
  }
  return withUploadedSources(document)
}

/** The document with images already uploaded referenced by asset id. Nothing is uploaded. */
export function withUploadedSources(document: DesignDocument): DesignDocument {
  return getLocalDesignSources(document).length
    ? mapDesignSources(document, (ref) => uploads.get(ref) ?? ref)
    : document
}
