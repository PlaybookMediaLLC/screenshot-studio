'use client'

import type { TRPCClient } from '@trpc/client'
import { uploadByteLimit } from '@/lib/write/media-limits'
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
  // QuickTime from phones and cameras; Instagram and Threads take it as is.
  'video/quicktime',
  'video/webm',
  // Audio for design timelines.
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/otf',
  // LinkedIn documents (RFC 025).
  'application/pdf',
])

export interface SaveToWorkspaceInput {
  onProgress?: (progress: number) => void
  /**
   * Called with the reserved asset before any bytes move, so a caller can
   * record it and recognize an interrupted upload after a reload.
   */
  onReserved?: (assetId: string) => void | Promise<void>
  parentAssetId?: string
  projectId?: string
  classification?: 'input' | 'export' | 'derived' | 'capture'
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
  // Avoid a second full-sized allocation for large video uploads. Go still
  // streams and verifies the exact reserved byte count at completion.
  if (!globalThis.crypto?.subtle || blob.size > 64 * 1024 * 1024) {
    return undefined
  }

  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assertSupported(blob: Blob, plan: string): void {
  if (!SUPPORTED_CONTENT_TYPES.has(blob.type)) {
    throw new WorkspaceSaveError(
      `Workspace assets do not support ${blob.type || 'this file type'}.`,
      'unsupported-type'
    )
  }

  const limit = uploadByteLimit(blob.type, plan)
  if (blob.size > limit) {
    throw new WorkspaceSaveError(
      `This file is larger than your plan's ${limit / 1_000_000} MB asset limit.`,
      'too-large'
    )
  }
}

export async function saveExportToWorkspace(input: SaveToWorkspaceInput): Promise<SavedAsset> {
  const { blob, fileName, trpcClient } = input
  // Read the current entitlement for each transfer: a stale browser session must
  // not advertise a paid upload ceiling after a workspace/plan change.
  const { plan } = await trpcClient.billing.summary.query()
  assertSupported(blob, plan)

  const sha256 = await digestBlob(blob)

  const { asset, uploadUrl } = await trpcClient.asset.signUpload.mutate({
    bytes: blob.size,
    classification: input.classification ?? 'input',
    projectId: input.projectId,
    parentAssetId: input.parentAssetId,
    contentType: blob.type,
    fileName,
    sha256,
  })

  await input.onReserved?.(asset.id)
  // The signed URL is write-once; storage refuses a second PUT.
  await uploadWithProgress(uploadUrl, blob, input.onProgress)

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
  return `shots-${stamp}.${extension}`
}

/** Transfer progress measures bytes actually sent; completion still waits for Go verification. */
async function uploadWithProgress(
  url: string,
  blob: Blob,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (!onProgress || typeof XMLHttpRequest === 'undefined') {
    const response = await fetch(url, {
      body: blob,
      headers: { 'content-type': blob.type, 'if-none-match': '*' },
      method: 'PUT',
    })
    if (!response.ok)
      throw new WorkspaceSaveError(`Upload failed with status ${response.status}.`, 'upload-failed')
    return
  }
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.setRequestHeader('content-type', blob.type)
    request.setRequestHeader('if-none-match', '*')
    request.timeout = 15 * 60 * 1000
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.min(95, Math.round((event.loaded / event.total) * 95)))
    }
    const fail = () =>
      reject(
        new WorkspaceSaveError(
          'Upload failed. Your text is saved; retry the attachment.',
          'upload-failed'
        )
      )
    request.onerror = fail
    request.ontimeout = fail
    request.onabort = fail
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : fail())
    request.send(blob)
  })
}
