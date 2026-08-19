'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'

/**
 * Save an editor export into the signed-in user's workspace.
 *
 * The editor is otherwise standalone: it keeps drafts in IndexedDB and
 * delivers exports as browser downloads, so nothing it produces reaches
 * the platform. This is the seam between the two, turning an export into
 * a tenant asset that campaigns, variants, and releases can reference.
 *
 * Upload runs against a presigned URL rather than through the
 * application, so image and video payloads never occupy a server request.
 * The flow mirrors the API that already backs programmatic uploads:
 * reserve an asset, PUT the bytes, then mark it complete.
 */

/** Matches the content types the tenant asset schema accepts. */
const SUPPORTED_CONTENT_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
])

/** Mirrors the server-side ceiling so oversized files fail before upload. */
const MAX_ASSET_BYTES = 50 * 1024 * 1024

export interface SaveToWorkspaceInput {
  blob: Blob
  fileName: string
  trpcClient: TRPCClient<AppRouter>
}

export interface SavedAsset {
  assetId: string
}

export class WorkspaceSaveError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported-type' | 'too-large' | 'upload-failed' | 'not-signed-in'
  ) {
    super(message)
    this.name = 'WorkspaceSaveError'
  }
}

/**
 * Hex-encoded SHA-256 of the payload.
 *
 * The API accepts a digest and uses it to confirm that the bytes that
 * arrived are the bytes that were intended, which catches a truncated or
 * corrupted upload at completion rather than when the asset is later
 * rendered into an artifact.
 */
async function digestBlob(blob: Blob): Promise<string | undefined> {
  // Subtle crypto requires a secure context. Local HTTP development is
  // the common case where it is absent, and the digest is optional
  // server-side, so a missing implementation weakens verification rather
  // than blocking the save.
  if (!globalThis.crypto?.subtle) {
    return undefined
  }

  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assertSupported(blob: Blob): void {
  if (!SUPPORTED_CONTENT_TYPES.has(blob.type)) {
    throw new WorkspaceSaveError(
      `Workspace assets do not support ${blob.type || 'this file type'}.`,
      'unsupported-type'
    )
  }

  if (blob.size > MAX_ASSET_BYTES) {
    throw new WorkspaceSaveError('This export is larger than the 50 MB asset limit.', 'too-large')
  }
}

export async function saveExportToWorkspace(input: SaveToWorkspaceInput): Promise<SavedAsset> {
  const { blob, fileName, trpcClient } = input
  assertSupported(blob)

  const sha256 = await digestBlob(blob)

  const { asset, uploadUrl } = await trpcClient.asset.signUpload.mutate({
    bytes: blob.size,
    classification: 'input',
    contentType: blob.type,
    fileName,
    sha256,
  })

  const upload = await fetch(uploadUrl, {
    body: blob,
    headers: { 'content-type': blob.type },
    method: 'PUT',
  })

  if (!upload.ok) {
    // The asset row stays in its pending state. It is not completed, so
    // it cannot be referenced by a variant or a release, and the caller
    // can retry without creating a duplicate usable asset.
    throw new WorkspaceSaveError(
      `Upload failed with status ${upload.status}.`,
      'upload-failed'
    )
  }

  await trpcClient.asset.completeUpload.mutate({ assetId: asset.id, sha256 })

  return { assetId: asset.id }
}

/**
 * Filename for a saved export.
 *
 * Saved assets are listed alongside one another, so a timestamp keeps
 * successive exports of the same composition distinguishable without
 * requiring the user to name each one.
 */
export function buildExportFileName(contentType: string, now = new Date()): string {
  const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `screenshot-studio-${stamp}.${extension}`
}
