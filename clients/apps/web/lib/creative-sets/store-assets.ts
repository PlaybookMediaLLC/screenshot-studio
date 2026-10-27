'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { fetchAssetUrl } from '@/lib/design/open-design'
import { saveExportToWorkspace } from '@/lib/workspace/save-export'
import { getAssetBlob } from '@/lib/store-screenshots/persistence/projects'
import { readStoreDocument } from '@/lib/store-screenshots/document/migrate'
import { storeGroupSchema, type StoreGroup } from './store-schema'
import { resolvedDocumentHash } from './delivery'

async function hashBytes(blob: Blob) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
}

/** Load a native asset through its workspace mapping, falling back to local bytes for a new edit. */
export async function loadStoreAsset(
  client: TRPCClient<AppRouter>,
  group: StoreGroup,
  id: string
): Promise<Blob | null> {
  const reference = group.assetMap[id]
  if (reference) {
    const response = await fetch(await fetchAssetUrl(client, reference.slice(6)))
    if (!response.ok) throw new Error('A store asset could not be loaded from this workspace.')
    return response.blob()
  }
  const local = await getAssetBlob(id)
  if (local) return local
  const src = group.document.assets[id]?.src
  if (!src) return null
  const response = await fetch(src)
  if (!response.ok) throw new Error('A local store asset could not be read.')
  return response.blob()
}

/** Upload and read back every new binary; original IndexedDB projects and bytes remain untouched. */
export async function uploadStoreGroupAssets(
  client: TRPCClient<AppRouter>,
  group: StoreGroup,
  verifiedUploads = new Map<string, string>()
): Promise<StoreGroup> {
  const next = structuredClone(group)
  for (const [id, meta] of Object.entries(next.document.assets)) {
    if (!next.assetMap[id]) {
      const blob = await loadStoreAsset(client, group, id)
      if (!blob)
        throw new Error(
          `Missing local asset: ${meta.name}. Keep the original project until its images are available.`
        )
      const typed = blob.type === meta.mime ? blob : new Blob([blob], { type: meta.mime })
      const hash = await hashBytes(blob)
      const known = verifiedUploads.get(hash)
      if (known) {
        next.assetMap[id] = known
        meta.src = null
        continue
      }
      const saved = await saveExportToWorkspace({
        blob: typed,
        fileName: meta.name.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 128) || 'store-asset',
        trpcClient: client,
      })
      next.assetMap[id] = `asset:${saved.assetId}`
      const remote = await loadStoreAsset(client, next, id)
      if (!remote || (await hashBytes(remote)) !== hash)
        throw new Error(
          'The workspace copy failed byte verification. The local project is still intact.'
        )
      verifiedUploads.set(hash, next.assetMap[id]!)
    }
    meta.src = null
  }
  return storeGroupSchema.parse(next)
}

/** Upgrade v1/v2 through the native reader and preserve native IDs, groups, typography and translations. */
export async function migrateStoreProject(
  client: TRPCClient<AppRouter>,
  raw: unknown,
  verifiedUploads = new Map<string, string>()
): Promise<StoreGroup> {
  const { document } = readStoreDocument(raw)
  return uploadStoreGroupAssets(
    client,
    {
      id: crypto.randomUUID(),
      kind: 'store',
      name: document.name,
      document,
      assetMap: {},
      bindings: [],
      review: { source: false, wording: false },
      origin: {
        id: document.id,
        revision: document.revision,
        copiedAt: new Date().toISOString(),
        documentHash: await resolvedDocumentHash(document),
      },
    },
    verifiedUploads
  )
}
