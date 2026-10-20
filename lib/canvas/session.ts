'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { trackEvent } from '@/lib/analytics'
import { uploadDesignSources, withUploadedSources } from '@/lib/design/upload-sources'
import { mergeConcurrent } from '@/lib/creative-sets/concurrent'
import { newCreativeSetId } from '@/lib/creative-sets/document'
import {
  readRecoveries,
  removeSetRecovery,
  writeRecovery,
  type DocumentRecovery,
  type RecoveryKind,
} from '@/lib/creative-sets/recovery'
import {
  RevisionedSession,
  type RevisionedRecord,
  type RevisionedSessionState,
  type RevisionedStorage,
} from '@/lib/creative-sets/revisioned-session'
import { NativeDocumentBridge } from '@/lib/creative-sets/native-session'
import { applyCanvasCommand, type CanvasCommand } from './commands'
import { canvasDocumentSchema, type CanvasDocument } from './document'
import type { DesignDocument } from '@/lib/design/document'

/** A stored canvas workspace. */
export type CanvasRecord = RevisionedRecord<CanvasDocument>
/** What the canvas UI renders from. */
export type CanvasSessionState = RevisionedSessionState<CanvasDocument>
/** A canvas draft kept on this device. */
export type CanvasRecovery = DocumentRecovery<CanvasDocument>

/** Field-level merge: artboards and layers carry stable IDs, so independent edits combine. */
export function mergeCanvasConcurrent(
  base: CanvasDocument,
  local: CanvasDocument,
  remote: CanvasDocument
): CanvasDocument {
  return canvasDocumentSchema.parse(mergeConcurrent(base, local, remote, 'canvas'))
}

const canvasRecovery: RecoveryKind<CanvasDocument> = {
  parse: (raw) => canvasDocumentSchema.parse(raw),
  natives: (document) => document.artboards.map((artboard) => artboard.document),
  mapNatives: (document, map) => {
    for (const artboard of document.artboards) artboard.document = map(artboard.document)
    return document
  },
}

/** Keep a draft of this tab's canvas on the device. */
export function writeCanvasRecovery(record: CanvasRecovery): Promise<void> {
  return writeRecovery(record, canvasRecovery)
}

/** This device's drafts of one canvas, newest first. */
export function readCanvasRecoveries(workspaceId: string, canvasId: string) {
  return readRecoveries(workspaceId, canvasId, canvasRecovery)
}

/** Forget one draft. */
export const removeCanvasRecovery = removeSetRecovery

/**
 * The open canvas: its typed commands, undo, autosave, local recovery and
 * conflict handling, through the same revision-checked path as Story Sets.
 */
export class CanvasSession extends RevisionedSession<CanvasDocument> {
  private copyId = newCreativeSetId()
  constructor(
    record: CanvasRecord,
    client: TRPCClient<AppRouter>,
    storage: RevisionedStorage<CanvasDocument> = {
      write: writeCanvasRecovery,
      remove: removeCanvasRecovery,
    }
  ) {
    super(record, client, storage, {
      label: 'canvas',
      parse: (document) => canvasDocumentSchema.parse(document),
      merge: mergeCanvasConcurrent,
      upload: async (document) => {
        for (const artboard of document.artboards)
          artboard.document = await uploadDesignSources(client, artboard.document)
        return document
      },
      resolveUploads: (original) => {
        const current = structuredClone(original)
        for (const artboard of current.artboards)
          artboard.document = withUploadedSources(artboard.document)
        return current
      },
      get: () => client.canvas.get.query({ canvasId: record.id }),
      update: (baseRevision, document) =>
        client.canvas.updateDocument.mutate({ canvasId: record.id, baseRevision, document }),
    })
    trackEvent('canvas_open', {
      artboards: record.document.artboards.length,
      revision: record.revision,
    })
  }
  /** Apply a typed command as one undo step. Native edits keep the open canvas mounted. */
  command(command: CanvasCommand) {
    this.commit(applyCanvasCommand(this.history.document, command), command.type !== 'native-edit')
    trackEvent('canvas_command', {
      command: command.type,
      artboards: this.history.document.artboards.length,
    })
  }
  /** Save this tab's work as a new canvas after a conflict, leaving the saved one untouched. */
  async preserveCopy() {
    const document = await this.kind.upload(structuredClone(this.history.document))
    return this.client.canvas.create.mutate({
      id: this.copyId,
      document,
      name: `${this.record.name.slice(0, 180)} recovered copy`,
    })
  }
  /** A bridge that mounts one artboard in the native editor; `onCommit` sees each stored edit. */
  nativeBridge(artboardId: string, onCommit: (document: DesignDocument) => void = () => undefined) {
    const artboard = () => {
      const found = this.snapshot().document.artboards.find((item) => item.id === artboardId)
      if (!found) throw new Error('That artboard is no longer on this canvas.')
      return found
    }
    return new NativeDocumentBridge({
      client: this.client,
      resolved: () => artboard().document,
      stored: () => artboard().document,
      // Native flushes are frequent; they are recorded, not counted in analytics.
      commit: (document) => {
        this.commit(
          applyCanvasCommand(this.history.document, {
            type: 'native-edit',
            id: artboardId,
            document,
          }),
          false
        )
        onCommit(artboard().document)
      },
      failure: (message) => this.editorFailure(message),
    })
  }
}
