import 'server-only'

import type { BackendCreativeSet } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, orNull, withDates } from '@/lib/backend/sdk'
import {
  canvasDocumentSchema,
  readCanvasDocument,
  type CanvasDocument,
} from '@/lib/canvas/document'
import type { CanvasHandoffInput, CanvasListInput } from '@/lib/canvas/schema'
import { componentDocument } from '@/lib/canvas/components'
import { getLocalDesignSources } from '@/lib/design/document'
import { DesignError } from './designs'

/**
 * Canvas workspaces (RFC 041). The backend stores them as creative sets of
 * kind `canvas`: it scopes every query to the workspace, checks roles and
 * asset ownership, refuses stale revisions with a 409 (tRPC `CONFLICT`) and
 * keeps a row's kind fixed. This layer validates documents in both
 * directions and never returns a Story Set as a canvas.
 */

/** A document ready to store: valid, and every image uploaded to the workspace. */
function storableDocument(raw: unknown): CanvasDocument {
  const document = canvasDocumentSchema.parse(raw)
  const natives = [
    ...document.artboards.map((artboard) => artboard.document),
    ...document.components.map(componentDocument),
  ]
  if (natives.some((native) => getLocalDesignSources(native).length > 0))
    throw new DesignError('Upload local images before saving the canvas.', 400)
  return document
}

function readCanvas(record: BackendCreativeSet) {
  return { ...withDates(record), document: canvasDocumentSchema.parse(record.document) }
}

/** The canvas row, or null when the id is not a canvas of this workspace. */
async function canvasRow(context: TenantContext, canvasId: string) {
  const record = await orNull(backendSDK(context).getCreativeSet(canvasId))
  return record?.kind === 'canvas' ? record : null
}

/** A workspace-scoped presence credential for a canvas; null for anything that is not one. */
export async function createCanvasCollabToken(context: TenantContext, canvasId: string) {
  if (!(await canvasRow(context, canvasId))) return null
  return backendSDK(context).createCreativeSetCollabToken(canvasId)
}

/** One page of the workspace's canvases. A canvas a newer app wrote lists without a preview. */
export async function listCanvases(context: TenantContext, query: CanvasListInput) {
  const page = await backendSDK(context).listCreativeSets({ ...query, kind: 'canvas' })
  return {
    items: page.items.map((record) => ({
      ...withDates(record),
      document: readCanvasDocument(record.document),
    })),
    nextCursor: page.nextCursor,
  }
}

/** Create a canvas from a stored-form document. */
export async function createCanvas(
  context: TenantContext,
  input: { id: string; document: unknown; name: string }
) {
  const document = storableDocument(input.document)
  return readCanvas(
    await backendSDK(context).createCreativeSet({ id: input.id, document, name: input.name })
  )
}

/** A canvas of this workspace, or null. */
export async function getCanvas(context: TenantContext, canvasId: string) {
  const record = await canvasRow(context, canvasId)
  return record ? readCanvas(record) : null
}

/** Rename a canvas; null when it is not a canvas of this workspace. */
export async function renameCanvas(context: TenantContext, canvasId: string, name: string) {
  if (!(await canvasRow(context, canvasId))) return null
  const record = await orNull(backendSDK(context).renameCreativeSet(canvasId, name))
  return record ? readCanvas(record) : null
}

/** Write a document based on `baseRevision`; a stale write fails with a 409. */
export async function updateCanvasDocument(
  context: TenantContext,
  canvasId: string,
  input: { baseRevision: number; document: unknown }
) {
  const document = storableDocument(input.document)
  return withDates(
    await backendSDK(context).updateCreativeSetDocument(canvasId, {
      baseRevision: input.baseRevision,
      document,
    })
  )
}

/** Copy a canvas as a new canvas. */
export async function duplicateCanvas(context: TenantContext, canvasId: string, name?: string) {
  if (!(await canvasRow(context, canvasId))) return null
  const record = await orNull(backendSDK(context).duplicateCreativeSet(canvasId, name))
  return record ? readCanvas(record) : null
}

/** Archive a canvas, keeping its history and delivered references; false when it is not here. */
export async function archiveCanvas(context: TenantContext, canvasId: string) {
  if (!(await canvasRow(context, canvasId))) return false
  return (await orNull(backendSDK(context).archiveCreativeSet(canvasId))) !== null
}

/** A canvas's versions, newest first, without documents; null when it is not here. */
export async function listCanvasVersions(context: TenantContext, canvasId: string) {
  if (!(await canvasRow(context, canvasId))) return null
  const result = await orNull(backendSDK(context).listCreativeSetVersions(canvasId))
  return result?.versions.map(({ document: _document, ...version }) => withDates(version)) ?? null
}

/** One version with its document, or null. */
export async function getCanvasVersion(
  context: TenantContext,
  canvasId: string,
  versionId: string
) {
  if (!(await canvasRow(context, canvasId))) return null
  const version = await orNull(backendSDK(context).getCreativeSetVersion(canvasId, versionId))
  return version
    ? { ...withDates(version), document: canvasDocumentSchema.parse(version.document) }
    : null
}

/** Name the canvas's current document as a version; null when it is not here. */
export async function createCanvasVersion(
  context: TenantContext,
  canvasId: string,
  name: string,
  baseRevision?: number
) {
  if (!(await canvasRow(context, canvasId))) return null
  const version = await orNull(
    backendSDK(context).createCreativeSetVersion(canvasId, name, baseRevision)
  )
  return version ? withDates(version) : null
}

/** Make a version the canvas's document, based on `baseRevision`; stale fails with a 409. */
export async function restoreCanvasVersion(
  context: TenantContext,
  canvasId: string,
  versionId: string,
  baseRevision: number
) {
  if (!(await canvasRow(context, canvasId))) return null
  const record = await orNull(
    backendSDK(context).restoreCreativeSetVersion(canvasId, versionId, baseRevision)
  )
  return record ? readCanvas(record) : null
}

/** Attach a delivered artboard as a new campaign candidate; earlier approvals never change. */
export async function attachCanvasDelivery(context: TenantContext, input: CanvasHandoffInput) {
  const { canvasId, ...handoff } = input
  if (!(await canvasRow(context, canvasId))) return null
  return backendSDK(context).attachCreativeSetDelivery(canvasId, handoff)
}
