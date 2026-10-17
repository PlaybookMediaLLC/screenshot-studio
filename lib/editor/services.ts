import type { EditorServices, EditorUploadFile } from '@shots/platejs-editor/lib'
import { type SaveToWorkspaceInput, saveExportToWorkspace } from '@/lib/workspace/save-export'

type TrpcClient = SaveToWorkspaceInput['trpcClient']

/** The stable address of a workspace asset; it redirects to a signed URL. */
export function assetContentUrl(assetId: string): string {
  return `/api/v1/assets/${encodeURIComponent(assetId)}/content`
}

/**
 * Stores an editor upload as a workspace asset: signed upload to R2 through the
 * Go backend, the same path saved exports take.
 */
export function workspaceUploadFile(trpcClient: TrpcClient): EditorUploadFile {
  return async (file, options) => {
    options?.onProgress?.(5)
    const { assetId } = await saveExportToWorkspace({ blob: file, fileName: file.name, trpcClient })
    options?.onProgress?.(100)
    return {
      assetId,
      name: file.name,
      size: file.size,
      type: file.type,
      url: assetContentUrl(assetId),
    }
  }
}

/** Uploads and AI wired to the platform for the document editor. */
export function platformEditorServices(trpcClient: TrpcClient, aiEnabled: boolean): EditorServices {
  return {
    ai: aiEnabled
      ? { chat: { api: '/api/ai/document' }, copilot: { api: '/api/ai/document/copilot' } }
      : undefined,
    uploadFile: workspaceUploadFile(trpcClient),
  }
}
