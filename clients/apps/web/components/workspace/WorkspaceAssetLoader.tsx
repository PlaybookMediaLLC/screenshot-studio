'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useImageStore } from '@/lib/store'
import { useTRPCClient } from '@/lib/trpc/react'
import { buildExportFileName } from '@/lib/workspace/save-export'

/**
 * Loads a workspace asset into the editor when the URL carries
 * ?asset=<id>.
 *
 * This closes the loop the asset library opens: a saved export can come
 * back onto the canvas, take another pass, and be saved again. Without
 * it a workspace asset is a dead end that can only be downloaded.
 */
export function WorkspaceAssetLoader() {
  const trpcClient = useTRPCClient()
  // Guards the second effect run under React strict mode. The ref
  // survives the remount, so the asset loads exactly once.
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    if (startedRef.current) return
    const assetId = new URLSearchParams(window.location.search).get('asset')
    if (!assetId) return
    startedRef.current = true

    async function load(id: string): Promise<void> {
      const { downloadUrl } = await trpcClient.asset.signDownload.query({ assetId: id })
      const response = await fetch(downloadUrl)
      if (!response.ok) {
        throw new Error(`The download failed with status ${response.status}.`)
      }
      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) {
        toast.error('Only image assets can be edited', {
          description: 'Use Download on the assets page for video.',
        })
        return
      }
      const file = new File([blob], buildExportFileName(blob.type), { type: blob.type })
      // setImage writes the global store, so a strict-mode remount
      // between the fetch and this call is harmless.
      useImageStore.getState().setImage(file)
      // Drop the parameter so a refresh keeps later edits instead of
      // reloading the original asset over them.
      const url = new URL(window.location.href)
      url.searchParams.delete('asset')
      window.history.replaceState(null, '', url)
    }

    load(assetId).catch(() => {
      toast.error('Could not open the asset', {
        description: 'The asset may have been deleted, or the download expired. Try again from the assets page.',
      })
    })
  }, [trpcClient])

  return null
}
